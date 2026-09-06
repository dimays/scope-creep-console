import { controlPlaneRepoDir, employeeEdits } from "~/lib/authoring.server";
import type { EmployeeSpec } from "~/lib/employee-scaffold";
import { isValidSlug } from "~/lib/employee-scaffold";
import { previewProposal, validateProposal } from "~/lib/sandbox.server";
import type { Route } from "./+types/org-employee-preview";

/**
 * Preview "spin up employee" (ADR-017): deterministically build the employee manifest +
 * assignee edits from the form spec, apply them in an isolated worktree of the CONTROL
 * PLANE repo, and return the diff. Never merges — the Owner approves the gated PR.
 */
export async function action({ request }: Route.ActionArgs) {
  const spec = (await request.json()) as Partial<EmployeeSpec>;
  const err = validateSpec(spec);
  if (err) return Response.json({ ok: false, error: err }, { status: 400 });

  try {
    const edits = await employeeEdits(spec as EmployeeSpec);
    const check = validateProposal(edits);
    if (!check.ok) return Response.json({ ok: false, error: check.error }, { status: 400 });
    const result = await previewProposal(controlPlaneRepoDir(), { edits });
    return Response.json({ ok: true, ...result, fileCount: edits.length });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "preview failed" },
      { status: 500 },
    );
  }
}

export function validateSpec(spec: Partial<EmployeeSpec>): string | null {
  if (!spec.name || !isValidSlug(spec.name)) return "name must be a kebab-case slug";
  if (!spec.template) return "template is required";
  if (!spec.reportsTo) return "reportsTo (executive) is required";
  if (!spec.description?.trim()) return "description is required";
  return null;
}
