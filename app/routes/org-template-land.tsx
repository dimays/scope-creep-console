import { controlPlaneRepoDir, templateEdits } from "~/lib/authoring.server";
import { landProposal, validateProposal } from "~/lib/sandbox.server";
import { displayName, type TemplateSpec } from "~/lib/template-scaffold";
import type { Route } from "./+types/org-template-land";
import { validateTemplateSpec } from "./org-template-preview";

/**
 * Approve "create / modify template" (ADR-017): re-render the manifest from the spec,
 * build it on an isolated branch of the CONTROL PLANE repo, and open a GATED PR. Does
 * NOT merge.
 */
export async function action({ request }: Route.ActionArgs) {
  const spec = (await request.json()) as Partial<TemplateSpec>;
  const err = validateTemplateSpec(spec);
  if (err) return Response.json({ ok: false, error: err }, { status: 400 });

  try {
    const edits = templateEdits(spec as TemplateSpec);
    const check = validateProposal(edits);
    if (!check.ok) return Response.json({ ok: false, error: check.error }, { status: 400 });

    const title = `Employee template: ${displayName(spec.name as string)}`;
    const body = [
      `Adds/updates the \`${spec.name}\` employee template, owned by \`${spec.ownerAgent}\`.`,
      "",
      "Authored via the Console org view (ADR-017). Review the diff and merge to ratify.",
    ].join("\n");

    const result = await landProposal(controlPlaneRepoDir(), { edits }, { title, body });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "land failed" },
      { status: 500 },
    );
  }
}
