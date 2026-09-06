import { getOrCreateConversation, listMessages } from "~/lib/conversation.server";
import { effectiveChatModel } from "~/lib/models.server";
import { proposeEdits } from "~/lib/propose.server";
import { previewProposal, validateProposal } from "~/lib/sandbox.server";
import type { Route } from "./+types/chat-propose";

/**
 * work-017 part 1: turn a natural-language request into a concrete, isolated proposal.
 *
 * NL request → agent tool loop produces `{path, content}` edits → ADR-009 path-safety
 * gate → isolated-worktree preview (diff + proof the live app is untouched). Nothing is
 * applied or merged here: the returned `edits` go to /chat/land (gated PR) on approval,
 * exactly the work-016 flow. Never auto-applies.
 */
export async function action({ request }: Route.ActionArgs) {
  const { text } = (await request.json()) as { text?: unknown };
  const clean = String(text ?? "")
    .trim()
    .slice(0, 5000);
  if (!clean) return Response.json({ ok: false, error: "empty request" }, { status: 400 });

  const repoDir = process.env.PREVIEW_REPO_DIR ?? process.cwd();
  const model = await effectiveChatModel();
  // Proposals are conversation-aware: reuse the chat thread's history for context,
  // without mutating it (proposing isn't a normal chat turn).
  const history = await listMessages(await getOrCreateConversation("chat", "Console chat"));

  const result = await proposeEdits(history, clean, { model, repoDir });
  if (!result.proposal) {
    // No edits: no key, a prose-only answer, or the loop hit its step cap. Surface why.
    return Response.json({ ok: false, reason: result.reason, text: result.text });
  }

  const check = validateProposal(result.proposal.edits);
  if (!check.ok) {
    return Response.json({
      ok: false,
      reason: "unsafe",
      error: check.error,
      text: result.text,
    });
  }

  try {
    const preview = await previewProposal(repoDir, { edits: result.proposal.edits });
    return Response.json({
      ok: true,
      title: result.proposal.title,
      summary: result.proposal.summary,
      edits: result.proposal.edits,
      text: result.text,
      diff: preview.diff,
      liveClean: preview.liveClean,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        reason: "preview_failed",
        error: err instanceof Error ? err.message : "preview failed",
        text: result.text,
      },
      { status: 500 },
    );
  }
}
