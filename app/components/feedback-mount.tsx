import { mountFeedback } from "@scope-creep/ext-feedback";
import { useEffect, useRef } from "react";

/**
 * Client-side graft point for the portable feedback extension. SSR renders an empty
 * slot; the extension mounts into a Shadow DOM on the client and posts responses to
 * the Console's /feedback action.
 */
export function FeedbackMount({ contextKey, question }: { contextKey: string; question: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = mountFeedback(el, {
      contextKey,
      question,
      onSubmit: async ({ rating, comment }) => {
        await fetch("/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contextKey, rating, comment }),
        });
      },
    });
    return () => handle.destroy();
  }, [contextKey, question]);

  return <div ref={ref} className="feedback-slot" />;
}
