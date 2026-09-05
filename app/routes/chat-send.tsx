import { agentTurn, getOrCreateConversation } from "~/lib/conversation.server";
import type { Route } from "./+types/chat-send";

/**
 * Resource route (action only, no component) — returns raw JSON to the chat shell's
 * fetch. (A UI route re-renders the page instead of returning the action's Response.)
 */
export async function action({ request }: Route.ActionArgs) {
  const { text } = (await request.json()) as { text?: unknown };
  const clean = String(text ?? "")
    .trim()
    .slice(0, 5000);
  if (!clean) return Response.json({ reply: "" }, { status: 400 });
  const conversationId = await getOrCreateConversation("chat", "Console chat");
  const reply = await agentTurn(conversationId, clean);
  return Response.json({ reply });
}
