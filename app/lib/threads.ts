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

// --- Read-state & unread (work-063) --------------------------------------
// "Unread" is real, not derived from `status` alone (that was the only signal before). A
// thread has unread org activity when its newest org message (`role = agent`, so the Owner's
// own replies never mark his thread unread) is newer than when he last opened it. Opening a
// thread stamps `lastReadAt = now`, which clears its unread. These are pure so the badge count
// and the notification feed read from one definition; the DB shapes live in threads.server.ts.

/** The two timestamps that decide a thread's unread state (see {@link isUnread}). */
export type ThreadUnread = {
  /** The `at` of the thread's newest org (`role = agent`) message, or null if it has none. */
  lastOrgAt: number | null;
  /** When the Owner last opened the thread, or null if never. */
  lastReadAt: number | null;
};

/**
 * Whether a thread has **unread org activity**: it has an org message, and either the Owner
 * never opened it or its newest org message postdates his last open. Owner-only activity
 * (`lastOrgAt == null`) is never unread — a thread he just opened isn't "new" to him.
 */
export function isUnread(u: ThreadUnread): boolean {
  return u.lastOrgAt != null && (u.lastReadAt == null || u.lastOrgAt > u.lastReadAt);
}

/** How many threads have unread org activity — the persistent nav badge count (work-063). */
export function countUnread(items: Iterable<ThreadUnread>): number {
  let n = 0;
  for (const u of items) if (isUnread(u)) n++;
  return n;
}

// --- Notification center (work-063) --------------------------------------

/** What a notification row represents: a parked thread, or a specific notable org write-back. */
export type NotificationKind = "needs-you" | "needs-input" | "critical-update";

/** A single row in the notification center — always links back to its thread. */
export type NotificationItem = {
  threadId: number;
  title: string;
  kind: NotificationKind;
  /** The headline to show (the card's label, or the thread title for a bare needs-you). */
  label: string;
  /** Ordering key — the message time, or the thread's `updatedAt` for a bare needs-you. */
  ts: number;
  /** Whether the thread still has unread org activity (drives visual emphasis). */
  unread: boolean;
  href: string;
};

/** A thread as the notification builder needs it — plus its resolved read-state timestamps. */
export type NotifiableThread = {
  id: number;
  title: string;
  status: string;
  updatedAt: number;
  archivedAt: number | null;
  lastOrgAt: number | null;
  lastReadAt: number | null;
};

/** A notable org message as the builder needs it (a `critical-update` / `needs-input` row). */
export type NotifiableMessage = {
  conversationId: number;
  type: string;
  body: string;
  meta: string | null;
  at: number;
};

/**
 * What qualifies as **notification-worthy** (the signal, not the noise — work-063, refined to
 * kill the flood the Owner flagged). The notification center is an *attention* surface, so a
 * thread earns **at most one** row, chosen by priority:
 *
 *   1. BLOCKER — the thread is parked on the Owner (`status === "needs-you"`) OR its newest
 *      notable message is a `needs-input`. This is a genuine "your turn": a judgment call, a
 *      sign-off, a STOP-gate. Always shown, and it **persists until the thread is no longer
 *      parked** — a standing blocker doesn't clear just because he glanced at it. A
 *      `needs-input` card, when present, provides the richer label; otherwise the bare
 *      needs-you thread surfaces on its own.
 *   2. FYI — the thread has `critical-update`(s) and is NOT a blocker. `critical-update` keeps
 *      the org's turn; it's informational. So FYIs are **collapsed to the single newest update
 *      per thread** (a burst of progress pings on one thread is one row, never N) and shown
 *      **only while the thread has unread org activity**. Once the Owner opens the thread the
 *      FYI is consumed and drops out of the attention feed — it still lives in the thread's
 *      own history. This preserves the transparent-delegation signal (consequential updates do
 *      appear, once each, until seen) without the low-value repetition.
 *
 * Threads with neither a blocker nor an unread FYI never appear. Anything that isn't a
 * `needs-input` / `critical-update` card or a parked thread is routine chatter and is ignored
 * ({@link isNotableUpdate}). **Newest-first**, deterministic tie-break by thread id.
 *
 * Pure: the caller supplies threads (with resolved read-state) and the notable messages;
 * ordering, collapse, priority, and unread flags are decided here so they're unit-testable.
 */
export function buildNotifications(
  threads: NotifiableThread[],
  notableMessages: NotifiableMessage[],
): NotificationItem[] {
  const byId = new Map<number, NotifiableThread>();
  for (const t of threads) {
    if (t.archivedAt == null) byId.set(t.id, t);
  }
  const unreadOf = (t: NotifiableThread) =>
    isUnread({ lastOrgAt: t.lastOrgAt, lastReadAt: t.lastReadAt });

  // Collapse notable messages to the newest of each kind, per (non-archived) thread. This is
  // where a burst of same-thread updates becomes one signal instead of many rows.
  const newestNeedsInput = new Map<number, NotifiableMessage>();
  const newestCritical = new Map<number, NotifiableMessage>();
  for (const m of notableMessages) {
    if (!byId.has(m.conversationId)) continue; // unknown or archived thread → skip
    const bucket =
      m.type === "needs-input"
        ? newestNeedsInput
        : m.type === "critical-update"
          ? newestCritical
          : null;
    if (!bucket) continue; // not a notable write-back type
    const cur = bucket.get(m.conversationId);
    if (!cur || m.at > cur.at) bucket.set(m.conversationId, m);
  }

  const items: NotificationItem[] = [];
  for (const t of byId.values()) {
    const unread = unreadOf(t);
    const needsInput = newestNeedsInput.get(t.id);

    // (1) BLOCKER — parked on the Owner (via status or a needs-input card). Always shown.
    if (t.status === "needs-you" || needsInput) {
      if (needsInput) {
        const meta = parseMeta(needsInput.meta);
        items.push({
          threadId: t.id,
          title: threadTitle(t),
          kind: "needs-input",
          label: meta.label ?? needsInput.body ?? threadTitle(t),
          ts: needsInput.at,
          unread,
          href: `/threads/${t.id}`,
        });
      } else {
        items.push({
          threadId: t.id,
          title: threadTitle(t),
          kind: "needs-you",
          label: threadTitle(t),
          ts: t.updatedAt,
          unread,
          href: `/threads/${t.id}`,
        });
      }
      continue; // a thread earns at most one row; the blocker wins.
    }

    // (2) FYI — a single collapsed critical-update, only while unread (else it's consumed).
    const critical = newestCritical.get(t.id);
    if (critical && unread) {
      const meta = parseMeta(critical.meta);
      items.push({
        threadId: t.id,
        title: threadTitle(t),
        kind: "critical-update",
        label: meta.label ?? critical.body ?? threadTitle(t),
        ts: critical.at,
        unread: true,
        href: `/threads/${t.id}`,
      });
    }
  }

  // Newest-first; tie-break by thread id (desc) so ordering is deterministic.
  return items.sort((a, b) => b.ts - a.ts || b.threadId - a.threadId);
}
