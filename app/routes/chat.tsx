import { ChatMount } from "~/components/chat-mount";
import type { Route } from "./+types/chat";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Chat · Scope Creep" }];
}

export default function Chat() {
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Chat</h1>
        </div>
        <p className="console__meta">shell preview — agent backend in work-014</p>
      </header>
      <ChatMount />
    </main>
  );
}
