import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";

/**
 * Reads the Scope Creep control plane (docs, agents, ledger, registries) so the
 * Console can explain the platform to the Owner — read-only, sourced live from
 * SCOPE_CREEP_HOME (default ../scope-creep). See product/console-explore.prd.md.
 */

function home(): string {
  return process.env.SCOPE_CREEP_HOME ?? join(process.cwd(), "..", "scope-creep");
}

const DISPLAY_NAMES: Record<string, string> = {
  "chief-of-staff": "Chief of Staff",
  cto: "CTO",
  "chief-designer": "Chief Designer",
  "chief-knowledge-manager": "Chief Knowledge Manager",
  "chief-product-officer": "Chief Product Officer",
};

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

export type AgentProfile = {
  name: string;
  displayName: string;
  description: string;
  status?: string;
  charterHtml: string;
  contributions: LedgerEntry[];
};

export async function readAgent(name: string): Promise<AgentProfile | null> {
  const src = await readMd(join("agents", `${name}.md`));
  if (src === null) return null;
  const { fm, body } = parseFrontmatter(src);
  const docs = await listDocs();
  const charterHtml = await renderMarkdown(body, new Set(docs.map((d) => d.slug)));

  const display = DISPLAY_NAMES[name] ?? name;
  const contributions: LedgerEntry[] = [];
  for (const entry of await listLedger()) {
    const entrySrc = await readMd(join("ledger", entry.file));
    if (entrySrc && (entrySrc.includes(display) || entrySrc.includes(name))) {
      contributions.push(entry);
    }
  }

  return {
    name,
    displayName: display,
    description: fm.description ?? "",
    status: fm.status,
    charterHtml,
    contributions,
  };
}

// --- consistency ("what's out of sync") ----------------------------------

export type ConsistencyReport = {
  danglingLinks: Array<{ from: string; target: string }>;
  proposedDocs: Array<{ slug: string; title: string }>;
  ungeneratedRegistries: string[];
  staleDocs: Array<{ slug: string; lastVerified: string; days: number }>;
  ok: boolean;
};

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

  const ok =
    danglingLinks.length === 0 &&
    proposedDocs.length === 0 &&
    ungeneratedRegistries.length === 0 &&
    staleDocs.length === 0;

  return { danglingLinks, proposedDocs, ungeneratedRegistries, staleDocs, ok };
}
