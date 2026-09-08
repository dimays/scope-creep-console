import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, isNull } from "drizzle-orm";
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

// --- Sweep (loop step 1) --------------------------------------------------

/**
 * The sweep: **new** owner-initiated `request` threads awaiting triage — no org response yet
 * (no `role = agent` message), non-archived, oldest-first (FIFO). Once the routine writes an
 * outcome back (a `critical-update` / `needs-input` card, both `role = agent`) a thread drops
 * out of the sweep, so it is never re-triaged ([[request-triage]] termination). `chat`-kind
 * and org-initiated threads are never swept.
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

  return threads.filter((t) => !answeredIds.has(t.id));
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
