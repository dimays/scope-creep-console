import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import { buildCliCommand, buildDeepLink, buildOpenRepoLink } from "./claude-sessions";
import { agentDisplayName, DISPLAY_NAMES } from "./display-name";
import { type TicketRef, ticketsFor } from "./org.server";
import { readRegistry } from "./registry.server";
import { APP_VERSION } from "./version";
import { type LinkIndex, linkifyWikilinks, resolveWikilink } from "./wikilinks";
import { listWork } from "./work.server";

/**
 * Reads the Scope Creep control plane (docs, agents, ledger, registries) so the
 * Console can explain the platform to the Owner — read-only, sourced live from
 * SCOPE_CREEP_HOME (default ../scope-creep). See product/console-explore.prd.md.
 */

function home(): string {
  return process.env.SCOPE_CREEP_HOME ?? join(process.cwd(), "..", "scope-creep");
}

const DOC_DIRS: Array<{ dir: string; group: string }> = [
  { dir: "charter", group: "Charter" },
  { dir: "standards", group: "Standards" },
  { dir: "standards/adr", group: "ADRs" },
  { dir: "product", group: "Product" },
  { dir: "loops", group: "Loops" },
  { dir: "agents", group: "Agents" },
  { dir: "registry", group: "Registry" },
  { dir: "reference", group: "Reference" },
  { dir: "environments", group: "Environments" },
  { dir: "releases", group: "Releases" },
  { dir: "roadmap", group: "Roadmap" },
  { dir: "ledger", group: "Ledger" },
];

/** A `NNN-template.md` is a shape, not a doc — exempt from the browser, the link
 *  index, and the consistency check (its placeholder `[[roadmap-NNN]]` etc. are not
 *  real dangling links), exactly as the control-plane `docs:lint` exempts them. */
function isTemplateFile(file: string): boolean {
  return file === "000-template.md";
}

export type Frontmatter = {
  name?: string;
  description?: string;
  type?: string;
  status?: string;
  lastVerified?: string;
  ownerAgent?: string;
};

export type DocRecord = {
  slug: string;
  title: string;
  description: string;
  group: string;
  path: string;
  status?: string;
  /** The manifest `owner_agent`, for authorship-grounded eval signals (adr-015). */
  ownerAgent?: string;
};

// --- pure helpers (unit-tested) ------------------------------------------

export function parseFrontmatter(src: string): { fm: Frontmatter; body: string } {
  if (!src.startsWith("---")) return { fm: {}, body: src };
  const end = src.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: src };
  const raw = src.slice(3, end);
  const body = src.slice(end + 4);
  const fm: Frontmatter = {};
  let inMeta = false;

  for (const line of raw.split("\n")) {
    if (/^metadata:\s*$/.test(line)) {
      inMeta = true;
      continue;
    }
    const indented = /^\s{2,}([a-z_]+):\s*(.*)$/.exec(line);
    if (inMeta && indented) {
      const key = indented[1];
      const value = indented[2].trim();
      if (key === "type") fm.type = value;
      else if (key === "status") fm.status = value;
      else if (key === "last_verified") fm.lastVerified = value;
      else if (key === "owner_agent") fm.ownerAgent = value;
      continue;
    }
    const top = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (top) {
      inMeta = false;
      const key = top[1];
      const value = top[2].trim();
      if (key === "name") fm.name = value;
      else if (key === "description") fm.description = value;
    }
  }
  return { fm, body };
}

/**
 * Every `[[target]]` (or `[[target|alias]]`) referenced in a body, targets only.
 * Code spans and fenced blocks are stripped first, so example syntax inside
 * backticks (e.g. documenting the `[[name]]` convention) isn't miscounted.
 */
export function extractWikilinks(body: string): string[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const out: string[] = [];
  for (const match of withoutCode.matchAll(/\[\[([^\]]+)\]\]/g)) {
    out.push(match[1].split("|")[0].trim());
  }
  return out;
}

function firstHeading(body: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? fallback;
}

// --- readers -------------------------------------------------------------

async function readMd(rel: string): Promise<string | null> {
  try {
    return await readFile(join(home(), rel), "utf8");
  } catch {
    return null;
  }
}

export async function listDocs(): Promise<DocRecord[]> {
  const docs: DocRecord[] = [];
  for (const { dir, group } of DOC_DIRS) {
    let files: string[];
    try {
      files = await readdir(join(home(), dir));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      if (!file.endsWith(".md") || isTemplateFile(file)) continue;
      const rel = join(dir, file);
      const src = await readMd(rel);
      if (src === null) continue;
      const { fm } = parseFrontmatter(src);
      docs.push({
        slug: fm.name ?? rel.replace(/[/.]/g, "-"),
        title: fm.name ?? file.replace(/\.md$/, ""),
        description: fm.description ?? "",
        group,
        path: rel,
        status: fm.status,
        ownerAgent: fm.ownerAgent,
      });
    }
  }
  return docs;
}

