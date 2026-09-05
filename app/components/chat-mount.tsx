import { mountChat } from "@scope-creep/ext-chatbot";
import { useEffect, useRef } from "react";

/**
 * Client-side graft of the portable chat shell (work-013). SSR renders an empty
 * slot; the extension mounts into a Shadow DOM on the client. The `onSend` here is a
 * STUB — the real agent runtime is work-014.
 */
export function ChatMount() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chat = mountChat(el, {
      title: "Edit this app",
      greeting:
        "This is the chat shell (work-013), grafted via Shadow DOM and themed by the host tokens. The agent backend arrives in work-014 — for now I just echo.",
      placeholder: "Describe a change…",
      onSend: async (text) => `Shell preview — backend pending (work-014). You said: "${text}"`,
    });
    return () => chat.destroy();
  }, []);

  return <div ref={ref} className="chat-slot" />;
}
