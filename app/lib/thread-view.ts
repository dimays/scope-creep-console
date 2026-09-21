// Pure, client-safe helpers for the thread timeline's per-message visibility (work-089).
// No node/fs/db imports, so these are safe to import from the route component (client
// bundle) and are trivially unit-testable. Same split as threads.ts / claude-sessions.ts.
//
// The bug (work-089): once a thread is `launched`, thread.tsx hid EVERY plain message on the
// assumption the projected transcript (local Claude Code session JSONL, ADR-016) would show
// them. But a cloud-launched thread has NO local JSONL, so the projection is empty — and the
// Owner's original seed prompt (the first `role:"owner" type:"message"` record) then rendered
// NOWHERE. The Owner opened the thread and their own ask was gone.
//
// The rule these helpers encode: when launched, render a plain message ONLY if it is the seed
// AND the projected transcript has no turns to show it. The transcript's turns already include
// the opener, so when it IS showing turns we keep hiding the seed to avoid a duplicate.

import type { ProjectedTurn, ProjectionStatus } from "~/lib/claude-sessions";

/** The minimal projection shape this module reasons about (see `ThreadProjection`). */
type ProjectionLike = {
  status: ProjectionStatus;
  turns: ProjectedTurn[];
};

/** The minimal timeline-message shape this module reasons about (see `ThreadMessage`). */
type MessageLike = {
  id: number;
  role: string;
  type: string;
};

/**
 * Whether the projected transcript is actually showing turns. Only a `matched` projection
 * with at least one turn counts — a `pending`/`unmatched` projection, or a matched-but-empty
 * session (a cloud launch with no local JSONL), shows nothing and must NOT suppress the seed.
 */
export function projectionHasTurns(projection: ProjectionLike): boolean {
  return projection.status === "matched" && projection.turns.length > 0;
}

/**
 * Whether a message is the thread's seed — the Owner's first plain `message`, the original ask.
 * `seedMessageId` is computed in the component as the id of that record (or null/undefined when
 * there isn't one).
 */
export function isSeedMessage(msg: MessageLike, seedMessageId: number | null | undefined): boolean {
  return (
    msg.role === "owner" &&
    msg.type === "message" &&
    seedMessageId != null &&
    msg.id === seedMessageId
  );
}

/**
 * Per-message visibility when a thread is launched. A launched thread's conversation lives in
 * the projected transcript (ADR-016), so plain messages are hidden to avoid duplication — with
 * ONE exception: the Owner's seed stays visible whenever the transcript has no turns to show it
 * (work-089), so a cloud-launched thread never swallows the Owner's original ask.
 *
 * Typed cards (outcome / generated-request / branch / critical-update / needs-input) are NOT
 * governed by this helper — they render before the `launched` check in thread.tsx and are
 * unaffected. Pass only plain (`type: "message"`) rows here.
 */
export function shouldRenderWhenLaunched(
  msg: MessageLike,
  opts: { seedMessageId: number | null | undefined; projectionHasTurns: boolean },
): boolean {
  return isSeedMessage(msg, opts.seedMessageId) && !opts.projectionHasTurns;
}