/**
 * The full addressable namespace a `[[wikilink]]` can point at: doc slugs, work
 * items, agents, employee templates, and loops. Built once and threaded through
 * markdown rendering and the consistency check so both agree on what "resolves".
 */
export async function buildLinkIndex(): Promise<LinkIndex> {
  const [docs, work, registry, loops] = await Promise.all([
    listDocs(),
    listWork(),
    readRegistry(),
    listLoops(),
  ]);
  return {
    docs: new Set(docs.map((d) => d.slug)),
    work: new Set(work.map((w) => w.id)),
    agents: new Set(registry.agents.map((a) => a.name)),
    templates: new Set(registry.templates.map((t) => t.name)),
    loops: new Set(loops.map((l) => l.name)),
  };
}

async function renderMarkdown(body: string, index: LinkIndex): Promise<string> {
  return await marked.parse(linkifyWikilinks(body, index));
}

// --- thread link-out cards (work-048) ------------------------------------

export type ArtifactRef = {
  kind: "pr" | "issue" | "ticket" | "doc" | "agent" | "template" | "loop";
  label: string;
  href: string;
  external: boolean;
};

const GH_REF_RE = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)/g;

function kindFromHref(href: string): ArtifactRef["kind"] {
  if (href.startsWith("/work/")) return "ticket";
  if (href.startsWith("/explore/agents/")) return "agent";
  if (href.startsWith("/explore/templates/")) return "template";
  if (href.startsWith("/explore/loops/")) return "loop";
  return "doc";
}

/**
 * Extract the artifacts a set of texts *reference* — GitHub PR/issue URLs, and any
 * `[[wikilink]]` or bare `work-NNN` that resolves against the namespace — as
 * deep-linkable cards (work-048). Pure + unit-tested. Sourced from real text only
 * (thread messages + the projected transcript); a target that resolves to nothing
 * is dropped, never invented ([[adr-016]]). De-duped by href, PRs/tickets/docs first.
 */
export function extractReferences(texts: string[], index: LinkIndex): ArtifactRef[] {
  const byHref = new Map<string, ArtifactRef>();
  for (const text of texts) {
    for (const m of text.matchAll(GH_REF_RE)) {
      const [url, owner, repo, kind, n] = m;
      if (!byHref.has(url)) {
        byHref.set(url, {
          kind: kind === "pull" ? "pr" : "issue",
          label: `${owner}/${repo}#${n}`,
          href: url,
          external: true,
        });
      }
    }
    const targets = extractWikilinks(text);
    for (const m of text.matchAll(/\bwork-\d+\b/g)) targets.push(m[0]);
    for (const target of targets) {
      const href = resolveWikilink(target, index);
      if (!href || byHref.has(href)) continue;
      byHref.set(href, { kind: kindFromHref(href), label: target.trim(), href, external: false });
    }
  }
  const order: ArtifactRef["kind"][] = [
    "pr",
    "issue",
    "ticket",
    "doc",
    "loop",
    "agent",
    "template",
  ];
  return [...byHref.values()].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label),
  );
}

/** Resolve the artifact cards a thread references (work-048): build the namespace
 *  index once, then extract from the given texts (messages + projected transcript). */
export async function threadReferences(texts: string[]): Promise<ArtifactRef[]> {
  if (texts.every((t) => !t)) return [];
  return extractReferences(texts, await buildLinkIndex());
}

// --- org activity feed (work-037, the entity/episodic lens of transparent
// delegation) — reads the structured activity log work-036's hook writes. Until
// that hook lands the log is empty, so every reader here is honest-empty; it never
// infers activity from prose (ADR-013 refit). -----------------------------------

export type ActivityEvent = {
  /** ISO date/time or epoch-ms string, best-effort. */
  ts?: string;
  id?: string;
  /** The agent slug that acted. */
  actor: string;
  /** spawn | delegate | staff | confer (per work-036); kept open for forward compat. */
  type: string;
  summary: string;
  threadId?: number;
  /** A ledger entry / PR / thread URL or path the event points at. */
  refUrl?: string;
  sessionId?: string;
};

