// Pure types + helpers for CoS-Threads (work-029, ADR-012) — no server/db imports, so
// they're safe to import from route components (client bundle) and unit-testable. The
// DB layer lives in threads.server.ts. (Same split as human-input.ts / human-input.server.ts.)
import type { Conversation, ConversationMessage } from "~/db/schema";

/** A thread's lifecycle/turn: `open → (needs-you | working) → closed`. */
export type ThreadStatus = "open" | "needs-you" | "working" | "closed";
export type Thread = Conversation;
export type ThreadMessage = ConversationMessage;

/** Optional typed-card payload carried in `conversation_messages.meta` (JSON). */
export type MessageMeta = {
  /** Original author label when a non-owner message was normalized to role `agent`. */
  author?: string;
  /** For a `type = "outcome"` card: the outcome label and a deep link to its artifact. */
  label?: string;
  refUrl?: string;
};

export function parseMeta(raw: string | null): MessageMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MessageMeta;
  } catch {
    return {};
  }
}
