/**
 * Control-plane authoring (ADR-017): assemble the {path, content} edits for spinning up
 * an employee or creating/modifying a template, then hand them to the SAME gated
 * preview → PR machinery the chatbot uses (`sandbox.server`) — only pointed at the
 * control-plane repo instead of this app. Never merges; the Owner approves the PR.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addAssignee,
  type EmployeeSpec,
  employeeFilePath,
  renderEmployeeManifest,
} from "./employee-scaffold";
import type { Edit } from "./sandbox.server";
import { renderTemplateManifest, type TemplateSpec, templateFilePath } from "./template-scaffold";
import { listWork } from "./work.server";

/** The control-plane repo (its git root) — same location the read-only surfaces use. */
export function controlPlaneRepoDir(): string {
  return process.env.SCOPE_CREEP_HOME ?? join(process.cwd(), "..", "scope-creep");
}

/**
 * The edits to spin up an employee: the manifest, plus an `assignees` edit to each
 * chosen ticket (re-read live so we never clobber concurrent staffing). Unknown ticket
 * ids are skipped.
 */
export async function employeeEdits(spec: EmployeeSpec): Promise<Edit[]> {
  const repo = controlPlaneRepoDir();
  const edits: Edit[] = [
    { path: employeeFilePath(spec.name), content: renderEmployeeManifest(spec) },
  ];
  const tickets = spec.tickets ?? [];
  if (tickets.length > 0) {
    const work = await listWork();
    const byId = new Map(work.map((w) => [w.id, w]));
    for (const id of tickets) {
      const item = byId.get(id);
      if (!item) continue;
      const rel = `work/${item.file}`;
      const current = await readFile(join(repo, rel), "utf8");
      const next = addAssignee(current, spec.name);
      if (next !== current) edits.push({ path: rel, content: next });
    }
  }
  return edits;
}

/** The single edit to create/replace a template manifest. */
export function templateEdits(spec: TemplateSpec): Edit[] {
  return [{ path: templateFilePath(spec.name), content: renderTemplateManifest(spec) }];
}