/**
 * Parse one `activity/*.ndjson` line into a typed event (work-036 schema:
 * `{ts,id,actor,type,summary,threadId?,refUrl?,sessionId}`). Pure + unit-tested;
 * tolerant — a blank line, non-JSON, or an event missing `actor`/`type` yields null
 * (dropped) rather than throwing, so a partially-written log never breaks the feed.
 */
export function parseActivityLine(line: string): ActivityEvent | null {
  const t = line.trim();
  if (!t) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(t);
  } catch {
    return null;
  }
  const actor = typeof o.actor === "string" ? o.actor : "";
  const type = typeof o.type === "string" ? o.type : "";
  if (!actor || !type) return null;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    actor,
    type,
    summary: str(o.summary) ?? "",
    ts: str(o.ts) ?? (typeof o.ts === "number" ? String(o.ts) : undefined),
    id: str(o.id),
    threadId: typeof o.threadId === "number" ? o.threadId : undefined,
    refUrl: str(o.refUrl),
    sessionId: str(o.sessionId),
  };
}

/** The whole org-activity log, newest first — or [] when the `activity/` record-set
 *  is absent/empty (work-036's hook hasn't run). Never invents an event. */
export async function listActivity(): Promise<ActivityEvent[]> {
  let files: string[];
  try {
    files = await readdir(join(home(), "activity"));
  } catch {
    return [];
  }
  const out: ActivityEvent[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".ndjson")) continue;
    const src = await readMd(join("activity", file));
    if (src === null) continue;
    for (const line of src.split("\n")) {
      const ev = parseActivityLine(line);
      if (ev) out.push(ev);
    }
  }
  return out.sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
}

/** The activity events a given agent was the actor of, newest first. */
export async function activityForActor(actor: string): Promise<ActivityEvent[]> {
  return (await listActivity()).filter((e) => e.actor === actor);
}

/** The activity events tied to a given thread, oldest first (they read as an inline
 *  timeline of what the org did inside that thread — work-031). */
export async function activityForThread(threadId: number): Promise<ActivityEvent[]> {
  return (await listActivity())
    .filter((e) => e.threadId === threadId)
    .sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
}

/** The in-Console href an event points at: its refUrl (a path or URL) if present,
 *  else its thread. Null when it points nowhere resolvable. Pure. */
export function activityHref(ev: ActivityEvent): string | null {
  if (ev.refUrl) return ev.refUrl;
  if (typeof ev.threadId === "number") return `/threads/${ev.threadId}`;
  return null;
}

/** A readable verb for a work-036 event type; unknown types pass through. Pure. */
export function activityVerb(type: string): string {
  switch (type) {
    case "spawn":
      return "spun up";
    case "delegate":
      return "delegated";
    case "staff":
      return "staffed";
    case "confer":
      return "conferred";
    default:
      return type;
  }
}

export async function readDoc(slug: string): Promise<{ doc: DocRecord; html: string } | null> {
  const docs = await listDocs();
  const doc = docs.find((d) => d.slug === slug);
  if (!doc) return null;
  const src = await readMd(doc.path);
  if (src === null) return null;
  const { body } = parseFrontmatter(src);
  const html = await renderMarkdown(body, await buildLinkIndex());
  return { doc, html };
}

export type LedgerEntry = {
  slug: string;
  title: string;
  order: number;
  file: string;
  /** The `/explore/docs/:slug` id this entry renders under — computed exactly the
   *  way {@link listDocs} slugs a ledger doc, so the Timeline link always resolves. */
  docSlug: string;
  /** The manifest `owner_agent` — who *authored* the entry (adr-015 attribution).
   *  Distinct from an agent merely *mentioned* in the body. */
  ownerAgent?: string;
};

export async function listLedger(): Promise<LedgerEntry[]> {
  let files: string[];
  try {
    files = await readdir(join(home(), "ledger"));
  } catch {
    return [];
  }
  const entries: LedgerEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const src = await readMd(join("ledger", file));
    if (src === null) continue;
    const { fm, body } = parseFrontmatter(src);
    // Mirror listDocs' slug rule so /explore/docs/:slug resolves for every entry.
    const docSlug = fm.name ?? join("ledger", file).replace(/[/.]/g, "-");
    entries.push({
      slug: fm.name ?? file.replace(/\.md$/, ""),
      title: firstHeading(body, fm.name ?? file),
      order: Number.parseInt(file, 10) || 0,
      file,
      docSlug,
      ownerAgent: fm.ownerAgent,
    });
  }
  return entries.sort((a, b) => b.order - a.order);
}

// --- releases + roadmap (projected artifacts, newest first) --------------

