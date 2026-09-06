import { controlPlaneRepoDir, templateEdits } from "~/lib/authoring.server";
import { previewProposal, validateProposal } from "~/lib/sandbox.server";
import { isValidSlug, type TemplateSpec } from "~/lib/template-scaffold";
import type { Route } from "./+types/org-template-preview";

/**
 * Preview "create / modify template" (ADR-017): render the template manifest from the
 * form spec, apply it in an isolated worktree of the CONTROL PLANE repo, and return the
 * diff. Never merges.
 */
export async function action({ request }: Route.ActionArgs) {
  const spec = (await request.json()) as Partial<TemplateSpec>;
  const err = validateTemplateSpec(spec);
  if (err) return Response.json({ ok: false, error: err }, { status: 400 });

  try {
    const edits = templateEdits(spec as TemplateSpec);
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

export function validateTemplateSpec(spec: Partial<TemplateSpec>): string | null {
  if (!spec.name || !isValidSlug(spec.name)) return "name must be a kebab-case slug";
  if (!spec.description?.trim()) return "description is required";
  if (!spec.ownerAgent) return "ownerAgent (owning executive) is required";
  return null;
}
