// Pure types + helpers for CoS-Threads (work-029, ADR-012) — no server/db imports, so
// they're safe to import from route components (client bundle) and unit-testable. The
// DB layer lives in threads.server.ts. (Same split as human-input.ts / human-input.server.ts.)
import type { Conversation, ConversationMessage } from "~/db/schema";

/** A thread's lifecycle/turn: `open → (needs-you | working) → closed`. */
export type ThreadStatus = "open" | "needs-you" | "working" | "closed";
/** Who opened a thread: the Owner, or the `org` (a CoS-initiated thread — work-030). */
export type ThreadInitiator = "owner" | "org";
export type Thread = Conversation;
export type ThreadMessage = ConversationMessage;

/**
 * The Owner's "needs-you" queue (work-030): threads parked on him, awaiting his turn.
 * Pure derivation over the stored `needs-you` state so the home badge and the Threads
 * surface read from one source of truth.
 */
export function needsYouThreads(threads: Thread[]): Thread[] {
  return threads.filter((t) => (t.status as ThreadStatus) === "needs-you");
}

export type ThreadGroups = {
  /** Parked on the Owner — his turn. The "needs-you" queue. */
  needsYou: Thread[];
  /** The org is acting (`working`) or a thread is freshly `open`. */
  active: Thread[];
  /** Terminal — `closed` (reopenable by a followup). */
  closed: Thread[];
};

/**
 * Partition threads into the needs-you queue, active, and closed — each newest-updated
 * first — so the Threads surface can show "waiting on you" distinctly from working/closed
 * (work-030 acceptance). A thread is in exactly one group.
 */
export function groupThreads(threads: Thread[]): ThreadGroups {
  const byRecent = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  const groups: ThreadGroups = { needsYou: [], active: [], closed: [] };
  for (const t of byRecent) {
    const status = t.status as ThreadStatus;
    if (status === "needs-you") groups.needsYou.push(t);
    else if (status === "closed") groups.closed.push(t);
    else groups.active.push(t); // `working` | `open`
  }
  return groups;
}

/** A lightweight parent↔child link for a branched thread (work-032). */
export type BranchLink = {
  id: number;
  title: string;
};

/** Optional typed-card payload carried in `conversation_messages.meta` (JSON). */
export type MessageMeta = {
  /** Original author label when a non-owner message was normalized to role `agent`. */
  author?: string;
  /**
   * For a typed card (`outcome`, `generated-request`, `branch`): the card's headline and a
   * deep link to its artifact (the created ticket/PRD, or the child thread for a `branch`).
   */
  label?: string;
  refUrl?: string;
  /** Optional short label for the deep link (e.g. the ticket id `work-032`). */
  refLabel?: string;
  /** For a `branch` card in a parent: the child thread it points to (work-032). */
  childThreadId?: number;
  childThreadTitle?: string;
};

/** A branched thread's title reads plainly when empty. */
export function threadTitle(t: { title: string }): string {
  return t.title || "Untitled thread";
}

export function parseMeta(raw: string | null): MessageMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MessageMeta;
  } catch {
    return {};
  }
}
