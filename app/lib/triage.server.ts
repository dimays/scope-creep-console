import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, ensureSchema } from "~/db";
import { conversationMessages, conversations } from "~/db/schema";
import { controlPlaneRepoDir } from "./authoring.server";
import { landProposal } from "./sandbox.server";
import type { Thread, ThreadStatus } from "./threads";
import type { OrgUpdateOpts } from "./threads.server";
import { postCriticalUpdate, postNeedsInput } from "./threads.server";

/**
 * The **request-triage runner** mechanics (work-066, [[request-triage]] loop, [[prd-request-loop]]).
 *
 * ## Where the runner lives (the architectural decision)
 * The runner straddles two repos. Its read + write-back mechanics live **here, in the
 * console**, because the thread schema and the async writers (`postCriticalUpdate` /
 * `postNeedsInput`, work-064) are the console's — that is the single source of truth for
 * thread data, and ADR-024 makes the console's DB the shared store both the console and this
 * routine read/write. Re-implementing the schema anywhere else would fork it; the runner
 * instead reuses it. The **ticket-authoring** path targets the `scope-creep` **control
 * plane**, reusing the console's existing control-plane authoring pattern
 * (`controlPlaneRepoDir()` + the gated `landProposal` PR machinery) — the same way the
 * console already opens employee/template PRs against the core (authoring.server.ts).
 *
 * The scheduled **routine** is a claude.ai Code Routine sourced from `scope-creep` (its
 * centre of gravity: the triage *judgment* reads the charter/roadmap/specs, and tickets +
 * PRs land there). It runs with the console checked out as a sibling and the remote
 * `DATABASE_URL` + `DATABASE_AUTH_TOKEN` (ADR-024) in its environment, so these console
 * writers operate directly on the shared store with no launched session — the capability
 * ADR-016 left as a read-only projection.
 *
 * ## What is mechanism vs. judgment
 * This module is **mechanism only** — sweep, write-back, render+stage a ticket. The triage
 * *decision* (decline · counter-propose · accept · fold into a PRD) is the routine session's
 * runtime Claude reasoning against the loop spec, never hardcoded here. And this module never
 * **merges**: a ticket is staged as a PR; auto-merge of a simple accept is the gated
 * ADR-022 independent-review finish line (author ≠ merger), not something the author-runner
 * does to itself.
 *
 * Every side-effecting entry point takes `{ dryRun }`, so the whole runner is exercisable
 * without a provisioned remote DB or a registered routine — the read path runs against a
 * local file/`:memory:` db, and dry-run returns the *planned* write/PR without performing it.
 */

// --- Fixture denylist (work-115 defense-in-depth) -------------------------

/**
 * **Defense-in-depth ONLY — not the fix.** work-115: console test helpers once wrote their
 * verbatim `createThread(...)` fixtures into the shared store (a test run resolved the db to the
 * remote Turso endpoint instead of `:memory:`), and the request-triage sweep re-triaged ~200 of
 * them every hour, burning budget. The real fix closes that leak at the source — the db is pinned
 * local for tests and a setup guard aborts any run that would target a remote store (see
 * console `vitest.config.ts` + `test/guard-local-db.ts`) — and the already-leaked rows are removed
 * from the store under an Owner-gated cleanup (docs/owner-cleanup-work-115-fixture-threads.md).
 *
 * This denylist is the belt to that suspenders: if a fixture *ever* reaches the store again it is
 * silently skipped by the sweep so no budget is spent on it. It matches the **exact `title` +
 * `body` pair** of a known fixture — never a substring, never title-alone — because
 * genuine and fixture request threads travel the *identical* `createThread` path (no
 * source/origin column exists to distinguish them; see `app/db/schema.ts` — a request thread is
 * `kind:"request"`, `initiator:"owner"`, opener `role:"owner"`, whether real or a fixture). The
 * exact-pair requirement is what keeps this from ever dropping a real Owner request.
 *
 * **Honest limits (why this is secondary, not primary):**
 *   - It only knows the fixtures enumerated here. A NEW test fixture would leak until added — so
 *     this must never be relied on in place of the db isolation above.
 *   - **It cannot cover the sweep-path test fixtures by design.** A few `triage.server.test.ts`
 *     fixtures (e.g. "Speed up the dashboard"/"The metrics view takes 8s to load.", "Export
 *     threads to CSV"/…, "Older ask"/…, "Newer ask"/…, "Add SSO to the admin panel"/…, "Rename
 *     the workspace"/…) exist precisely to prove the *genuine* sweep path and are asserted to BE
 *     swept — so they can never be denylisted without breaking their own tests. If those leaked
 *     pre-fix rows are still in the store they are handled by the Owner-gated cleanup's dedup
 *     criterion, not here. This is the clearest reason the denylist is defense-in-depth only.
 *   - **Org-initiated fixtures are out of scope here on purpose.** The sweep already filters
 *     `initiator = "owner"` (see {@link listNewRequestThreads}), so an `initiator = "org"` fixture
 *     (opener `role = "agent"`, e.g. "Org opener"/"The org needs your call.", "FYI"/"Heads up on
 *     the design pin.", "Need input"/"Please decide.") can *never* reach this denylist and is
 *     deliberately omitted. Those rows are still removed from the store by the cleanup doc's
 *     dedup criterion, which — unlike this sweep filter — groups regardless of initiator.
 *   - The residual false-positive risk is NOT the terse pairs (e.g. "First"/"…", "P"/"…") — a
 *     real request never looks like those. It is the handful of **natural feature-request pairs a
 *     real Owner could plausibly re-file verbatim** — e.g. "Add a dark mode toggle"/"Please add
 *     dark mode." or "Ship the queue"/"Please build the needs-you queue.". If the Owner ever files
 *     one of those word-for-word (title AND body), the sweep would skip it. That risk is bounded
 *     and low (it needs an exact full-pair match) — but not literally zero, which is exactly why
 *     this stays defense-in-depth secondary to the DB isolation, never the primary guard.
 *
 * Keyed by JSON.stringify([title, body]). Sourced from an authoritative sweep of every
 * test file under `app/`: app/lib/{triage,threads,human-input,work-sweep}.server.test.ts and
 * app/routes/route-entrypoints.test.ts (owner-initiated `request` threads only — see limits above).
 */
