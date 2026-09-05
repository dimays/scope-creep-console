import { declineProposal } from "~/lib/sandbox.server";
import type { Route } from "./+types/chat-decline";

/** Decline a proposal: close its PR and delete the branch. */
export async function action({ request }: Route.ActionArgs) {
  const body = (await request.json()) as { branch?: unknown };
  const branch = String(body.branch ?? "").trim();
  // Only ever touch chat-proposal branches.
  if (!branch.startsWith("chat/")) {
    return Response.json({ ok: false, error: "invalid branch" }, { status: 400 });
  }
  const repoDir = process.env.PREVIEW_REPO_DIR ?? process.cwd();
  try {
    await declineProposal(repoDir, branch);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "decline failed" },
      { status: 500 },
    );
  }
}
