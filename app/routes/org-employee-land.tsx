import { controlPlaneRepoDir, employeeEdits } from "~/lib/authoring.server";
import { displayName, type EmployeeSpec } from "~/lib/employee-scaffold";
import { landProposal, validateProposal } from "~/lib/sandbox.server";
import type { Route } from "./+types/org-employee-land";
import { validateSpec } from "./org-employee-preview";

/**
 * Approve "spin up employee" (ADR-017): re-derive the edits from the spec (never trust
 * client-sent file bodies), build them on an isolated branch of the CONTROL PLANE repo,
 * and open a GATED PR. Does NOT merge.
 */
export async function action({ request }: Route.ActionArgs) {
  const spec = (await request.json()) as Partial<EmployeeSpec>;
  const err = validateSpec(spec);
  if (err) return Response.json({ ok: false, error: err }, { status: 400 });

  try {
    const edits = await employeeEdits(spec as EmployeeSpec);
    const check = validateProposal(edits);
    if (!check.ok) return Response.json({ ok: false, error: check.error }, { status: 400 });

    const name = displayName(spec.name as string);
    const title = `Spin up employee: ${name} (${spec.template}) → ${spec.reportsTo}`;
    const staffed = (spec.tickets ?? []).length;
    const body = [
      `Instantiates the **${spec.template}** template as \`${spec.name}\`, reporting to \`${spec.reportsTo}\`.`,
      staffed > 0 ? `Staffed to: ${(spec.tickets ?? []).join(", ")}.` : "Not yet staffed.",
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