const FIXTURE_THREAD_PAIRS: ReadonlyArray<readonly [title: string, body: string]> = [
  // triage.server.test.ts
  ["Add a dark mode toggle", "Please add dark mode."],
  ["Wire the badge", "Build the unread badge."],
  ["Old ask", "please do X"],
  ["First", "1"],
  ["Second", "2"],
  ["Dry one", "test"],
  ["FYI path", "test"],
  ["Judgment path", "test"],
  ["Close it", "test"],
  // threads.server.test.ts (createThread — request kind)
  ["Ship the queue", "Please build the needs-you queue."],
  ["A question", "What should we prioritize?"],
  ["Done thing", "Thanks!"],
  ["Roadmap", "Let's talk Q4 priorities."],
  ["Keep working", "Please keep building."],
  ["P", "…"],
  ["Solo", "No branches here."],
  ["New idea", "Could we branch tangents into threads?"],
  ["Idea 2", "Another one."],
  ["Launch me", "Give me a State of the Product."],
  ["Edit at launch", "First draft of the ask."],
  ["Correlate me", "Do a thing."],
  ["Fresh", "Nothing launched yet."],
  ["Wrap it up", "This one is done — tuck it away."],
  ["Closed then archived", "Done and away."],
  ["Stay visible", "Keep me on the board."],
  ["Hide me", "Off the board, please."],
  ["Round trip", "Archive then restore me."],
  ["Build the loop", "Please build the request loop."],
  ["Scope call", "Kick this off."],
  ["Sessionless", "No Claude session launched here."],
  ["Override", "…"],
  ["Read me", "Owner opens this."],
  ["Re-raise", "…"],
  ["Notif A", "…"],
  ["Notif B", "…"],
  ["Clear flag", "…"],
  ["Archive from notif", "…"],
  // threads.server.test.ts (branchThread children — request kind, owner-initiated)
  ["Theme 2 as its own effort", "Theme 2 deserves its own thread — let's scope it."],
  ["Tangent", "A side thought."],
  ["Child", "Scope this."],
  // human-input.server.test.ts (direct request-thread insert)
  ["a work request", "a work request"],
  // route-entrypoints.test.ts (owner-initiated request threads via POST /threads + branch intent)
  ["A test thread", "Please do the thing."],
  ["Parent", "Let's discuss."],
  ["A tangent", "This deserves its own thread."],
  ["Parent 2", "…"],
  ["Launch flow", "Give me a State of the Product."],
  ["Archive me via route", "Please tuck this away."],
  ["Round-trip via route", "Archive then restore."],
  // work-sweep.server.test.ts (createThread — request kind)
  ["Loop milestone", "please review"],
];

const FIXTURE_DENYLIST: ReadonlySet<string> = new Set(
  FIXTURE_THREAD_PAIRS.map(([title, body]) => JSON.stringify([title, body])),
);