export type ArtifactEntry = {
  /** The `/explore/docs/:slug` id this entry renders under (its frontmatter name). */
  slug: string;
  /** The document's H1 (e.g. "Release 002 — v0.2.0 (Autonomous governance)"). */
  title: string;
  description: string;
  /** The `NNN` file prefix — the supersession order; higher is newer. */
  order: number;
  /** The `**Date:**` / `**Date range:**` line from the body, if present. */
  date?: string;
  /** Releases only: the `**Scope:**` line — which package/area the release covers. */
  scope?: string;
  /** Releases only: the semver (e.g. `v0.2.0`) read from the H1 or `**Version:**` line. */
  version?: string;
  file: string;
};

/**
 * Read a projected-artifact directory (`releases/` or `roadmap/`) into typed
 * entries, newest first (`NNN` desc). Templates and READMEs are excluded, so an
 * empty directory (or one holding only the template) reads as **empty** — the
 * surfaces must never invent a release or a deck ([[adr-016]] honesty rule). No
 * network, no Claude call: local files under `SCOPE_CREEP_HOME` only.
 */
async function listArtifacts(dir: string): Promise<ArtifactEntry[]> {
  let files: string[];
  try {
    files = await readdir(join(home(), dir));
  } catch {
    return [];
  }
  const out: ArtifactEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".md") || file === "README.md" || isTemplateFile(file)) continue;
    const src = await readMd(join(dir, file));
    if (src === null) continue;
    const { fm, body } = parseFrontmatter(src);
    const title = firstHeading(body, fm.name ?? file.replace(/\.md$/, ""));
    const scope = /\*\*Scope:\*\*\s*(.+)/.exec(body)?.[1]?.trim();
    // Prefer the version in the H1 (e.g. "… — v0.2.0 (…)"); fall back to the body's
    // `**Version:**` line. Stored bare (no leading "v") so callers can render it freely.
    const version =
      /\bv(\d+\.\d+\.\d+)/.exec(title)?.[1] ??
      /\*\*Version:\*\*\s*v?(\d+\.\d+\.\d+)/.exec(body)?.[1];
    out.push({
      slug: fm.name ?? join(dir, file).replace(/[/.]/g, "-"),
      title,
      description: fm.description ?? "",
      order: Number.parseInt(file, 10) || 0,
      date: /\*\*Date(?:\s+range)?:\*\*\s*(.+)/.exec(body)?.[1]?.trim(),
      scope,
      version,
      file,
    });
  }
  return out.sort((a, b) => b.order - a.order);
}

/** How significant a release is, from its semver: X.0.0 = major, X.Y.0 = minor,
 *  else patch. Drives the version badge's emphasis on the Releases surface (#7). */
export type ReleaseTier = "major" | "minor" | "patch";
export function releaseTier(version?: string): ReleaseTier | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return undefined;
  const [, , minor, patch] = m;
  if (patch !== "0") return "patch";
  if (minor !== "0") return "minor";
  return "major";
}

/** The package/area a release covers, derived from its free-text `**Scope:**` line,
 *  so the Releases surface can group by package (#7). Recognizes the known repos and
 *  falls back to the leading clause of the scope text. */
