/**
 * Deterministic employee-manifest generation (ADR-017). The "spin up employee" flow is
 * structured, not model-driven: given a form spec it produces the exact control-plane
 * files to propose — the employee manifest plus `assignees` edits to the chosen tickets.
 * Pure and unit-tested; the server route feeds these edits to the same gated
 * preview → PR machinery the chatbot uses (sandbox.server), pointed at the control plane.
 */

export type EmployeeSpec = {
  /** kebab-case slug; also the manifest filename. */
  name: string;
  /** template slug this employee is instantiated from. */
  template: string;
  /** the exec (agent slug) that spun it up / it reports to. */
  reportsTo: string;
  /** one-line description for the manifest + registry. */
  description: string;
  /** optional freeform current-mandate paragraph. */
  mandate?: string;
  /** work-item ids to staff to (e.g. ["work-045"]). */
  tickets?: string[];
  /** ISO date (YYYY-MM-DD); defaults handled by caller/tests. */
  created?: string;
};

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

/** Normalize arbitrary text into a safe kebab-case slug. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** "ada" → "Ada"; "tech-writer" → "Tech Writer". */
export function displayName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function employeeFilePath(slug: string): string {
  return `agents/employees/${slug}.md`;
}

/** The employee `.md` manifest — matches the seed employees' shape and passes docs-lint. */
export function renderEmployeeManifest(spec: EmployeeSpec): string {
  const created = spec.created ?? new Date().toISOString().slice(0, 10);
  const name = displayName(spec.name);
  const tickets = spec.tickets ?? [];
  const mandate = spec.mandate?.trim();

  const mandateBlock = mandate
    ? `${mandate}\n`
    : tickets.length > 0
      ? "Current mandate:\n"
      : "Spun up and available; **not yet staffed** to a ticket.\n";

  const ticketLines = tickets.length > 0 ? `${tickets.map((t) => `- [[${t}]]`).join("\n")}\n` : "";

  return `---
name: ${spec.name}
description: ${spec.description}
metadata:
  type: reference
  status: active
  version: 1.0.0
  owner_agent: ${spec.reportsTo}
  last_verified: ${created}
kind: employee
reports_to: ${spec.reportsTo}
template: ${spec.template}
created: ${created}
---

# ${name}

Instantiated from [[${spec.template}]] by the [[${spec.reportsTo}]] and ratified by the
[[chief-of-staff]] ([[adr-017]]).

## Current mandate
${mandateBlock}${ticketLines}
Inherits the [[${spec.template}]] operating manual.
`;
}

/**
 * Add an assignee slug to a work item's flat frontmatter. If an `assignees:` line
 * exists, append the slug (idempotent); otherwise insert the line after `owner:`.
 * Returns the file unchanged if the slug is already present. Pure + unit-tested.
 */
export function addAssignee(fileContent: string, slug: string): string {
  if (!fileContent.startsWith("---")) return fileContent;
  const end = fileContent.indexOf("\n---", 3);
  if (end === -1) return fileContent;
  const head = fileContent.slice(0, end);
  const rest = fileContent.slice(end);
  const lines = head.split("\n");

  const idx = lines.findIndex((l) => /^assignees:\s*/.test(l));
  if (idx !== -1) {
    const current = lines[idx]
      .replace(/^assignees:\s*/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (current.includes(slug)) return fileContent; // already staffed
    current.push(slug);
    lines[idx] = `assignees: ${current.join(", ")}`;
    return lines.join("\n") + rest;
  }

  const ownerIdx = lines.findIndex((l) => /^owner:\s*/.test(l));
  const insertAt = ownerIdx !== -1 ? ownerIdx + 1 : lines.length;
  lines.splice(insertAt, 0, `assignees: ${slug}`);
  return lines.join("\n") + rest;
}