/**
 * Whether a swept thread is a **known console test fixture** (work-115) — an exact `title` + its
 * opener `body` match against {@link FIXTURE_DENYLIST}. `openerBody` is the thread's first
 * `role:"owner"` message body (the ask). Conservative by construction: an exact full-pair match
 * only, so it never drops a genuine Owner request. Defense-in-depth; see the denylist doc.
 */
export function isKnownFixtureThread(title: string, openerBody: string): boolean {
  return FIXTURE_DENYLIST.has(JSON.stringify([title, openerBody]));
}

// --- Sweep (loop step 1) --------------------------------------------------

/**
 * The sweep: **new** owner-initiated `request` threads awaiting triage — no org response yet
 * (no `role = agent` message), non-archived, oldest-first (FIFO). Once the routine writes an
 * outcome back (a `critical-update` / `needs-input` card, both `role = agent`) a thread drops
 * out of the sweep, so it is never re-triaged ([[request-triage]] termination). `chat`-kind
 * and org-initiated threads are never swept.
 *
 * Known console test fixtures ({@link isKnownFixtureThread}) are also skipped — defense-in-depth
 * against the work-115 shared-store contamination (the primary fix is the test-db isolation in
 * `vitest.config.ts` + `test/guard-local-db.ts`; this only stops budget being spent should a
 * fixture ever reach the store again).
 */
export async function listNewRequestThreads(): Promise<Thread[]> {
  await ensureSchema();
  const answered = await db
    .selectDistinct({ cid: conversationMessages.conversationId })
    .from(conversationMessages)
    .where(eq(conversationMessages.role, "agent"));
  const answeredIds = new Set(answered.map((r) => r.cid));

  const threads = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.kind, "request"),
        eq(conversations.initiator, "owner"),
        isNull(conversations.archivedAt),
      ),
    )
    .orderBy(asc(conversations.createdAt));

  const candidates = threads.filter((t) => !answeredIds.has(t.id));
  if (candidates.length === 0) return candidates;

  // Load each candidate's opener (first owner message) to match the exact title+body fixture
  // pairs. Only the swept candidates are inspected, so this is bounded by the untriaged queue.
  const openerRows = await db
    .select({ cid: conversationMessages.conversationId, body: conversationMessages.body })
    .from(conversationMessages)
    .where(
      and(
        inArray(
          conversationMessages.conversationId,
          candidates.map((t) => t.id),
        ),
        eq(conversationMessages.role, "owner"),
        eq(conversationMessages.type, "message"),
      ),
    )
    .orderBy(asc(conversationMessages.at));
  const openerBody = new Map<number, string>();
  for (const r of openerRows) if (!openerBody.has(r.cid)) openerBody.set(r.cid, r.body);

  return candidates.filter((t) => !isKnownFixtureThread(t.title, openerBody.get(t.id) ?? ""));
}

// --- Write-back (loop step 4) ---------------------------------------------

/** The two async write-back card types the routine posts back into a thread (work-064). */
export type TriageOutcomeKind = "critical-update" | "needs-input";

/** A write the runner *would* perform, returned in dry-run instead of touching the store. */
export type PlannedWriteBack = {
  action: "write-back";
  dryRun: boolean;
  threadId: number;
  kind: TriageOutcomeKind;
  status: ThreadStatus;
  opts: OrgUpdateOpts;
};

/**
 * Post a triage outcome back into a thread, or (dry-run) return what it would post. A
 * `critical-update` is an FYI that **keeps the org's turn** (`working` by default) — a
 * decline-with-reason, a counter-proposal, or "triaged, ticket created" progress. A
 * `needs-input` **parks the thread on the Owner** (`needs-you`) — a genuine judgment call or
 * a STOP-gate/new-scope proposal the routine may not self-authorize. The loop decides which;
 * this only performs it, delegating to the work-064 writers so there is one implementation.
 */
export async function writeBackOutcome(
  threadId: number,
  kind: TriageOutcomeKind,
  opts: OrgUpdateOpts,
  runOpts: { dryRun?: boolean } = {},
): Promise<PlannedWriteBack> {
  const status: ThreadStatus = opts.status ?? (kind === "needs-input" ? "needs-you" : "working");
  const planned: PlannedWriteBack = {
    action: "write-back",
    dryRun: !!runOpts.dryRun,
    threadId,
    kind,
    status,
    opts,
  };
  if (runOpts.dryRun) return planned;

  if (kind === "needs-input") await postNeedsInput(threadId, { ...opts, status });
  else await postCriticalUpdate(threadId, { ...opts, status });
  return planned;
}

// --- Ticket authoring (loop step 3) ---------------------------------------

