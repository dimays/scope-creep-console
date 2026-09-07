import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import { buildLinkIndex } from "./explore.server";
import { linkifyWikilinks } from "./wikilinks";

/**
 * Reads the control plane's work-item system of record (work/*.md) so the Console
 * can surface it as a board. Backend-first per ADR-005; read-only in v1. Sourced
 * live from SCOPE_CREEP_HOME (default ../scope-creep).
 */

function home(): string {
  return process.env.SCOPE_CREEP_HOME ?? join(process.cwd(), "..", "scope-creep");
}

export type WorkStatus = "proposed" | "active" | "blocked" | "done";

export type WorkItem = {
  id: string;
  title: string;
  type: string;
  status: WorkStatus;
  priority: string;
  owner: string;
  /** Employee-agent slugs staffed to this item (ADR-017). Empty when unstaffed. */
  assignees: string[];
  spec?: string;
  pr?: string;
  created: string;
  updated: string;
  file: string;
};

const STATUS_ORDER: WorkStatus[] = ["proposed", "active", "blocked", "done"];
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Parse a work item's flat `key: value` frontmatter (unit-tested). */
export function parseWorkFrontmatter(src: string): Record<string, string> {
  const fm: Record<string, string> = {};
  if (!src.startsWith("---")) return fm;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return fm;
  for (const line of src.slice(3, end).split("\n")) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (match) fm[match[1]] = match[2].trim();
  }
  return fm;
}

function toItem(fm: Record<string, string>, file: string): WorkItem {
  return {
    id: fm.id ?? file.replace(/\.md$/, ""),
    title: fm.title ?? "(untitled)",
    type: fm.type ?? "chore",
    status: (fm.status as WorkStatus) ?? "proposed",
    priority: fm.priority ?? "low",
    owner: fm.owner ?? "",
    assignees: (fm.assignees ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    spec: fm.spec || undefined,
    pr: fm.pr || undefined,
    created: fm.created ?? "",
    updated: fm.updated ?? "",
    file,
  };
}

export async function listWork(): Promise<WorkItem[]> {
  let files: string[];
  try {
    files = await readdir(join(home(), "work"));
  } catch {
    return [];
  }
  const items: WorkItem[] = [];
  for (const file of files) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const src = await readFile(join(home(), "work", file), "utf8");
    items.push(toItem(parseWorkFrontmatter(src), file));
  }
  return items.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
}

export type WorkColumn = { status: WorkStatus; label: string; items: WorkItem[] };

export async function board(): Promise<WorkColumn[]> {
  const items = await listWork();
  return STATUS_ORDER.map((status) => ({
    status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
    items: items.filter((item) => item.status === status),
  }));
}

function numericId(id: string): number {
  const match = /(\d+)/.exec(id);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** Shipped work, newest-first — the condensed history/changelog. */
export async function doneHistory(): Promise<WorkItem[]> {
  const items = await listWork();
  return items
    .filter((item) => item.status === "done")
    .sort((a, b) => numericId(b.id) - numericId(a.id));
}

export async function readWorkItem(id: string): Promise<{ item: WorkItem; html: string } | null> {
  const items = await listWork();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const src = await readFile(join(home(), "work", item.file), "utf8");
  const end = src.indexOf("\n---", 3);
  const body = end === -1 ? src : src.slice(end + 4);
  // Resolve wikilinks against the whole namespace (docs, work, agents, templates,
  // loops) instead of blindly pointing every one at /explore/docs — a work item's
  // body is mostly `[[work-NNN]]` / `[[adr-NNN]]` cross-references, which the old
  // rule sent to 404ing doc URLs.
  const linked = linkifyWikilinks(body, await buildLinkIndex());
  return { item, html: await marked.parse(linked) };
}