export type ReleasePackage = { key: string; label: string };
export function releasePackage(scope?: string): ReleasePackage {
  const s = (scope ?? "").toLowerCase();
  // An explicit package slug in parentheses wins, e.g. "(scope-creep-console)".
  const slug = /\((scope-creep[a-z0-9-]*)\)/.exec(s)?.[1] ?? "";
  const hit = slug || s;
  if (/ext-|extension/.test(hit)) return { key: "extensions", label: "Extensions" };
  if (/console/.test(hit)) return { key: "console", label: "Console" };
  if (/design/.test(hit)) return { key: "design", label: "Design system" };
  if (/control-plane|core|scope-creep/.test(hit)) {
    return { key: "scope-creep", label: "Scope Creep core" };
  }
  const fallback = (scope ?? "").split(/[—,(]/)[0]?.trim();
  return { key: fallback ? fallback.toLowerCase() : "other", label: fallback || "Other" };
}

/** Control-plane release-notes entries, newest first (work-054). */
export async function listReleases(): Promise<ArtifactEntry[]> {
  return listArtifacts("releases");
}

/** CEO roadmap-presentation entries, newest first (work-056). The head of the
 *  list is the latest presentation; the tail is the supersession history. */
export async function listRoadmap(): Promise<ArtifactEntry[]> {
  return listArtifacts("roadmap");
}

export { agentDisplayName };

// --- schedules: cloud routines + self-tuning cadence (work-052) -----------

export type RoutineRecord = {
  name: string;
  loop: string;
  triggerId: string;
  cron: string;
  cadenceBoundsDays?: [number, number];
  model?: string;
  status?: string;
  /** The claude.ai deep link where the routine is actually managed ([[adr-016]]:
   *  enable/disable/run-now happen THERE, never in-app). */
  manageUrl: string;
};

/**
 * The TIME-SCHEDULED cloud routines from `registry/routines.json` (hand-maintained;
 * the system of record is claude.ai, not this repo — [[work-051]]). Tolerant: a
 * missing/unreadable/malformed file, or a routine without a loop, reads as empty so
 * "empty is empty" holds and no schedule is fabricated. Returns the manage-all link too.
 */
export async function readRoutines(): Promise<{
  routines: RoutineRecord[];
  manageAllUrl: string;
}> {
  const fallback = {
    routines: [] as RoutineRecord[],
    manageAllUrl: "https://claude.ai/code/routines",
  };
  const src = await readMd(join("registry", "routines.json"));
  if (src === null) return fallback;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(src);
  } catch {
    return fallback;
  }
  const raw = Array.isArray(parsed.routines) ? parsed.routines : [];
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const routines = raw
    .map((r) => {
      const o = r as Record<string, unknown>;
      const bounds = Array.isArray(o.cadence_bounds_days)
        ? (o.cadence_bounds_days.filter((n) => typeof n === "number") as number[])
        : [];
      return {
        name: str(o.name) ?? "",
        loop: str(o.loop) ?? "",
        triggerId: str(o.trigger_id) ?? "",
        cron: str(o.cron) ?? "",
        cadenceBoundsDays:
          bounds.length === 2 ? ([bounds[0], bounds[1]] as [number, number]) : undefined,
        model: str(o.model),
        status: str(o.status),
        manageUrl:
          str(o.manage_url) ??
          (str(o.trigger_id)
            ? `https://claude.ai/code/routines/${str(o.trigger_id)}`
            : fallback.manageAllUrl),
      };
    })
    .filter((r) => r.loop !== "");
  return {
    routines,
    manageAllUrl: str(parsed.manage_all_url) ?? fallback.manageAllUrl,
  };
}

export type CadenceDecision = {
  loop?: string;
  ranAt?: string;
  /** `scheduled` | `ad-hoc` — how this run was triggered. */
  trigger?: string;
  /** `lengthen` | `shorten` | `hold` — how the cadence moved. */
  decision?: string;
  nextCadenceDays?: number;
  reason?: string;
};

/**
 * Parse the `cadence-decision` YAML blocks a self-tuning loop appends to its ledger
 * entry each run ([[ledger-043-staffing-cadence-self-tuning]]: trigger, signals,
 * decision, next_cadence_days, reason). Pure + unit-tested; tolerant by design so
 * "empty is empty" holds — a ledger with no such block yields []. Any fenced block
 * mentioning `next_cadence_days` (or `cadence-decision`) is treated as one.
 */
export function parseCadenceDecisions(md: string): CadenceDecision[] {
  const out: CadenceDecision[] = [];
  for (const m of md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    const block = m[1];
    if (!/cadence-decision|next_cadence_days/.test(block)) continue;
    const get = (k: string): string | undefined =>
      new RegExp(`(?:^|\\n)\\s*${k}:\\s*"?([^"\\n]+)"?`).exec(block)?.[1]?.trim();
    const days = get("next_cadence_days");
    out.push({
      loop: get("loop"),
      ranAt: get("ran_at"),
      trigger: get("trigger"),
      decision: get("decision"),
      nextCadenceDays: days && /^\d+$/.test(days) ? Number(days) : undefined,
      reason: get("reason"),
    });
  }
  return out;
}

/** The cadence-decision history for one loop, newest run first, across the ledger. */
export async function cadenceHistoryFor(loopName: string): Promise<CadenceDecision[]> {
  let files: string[];
  try {
    files = await readdir(join(home(), "ledger"));
  } catch {
    return [];
  }
  const out: CadenceDecision[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const src = await readMd(join("ledger", file));
    if (src === null) continue;
    for (const d of parseCadenceDecisions(src)) {
      if (d.loop === loopName) out.push(d);
    }
  }
  return out.sort((a, b) => (b.ranAt ?? "").localeCompare(a.ranAt ?? ""));
}

const CRON_DOW = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * A human-readable description of the fixed cron fire (the "next cron check" the
 * ticket asks for, stated as the schedule rather than a computed Date — no cron-date
 * dependency to drift). Handles the numeric minute/hour + day-of-week / day-of-month
 * forms the routines use; falls back to the raw expression for anything it can't read.
 */
