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
 * The `conversation_messages.type` discriminator (ADR-012). A plain `message`, or one of the
 * typed cards. `critical-update` and `needs-input` are the org's **async write-back** types
 * (work-064): a server-side process with no launched Claude session (the [[request-triage]]
 * routine, an agent) posts one straight into the thread. A `critical-update` is FYI — the
 * thread stays the org's (`working`); a `needs-input` parks the thread on the Owner
 * (`needs-you`) and is the "notable" signal the unread badge/notification center key off
 * (work-063). Additive on the existing column — no reshape.
 */
export type ThreadMessageType =
  | "message"
  | "outcome"
  | "generated-request"
  | "branch"
  | "critical-update"
  | "needs-input";

/**
 * The org write-back types that are **notable** — worth surfacing in the notification center
 * and driving the unread signal (work-063/064), distinct from routine chatter. `needs-input`
 * additionally parks the thread on the Owner; `critical-update` is FYI. Keep this the single
 * source of truth so the badge, the notification feed, and the thread cards agree.
 */
export const NOTABLE_MESSAGE_TYPES = ["needs-input", "critical-update"] as const;

/** Whether a message type is a notable org write-back (see {@link NOTABLE_MESSAGE_TYPES}). */
export function isNotableUpdate(type: string): boolean {
  return (NOTABLE_MESSAGE_TYPES as readonly string[]).includes(type);
}

/**
 * Whether a thread is archived (work-049) — orthogonal to `status`. Archived threads leave
 * the main Threads UI and all its groupings; they live in the Archive view until restored.
 */
export function isArchived(t: Thread): boolean {
  return t.archivedAt != null;
}

/**
 * The Owner's "needs-you" queue (work-030): threads parked on him, awaiting his turn.
 * Pure derivation over the stored `needs-you` state so the home badge and the Threads
 * surface read from one source of truth. Archived threads (work-049) never count toward the
 * queue or badge, even if their stored status is `needs-you`.
 */
export function needsYouThreads(threads: Thread[]): Thread[] {
  return threads.filter((t) => !isArchived(t) && (t.status as ThreadStatus) === "needs-you");
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
  // Archived threads (work-049) never appear in the main groupings — they live in the
  // Archive view. Filter here too so any caller of this pure helper is safe by default.
  const byRecent = [...threads]
    .filter((t) => !isArchived(t))
    .sort((a, b) => b.updatedAt - a.updatedAt);
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