/** Frontmatter + body for a `work/NNN` control-plane ticket (parsed by work.server.ts). */
export type TicketSpec = {
  /** Numeric id (e.g. 78 → `work-078`, `work/078-<slug>.md`). Use {@link nextTicketId}. */
  num: number;
  /** Kebab-case slug for the filename (e.g. `remote-thread-store`). */
  slug: string;
  title: string;
  /** Work type — `feature` | `debt` | `chore` | `bug` (free text; matches existing tickets). */
  type: string;
  /** Owning executive slug (e.g. `chief-of-staff`, `cto`). */
  owner: string;
  priority?: "high" | "medium" | "low";
  /** The spec this accept traces to (a PRD/ADR slug) — required for an auto-mergeable accept. */
  spec?: string;
  /** The ticket body (markdown). */
  body: string;
  /** ISO date; defaults to today. Injectable for deterministic tests. */
  date?: string;
};

/** `work/NNN` id as the padded string (`78` → `work-078`). */
export function ticketId(num: number): string {
  return `work-${String(num).padStart(3, "0")}`;
}

/** Repo-relative path for a ticket (`78`, `remote-thread-store` → `work/078-remote-thread-store.md`). */
export function ticketPath(num: number, slug: string): string {
  return `work/${String(num).padStart(3, "0")}-${slug}.md`;
}

/**
 * Render a control-plane work ticket — flat `key: value` frontmatter (as `parseWorkFrontmatter`
 * reads) + markdown body. Pure, so it is unit-tested and the same content the dry-run shows is
 * exactly what gets staged. `status` is always `proposed`: the runner proposes; execution is
 * the [[ticket-cycle]]/[[dev-cycle]], and merge is gated by ADR-022.
 */
export function renderTicket(spec: TicketSpec): string {
  const date = spec.date ?? new Date().toISOString().slice(0, 10);
  const lines = [
    "---",
    `id: ${ticketId(spec.num)}`,
    `title: ${spec.title}`,
    `type: ${spec.type}`,
    "status: proposed",
    `priority: ${spec.priority ?? "medium"}`,
    `owner: ${spec.owner}`,
    ...(spec.spec ? [`spec: ${spec.spec}`] : []),
    `created: ${date}`,
    `updated: ${date}`,
    "---",
    spec.body.trimEnd(),
    "",
  ];
  return lines.join("\n");
}

/**
 * The next free `work/NNN` number: one past the highest `NNN-…md` in the control plane's
 * `work/` dir. Injectable dir for tests; defaults to `SCOPE_CREEP_HOME/work`.
 */
export async function nextTicketId(workDir?: string): Promise<number> {
  const dir = workDir ?? join(controlPlaneRepoDir(), "work");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return 1;
  }
  let max = 0;
  for (const f of files) {
    const m = /^(\d+)-.*\.md$/.exec(f);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return max + 1;
}

/** A ticket PR the runner *would* open, returned in dry-run instead of pushing/opening it. */
export type PlannedTicket = {
  action: "author-ticket";
  dryRun: boolean;
  id: string;
  path: string;
  content: string;
  /** Present only when actually staged (non-dry-run): the opened PR. */
  branch?: string;
  prUrl?: string;
};

/**
 * Author a `work/NNN` ticket in the control plane and stage it as a **gated PR** (never a
 * merge). Reuses the console's `landProposal` machinery, pointed at `controlPlaneRepoDir()` —
 * the isolated-worktree, push, `gh pr create` path the chatbot/authoring flows already use.
 * In dry-run it returns the rendered ticket (id, path, content) without touching git or the
 * remote. Auto-merge of a simple accept is the gated ADR-022 finish line, not done here.
 */
export async function authorTicketPR(
  spec: TicketSpec,
  runOpts: { dryRun?: boolean } = {},
): Promise<PlannedTicket> {
  const id = ticketId(spec.num);
  const path = ticketPath(spec.num, spec.slug);
  const content = renderTicket(spec);
  const planned: PlannedTicket = {
    action: "author-ticket",
    dryRun: !!runOpts.dryRun,
    id,
    path,
    content,
  };
  if (runOpts.dryRun) return planned;

  const title = `${id}: ${spec.title}`;
  const body =
    `Authored by the request-triage runner (work-066) from an Owner request thread.\n\n` +
    `Traces to spec: ${spec.spec ?? "(none — new scope; hold for the Owner)"}.`;
  const { branch, prUrl } = await landProposal(
    controlPlaneRepoDir(),
    { edits: [{ path, content }] },
    { title, body },
  );
  return { ...planned, branch, prUrl };
}