export function describeCron(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron;
  const [min, hour, dom, , dow] = p;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return cron;
  const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  if (dow !== "*") {
    const days = dow
      .split(",")
      .map((d) => (/^\d+$/.test(d) ? (CRON_DOW[Number(d) % 7] ?? d) : d))
      .join(" & ");
    return `${days} at ${time}`;
  }
  if (dom !== "*") {
    const dates = dom
      .split(",")
      .map((d) => (/^\d+$/.test(d) ? ordinal(Number(d)) : d))
      .join(" & ");
    return `the ${dates} of each month at ${time}`;
  }
  return `daily at ${time}`;
}

export type LoopLaunch = { deepLink: string; cliCommand: string; openRepoLink: string };

/** "Open in Claude" launch info for running an event-driven loop by hand — same
 *  claude:// scheme as Threads (work-046), seeded to run the named loop. Zero Claude
 *  calls; it's an OS URL launch or a copyable command. */
export function loopLaunch(loopName: string): LoopLaunch {
  const cwd = home();
  const prompt = `Run the ${loopName} loop per loops/${loopName}.md. Read AGENTS.md and the loop definition first.`;
  return {
    deepLink: buildDeepLink({ cwd, prompt }),
    cliCommand: buildCliCommand({ cwd, prompt }),
    openRepoLink: buildOpenRepoLink(cwd),
  };
}

// --- loops (registry/loops.json) -----------------------------------------

export type LoopRecord = {
  name: string;
  kind: string;
  status?: string;
  description?: string;
  ownerAgent?: string;
  path?: string;
  mode?: string;
};

/**
 * Parse `registry/loops.json` into loop records. Pure + unit-tested. Tolerant by
 * design so "empty is empty" stays honest: malformed JSON, a missing `loops`
 * array, or entries without a name all collapse to [] / are dropped rather than
 * throwing. `mode` is optional (only some loops declare it).
 */
export function parseLoops(json: string): LoopRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const loops = (parsed as { loops?: unknown }).loops;
  if (!Array.isArray(loops)) return [];
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return loops
    .map((raw) => {
      const l = raw as Record<string, unknown>;
      return {
        name: str(l.name) ?? "",
        kind: str(l.kind) ?? "loop",
        status: str(l.status),
        description: str(l.description),
        ownerAgent: str(l.owner_agent),
        path: str(l.path),
        mode: str(l.mode),
      };
    })
    .filter((l) => l.name !== "");
}

/** Loops in the control-plane registry, or [] when absent/empty/unreadable. */
export async function listLoops(): Promise<LoopRecord[]> {
  const src = await readMd(join("registry", "loops.json"));
  if (src === null) return [];
  return parseLoops(src);
}

export async function readLoop(name: string): Promise<LoopRecord | null> {
  return (await listLoops()).find((l) => l.name === name) ?? null;
}

/** Cross-link resolution: the loops a given agent owns (`owner_agent`). Pure. */
export function loopsOwnedBy(loops: LoopRecord[], agent: string): LoopRecord[] {
  return loops.filter((l) => l.ownerAgent === agent);
}

export type AgentDirectReport = { name: string; template?: string; status?: string };

/** A grounded, clickable eval signal — a real artifact the agent authored. */
export type EvalSignal = { title: string; href: string };

/**
 * The Phase-1 eval surface for an agent (adr-015 / work-007): a **transparent
 * contribution history**, not a score. Every signal is an *authored* artifact
 * (manifest `owner_agent`), never a mere mention (adr-015 §B.3 attribution-over-
 * inference), and it links through to the artifact (§B.4). Signals that aren't yet
 * captured (the activity graph until work-036; structured QA/CRO verdicts) are named
 * honestly rather than shown as an earned zero — this is descriptive, and no number
 * is a score until the ADR's Phase 2.
 */
export type EvalHistory = {
  /** ADRs the agent led (`owner_agent` match). */
  adrsLed: EvalSignal[];
  /** Ledger entries the agent authored (`owner_agent` match). */
  ledgerAuthored: EvalSignal[];
  /** Ledger entries that only *mention* the agent — kept separate from authorship. */
  ledgerMentioned: EvalSignal[];
  /** Signals adr-015 defines but that can't be grounded yet — named, never faked. */
  notYetCaptured: string[];
};

