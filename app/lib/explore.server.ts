import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import { agentDisplayName, DISPLAY_NAMES } from "./display-name";
import { type TicketRef, ticketsFor } from "./org.server";
import { readRegistry } from "./registry.server";
import { APP_VERSION } from "./version";
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
  { dir: "environments", group: "Environments" },
  { dir: "ledger", group: "Ledger" },
];

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
      if (!file.endsWith(".md")) continue;
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
      });
    }
  }
  return docs;
}

async function renderMarkdown(body: string, slugs: Set<string>): Promise<string> {
  const linked = body.replace(/\[\[([^\]]+)\]\]/g, (_full, ref: string) => {
    const [target, alias] = ref.split("|");
    const key = target.trim();
    const label = (alias ?? target).trim();
    return slugs.has(key) ? `[${label}](/explore/docs/${key})` : `\`[[${ref}]]\``;
  });
  return await marked.parse(linked);
}

export async function readDoc(slug: string): Promise<{ doc: DocRecord; html: string } | null> {
  const docs = await listDocs();
  const doc = docs.find((d) => d.slug === slug);
  if (!doc) return null;
  const src = await readMd(doc.path);
  if (src === null) return null;
  const { body } = parseFrontmatter(src);
  const html = await renderMarkdown(body, new Set(docs.map((d) => d.slug)));
  return { doc, html };
}

export type LedgerEntry = {
  slug: string;
  title: string;
  order: number;
  file: string;
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
    entries.push({
      slug: fm.name ?? file.replace(/\.md$/, ""),
      title: firstHeading(body, fm.name ?? file),
      order: Number.parseInt(file, 10) || 0,
      file,
    });
  }
  return entries.sort((a, b) => b.order - a.order);
}

export { agentDisplayName };

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

export type AgentProfile = {
  name: string;
  displayName: string;
  description: string;
  status?: string;
  charterHtml: string;
  contributions: LedgerEntry[];
  loopsOwned: LoopRecord[];
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
  const docs = await listDocs();
  const charterHtml = await renderMarkdown(body, new Set(docs.map((d) => d.slug)));

  const display = DISPLAY_NAMES[name] ?? firstHeading(body, agentDisplayName(name));
  const contributions: LedgerEntry[] = [];
  for (const entry of await listLedger()) {
    const entrySrc = await readMd(join("ledger", entry.file));
    if (entrySrc && (entrySrc.includes(display) || entrySrc.includes(name))) {
      contributions.push(entry);
    }
  }

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
  const docs = await listDocs();
  const manualHtml = await renderMarkdown(body, new Set(docs.map((d) => d.slug)));
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
  const slugs = new Set(docs.map((d) => d.slug));

  const danglingLinks: ConsistencyReport["danglingLinks"] = [];
  const staleDocs: ConsistencyReport["staleDocs"] = [];
  const proposedDocs: ConsistencyReport["proposedDocs"] = [];
  const now = Date.now();

  for (const doc of docs) {
    const src = await readMd(doc.path);
    if (src === null) continue;
    const { fm, body } = parseFrontmatter(src);
    for (const target of extractWikilinks(body)) {
      if (!slugs.has(target)) danglingLinks.push({ from: doc.slug, target });
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
