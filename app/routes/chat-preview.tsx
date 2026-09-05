import { type Edit, previewProposal, validateProposal } from "~/lib/sandbox.server";
import type { Route } from "./+types/chat-preview";

/**
 * ADR-009 preview endpoint: apply a proposal in an isolated worktree and return the
 * diff + proof the live app is untouched. No merge (that's work-016).
 */
export async function action({ request }: Route.ActionArgs) {
  const body = (await request.json()) as { edits?: unknown };
  const edits = (Array.isArray(body.edits) ? body.edits : []) as Edit[];

  const check = validateProposal(edits);
  if (!check.ok) return Response.json({ ok: false, error: check.error }, { status: 400 });

  const repoDir = process.env.PREVIEW_REPO_DIR ?? process.cwd();
  try {
    const result = await previewProposal(repoDir, { edits });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "preview failed" },
      { status: 500 },
    );
  }
}
