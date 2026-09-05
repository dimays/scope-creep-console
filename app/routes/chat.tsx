import { ChatMount } from "~/components/chat-mount";
import { agentTurn, getOrCreateConversation, listMessages } from "~/lib/conversation.server";
import type { Route } from "./+types/chat";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Chat · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const conversationId = await getOrCreateConversation("chat", "Console chat");
  const messages = await listMessages(conversationId);
  return { messages };
}

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

export default function Chat({ loaderData }: Route.ComponentProps) {
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Chat</h1>
        </div>
        <p className="console__meta">in-app assistant · work-014</p>
      </header>
      <ChatMount initialMessages={loaderData.messages} />
    </main>
  );
}
