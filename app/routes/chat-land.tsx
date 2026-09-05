import { type Edit, landProposal, validateProposal } from "~/lib/sandbox.server";
import type { Route } from "./+types/chat-land";

/**
 * Approve a proposal (ADR-009): open a gated PR for it. Never merges — the merge is
 * the Owner's gated action.
 */
export async function action({ request }: Route.ActionArgs) {
  const body = (await request.json()) as { edits?: unknown; title?: unknown; body?: unknown };
  const edits = (Array.isArray(body.edits) ? body.edits : []) as Edit[];
  const title =
    String(body.title ?? "")
      .trim()
      .slice(0, 200) || "Chat proposal";

  const check = validateProposal(edits);
  if (!check.ok) return Response.json({ ok: false, error: check.error }, { status: 400 });

  const repoDir = process.env.PREVIEW_REPO_DIR ?? process.cwd();
  try {
    const result = await landProposal(
      repoDir,
      { edits },
      {
        title,
        body: body.body ? String(body.body).slice(0, 2000) : undefined,
      },
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "land failed" },
      { status: 500 },
    );
  }
}
