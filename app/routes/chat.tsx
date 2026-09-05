import { ChatMount } from "~/components/chat-mount";
import { getOrCreateConversation, listMessages } from "~/lib/conversation.server";
import type { Route } from "./+types/chat";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Chat · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const conversationId = await getOrCreateConversation("chat", "Console chat");
  const messages = await listMessages(conversationId);
  return { messages };
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