export type AgentProfile = {
  name: string;
  displayName: string;
  description: string;
  status?: string;
  charterHtml: string;
  contributions: LedgerEntry[];
  loopsOwned: LoopRecord[];
  /** Phase-1 contribution-history eval (adr-015) — descriptive, not a score. */
  evalHistory: EvalHistory;
  // Org fields (ADR-017):
  kind?: string;
  reportsTo?: string;
  template?: string;
  /** Employees reporting to this agent (execs only). */
  directReports: AgentDirectReport[];
  /** Tickets this agent owns or is staffed to. */
  staffing: TicketRef[];
};

export async function readAgent(name: string): Promise<AgentProfile | null> {
  // Resolve the manifest path via the registry so employees (agents/employees/*.md)
  // and core agents (agents/*.md) both work; fall back to the flat path.
  const registry = await readRegistry();
  const entry = registry.agents.find((a) => a.name === name);
  const src = await readMd(entry?.path ?? join("agents", `${name}.md`));
  if (src === null) return null;
  const { fm, body } = parseFrontmatter(src);
  const charterHtml = await renderMarkdown(body, await buildLinkIndex());

  const display = DISPLAY_NAMES[name] ?? firstHeading(body, agentDisplayName(name));
  const ledger = await listLedger();
  const contributions: LedgerEntry[] = [];
  // Attribution-grounded (adr-015 §B.3): authored = the entry's own owner_agent is
  // this agent; mentioned = the agent appears in the prose but didn't author it. A
  // mention is not authorship, so the eval keeps them apart.
  const ledgerAuthored: EvalSignal[] = [];
  const ledgerMentioned: EvalSignal[] = [];
  for (const entry of ledger) {
    const entrySrc = await readMd(join("ledger", entry.file));
    const mentioned = !!entrySrc && (entrySrc.includes(display) || entrySrc.includes(name));
    if (entry.ownerAgent === name) {
      ledgerAuthored.push({ title: entry.title, href: `/explore/docs/${entry.docSlug}` });
      contributions.push(entry);
    } else if (mentioned) {
      ledgerMentioned.push({ title: entry.title, href: `/explore/docs/${entry.docSlug}` });
      contributions.push(entry);
    }
  }

  // ADRs led = ADR docs whose manifest owner_agent is this agent (a grounded, authored
  // signal, adr-015 §B.2). Uses the doc namespace so each links to its rendered page.
  const adrsLed: EvalSignal[] = (await listDocs())
    .filter((d) => d.group === "ADRs" && d.ownerAgent === name)
    .map((d) => ({ title: d.title, href: `/explore/docs/${d.slug}` }));

  const evalHistory: EvalHistory = {
    adrsLed,
    ledgerAuthored,
    ledgerMentioned,
    // Named honestly, never rendered as an earned 0 (adr-015 §B.5 empty-is-empty).
    notYetCaptured: [
      "delegation/spawn activity (work-036 capture hook not live yet)",
      "structured QA verdicts & CRO verifications (no typed record-set yet)",
      "PRs landed attributed per-agent (needs the git-manager's ledger records)",
    ],
  };

  const loopsOwned = loopsOwnedBy(await listLoops(), name);
  const directReports: AgentDirectReport[] = registry.agents
    .filter((a) => a.kind === "employee" && a.reports_to === name)
    .map((a) => ({ name: a.name, template: a.template, status: a.status }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const staffing = registry.available ? ticketsFor(name, await listWork()) : [];

  return {
    name,
    displayName: display,
    description: fm.description ?? entry?.description ?? "",
    status: fm.status ?? entry?.status,
    charterHtml,
    contributions,
    loopsOwned,
    evalHistory,
    kind: entry?.kind,
    reportsTo: entry?.reports_to,
    template: entry?.template,
    directReports,
    staffing,
  };
}

export type TemplateProfile = {
  name: string;
  displayName: string;
  description: string;
  status?: string;
  defaultModel?: string;
  skills: string[];
  manualHtml: string;
  /** Employees instantiated from this template. */
  roster: { name: string; reportsTo?: string; status?: string }[];
};

/** An employee template's profile: its operating manual + the roster instantiated from it. */
export async function readTemplate(name: string): Promise<TemplateProfile | null> {
  const registry = await readRegistry();
  const entry = registry.templates.find((t) => t.name === name);
  const src = await readMd(entry?.path ?? join("agents", "templates", `${name}.md`));
  if (src === null) return null;
  const { fm, body } = parseFrontmatter(src);
  const manualHtml = await renderMarkdown(body, await buildLinkIndex());
  const roster = registry.agents
    .filter((a) => a.kind === "employee" && a.template === name)
    .map((a) => ({ name: a.name, reportsTo: a.reports_to, status: a.status }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    name,
    displayName: firstHeading(body, name),
    description: fm.description ?? entry?.description ?? "",
    status: fm.status ?? entry?.status,
    defaultModel: entry?.default_model,
    skills: entry?.skills ?? [],
    manualHtml,
    roster,
  };
}

// --- consistency ("what's out of sync") ----------------------------------

export type ConsistencyReport = {
  danglingLinks: Array<{ from: string; target: string }>;
  proposedDocs: Array<{ slug: string; title: string }>;
  ungeneratedRegistries: string[];
  staleDocs: Array<{ slug: string; lastVerified: string; days: number }>;
  versionSkew: Array<{ source: string; version: string }>;
  ok: boolean;
};

/**
 * The app's release version lives in three places that must agree (version.ts,
 * package.json, CHANGELOG top entry) — /healthz reads the first, so a lag makes it
 * lie. Returns each source's version when they disagree, or [] when aligned. Pure +
 * unit-tested. (MANIFEST.yaml's version is a separate app-manifest axis, not checked.)
 */
export function versionSkew(v: {
  app: string;
  pkg: string | null;
  changelog: string | null;
}): Array<{ source: string; version: string }> {
  const entries = [
    { source: "version.ts", version: v.app },
    { source: "package.json", version: v.pkg },
    { source: "CHANGELOG.md", version: v.changelog },
  ].filter((e): e is { source: string; version: string } => e.version !== null);
  const distinct = new Set(entries.map((e) => e.version));
  return distinct.size > 1 ? entries : [];
}

export async function consistency(): Promise<ConsistencyReport> {
  const docs = await listDocs();
  // A wikilink resolves against the WHOLE namespace (docs, work, agents, templates,
  // loops) — not just doc slugs — so `[[work-017]]` / `[[backend-engineer]]` /
  // `[[core-upgrade]]` count as resolved (they are real pages), and only a target
  // that points at nothing is flagged. This reduces noise, never truth: a genuine
  // typo like `[[adr-999]]` still surfaces.
  const index = await buildLinkIndex();

  const danglingLinks: ConsistencyReport["danglingLinks"] = [];
  const staleDocs: ConsistencyReport["staleDocs"] = [];
  const proposedDocs: ConsistencyReport["proposedDocs"] = [];
  const now = Date.now();

  for (const doc of docs) {
    const src = await readMd(doc.path);
    if (src === null) continue;
    const { fm, body } = parseFrontmatter(src);
    // One broken reference per (source doc, target) — a doc that cites a missing
    // target ten times is one thing to fix, not ten. De-dupe within the doc.
    const seen = new Set<string>();
    for (const target of extractWikilinks(body)) {
      const key = target.trim();
      if (resolveWikilink(key, index) !== null) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      danglingLinks.push({ from: doc.slug, target: key });
    }
    if (fm.status === "proposed") {
      proposedDocs.push({ slug: doc.slug, title: doc.title });
    }
    if (fm.lastVerified) {
      const days = Math.floor((now - Date.parse(fm.lastVerified)) / 86_400_000);
      if (Number.isFinite(days) && days > 30) {
        staleDocs.push({ slug: doc.slug, lastVerified: fm.lastVerified, days });
      }
    }
  }

  const ungeneratedRegistries: string[] = [];
  for (const file of ["agents.json", "apps.json", "extensions.json"]) {
    const src = await readMd(join("registry", file));
    if (src && /"_generated"\s*:\s*false/.test(src)) ungeneratedRegistries.push(file);
  }

  // The app's own release version lives here (this app's cwd), not the control plane.
  let pkgVersion: string | null = null;
  let changelogVersion: string | null = null;
  try {
    pkgVersion =
      JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")).version ?? null;
  } catch {}
  try {
    const changelog = await readFile(join(process.cwd(), "CHANGELOG.md"), "utf8");
    changelogVersion = changelog.match(/##\s+(\d+\.\d+\.\d+)/)?.[1] ?? null;
  } catch {}
  const versionSkew_ = versionSkew({
    app: APP_VERSION,
    pkg: pkgVersion,
    changelog: changelogVersion,
  });

  const ok =
    danglingLinks.length === 0 &&
    proposedDocs.length === 0 &&
    ungeneratedRegistries.length === 0 &&
    staleDocs.length === 0 &&
    versionSkew_.length === 0;

  return {
    danglingLinks,
    proposedDocs,
    ungeneratedRegistries,
    staleDocs,
    versionSkew: versionSkew_,
    ok,
  };
}
