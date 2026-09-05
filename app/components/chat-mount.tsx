import { mountChat, normalizeRole } from "@scope-creep/ext-chatbot";
import { useEffect, useRef } from "react";

type InitialMessage = { role: string; body: string };

/**
 * Client-side graft of the chat shell (work-013), wired to the real agent-turn
 * endpoint (work-014). SSR renders an empty slot; the extension mounts on the
 * client and posts to /chat.
 */
export function ChatMount({ initialMessages }: { initialMessages: InitialMessage[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chat = mountChat(el, {
      title: "Console assistant",
      placeholder: "Ask about the platform…",
      messages: initialMessages.map((m) => ({ role: normalizeRole(m.role), body: m.body })),
      onSend: async (text) => {
        const res = await fetch("/chat/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = (await res.json()) as { reply?: string };
        return data.reply ?? "(no reply)";
      },
    });
    return () => chat.destroy();
  }, [initialMessages]);

  return <div ref={ref} className="chat-slot" />;
}
