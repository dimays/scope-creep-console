/**
 * The **work-sweep** loop's pure mechanics (work-087, [[work-sweep]] loop,
 * [[prd-autonomous-execution-loop]]).
 *
 * ## What this module is
 * Two standing, machine-checkable functions the scheduled execution loop leans on:
 *
 * 1. **{@link evaluateMilestone}** — the *milestone rule*. The PRD defines the loop as
 *    "run continuously, stop only at a blocker or a milestone." Blockers are already fully
 *    specified (the [[adr-022]] escalation checklist ∪ the [[ticket-cycle]] STOP checklist);
 *    **milestones were undefined**. This predicate is the crisp definition: the exact four
 *    triggers quoted from the PRD's stop-rule table, evaluated after each ticket flips
 *    terminal. It fires on each of the four and on nothing else.
 * 2. **{@link decideCadence}** + **{@link renderCadenceDecision}** — the *cadence-decision
 *    self-tune protocol*. Between runs the sweep's frequency self-tunes on signal (never a
 *    hard-coded guess), the same protocol [[staffing-review]] / [[roadmap]] / [[evolve]] /
 *    [[request-triage]] use: decide the next interval from live signals, clamp to policy
 *    bounds, and emit a greppable `cadence-decision` block to the [[ledger]].
 *
 * ## Purity is the contract
 * This is the foundation the work-086 runner imports, so it is **pure and dependency-free** —
 * no db, no fs, no server imports, client-safe. It operates over minimal *structural* input
 * types (defined here, not imported from `work.server.ts`) so it never drags server code into
 * a pure module. The runner is responsible for reading the board and populating these shapes
 * (e.g. resolving each ticket's `group` from its spec/theme); this module only *judges*.
 * Mirrors the `triage.server.ts` discipline: small pure functions, thorough doc-comments,
 * deterministic and unit-testable.
 *
 * ## Policy vs. state (why constants live here but bounds are injected)
 * Cadence **policy** — the seed and `cadence_bounds` — lives in the [[work-sweep]] manifest
 * and moves only by [[core-upgrade]]; it is passed in as {@link CadenceBounds}, never
 * hardcoded. The **shape** of the tuning response (the directions and gains below) is loop
 * mechanism and lives here. Cadence **state** — the live interval — lives in the ledger, read
 * back from the most recent {@link renderCadenceDecision} block, not duplicated in config.
 */

// --- Shared vocabulary ----------------------------------------------------

/** Ticket priority. Rank: high=0, medium=1, low=2 (see {@link priorityRank}). */
export type Priority = "high" | "medium" | "low";

/**
 * Work-board lifecycle status, as the milestone rule partitions it:
 * - **TERMINAL** = `done | superseded | dropped` — the ticket is finished for good.
 * - **WORKABLE** = `proposed | active` — the autonomous backlog the sweep can pull.
 * - `blocked` is **parked**: neither terminal nor workable/ready. A blocked sibling means a
 *   theme is *not* complete and a blocked ticket is *not* part of the ready backlog.
 */
export type SweepStatus = "proposed" | "active" | "blocked" | "done" | "superseded" | "dropped";

/** Statuses that count as finished-for-good. A ticket is terminal iff its status is one of these. */
const TERMINAL_STATUSES: readonly SweepStatus[] = ["done", "superseded", "dropped"];

/** Statuses that count as the pullable backlog. A ticket is workable iff its status is one of these. */
const WORKABLE_STATUSES: readonly SweepStatus[] = ["proposed", "active"];

/** A finished-for-good ticket ({@link TERMINAL_STATUSES}). */
export function isTerminal(status: SweepStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** A pullable/ready ticket ({@link WORKABLE_STATUSES}); `blocked` is parked, so it is neither. */
export function isWorkable(status: SweepStatus): boolean {
  return WORKABLE_STATUSES.includes(status);
}

/** Priority rank — smaller is higher priority. Mirrors `work.server.ts`'s `PRIORITY_RANK`. */
export function priorityRank(p: Priority): number {
  return { high: 0, medium: 1, low: 2 }[p];
}

/** "at or above the floor" — a ticket's priority is at least as high as the active floor. */
export function atOrAboveFloor(p: Priority, floor: Priority): boolean {
  return priorityRank(p) <= priorityRank(floor);
}

// --- The milestone predicate (the 4 machine-checkable triggers) -----------

/**
 * A work-board ticket as the milestone rule sees it — a **minimal structural** view (a subset
 * of the console's `WorkItem`), populated by the work-086 runner from the board + the ticket's
 * spec/theme. Kept deliberately tiny so this module never imports server-shaped types.
 */
export type SweepTicket = {
  id: string;
  status: SweepStatus;
  priority: Priority;
  /**
   * The roadmap theme id / PRD "Scope (this cycle)" group this ticket traces to, if any
   * (resolved by the runner from the ticket's `spec`/theme). Drives the theme-boundary trigger.
   */
  group?: string;
  /** Frontmatter `milestone:` value, if any (e.g. `"owner-review"`). Drives the explicit marker. */
  milestone?: string;
};

/**
 * The evaluation context after a ticket flips terminal — everything the four triggers need,
 * with no I/O. The runner assembles this once per completed ticket and calls
 * {@link evaluateMilestone}.
 */
export type MilestoneSnapshot = {
  /** The full board **after** `justCompleted` flipped terminal. */
  board: SweepTicket[];
  /** The ticket that just reached terminal — the evaluation trigger. */
  justCompleted: SweepTicket;
  /** Active priority floor: only tickets at/above this rank are the autonomous backlog. */
  priorityFloor: Priority;
  /** Landed-but-unreleased work count, and… */
  unreleasedCount: number;
  /** …the roadmap release threshold. `<= 0` disables the release trigger entirely. */
  releaseThreshold: number;
};

/**
 * The four milestone triggers, quoted from the [[prd-autonomous-execution-loop]] stop-rule
 * table. Returned by {@link evaluateMilestone} in **this** list order for deterministic tests.
 */
export type MilestoneTrigger =
  | "theme-boundary"
  | "release-boundary"
  | "priority-floor-exhausted"
  | "explicit-marker";

/** Canonical trigger order — the order {@link evaluateMilestone} returns fired triggers in. */
const TRIGGER_ORDER: readonly MilestoneTrigger[] = [
  "theme-boundary",
  "release-boundary",
  "priority-floor-exhausted",
  "explicit-marker",
];

/**
 * **Trigger 1 — theme / PRD boundary.** Fires when the just-completed ticket traces to a group
 * (a roadmap theme / a PRD's "Scope (this cycle)") AND **every** ticket on the board sharing
 * that group is now terminal. A `blocked` or workable sibling means the themed body of work is
 * *not* complete, so it does not fire — the Owner is only pulled in when the whole theme lands.
 */
function themeBoundary(snap: MilestoneSnapshot): boolean {
  const group = snap.justCompleted.group;
  if (group == null) return false;
  const siblings = snap.board.filter((t) => t.group === group);
  return siblings.length > 0 && siblings.every((t) => isTerminal(t.status));
}

/**
 * **Trigger 2 — release boundary.** Fires when landed-but-unreleased work crosses the roadmap
 * loop's release threshold. A threshold of `<= 0` disables the trigger; otherwise it is an
 * inclusive `>=` boundary.
 */
function releaseBoundary(snap: MilestoneSnapshot): boolean {
  return snap.releaseThreshold > 0 && snap.unreleasedCount >= snap.releaseThreshold;
}

/**
 * **Trigger 3 — priority-floor exhaustion** (also the loop's natural termination). Fires when
 * **no** ticket on the board is workable at/above the active floor — the autonomous backlog is
 * dry. A workable `low` ticket below a `medium` floor does *not* count (it is below the floor);
 * a workable ticket at/above the floor prevents the trigger.
 */
function priorityFloorExhausted(snap: MilestoneSnapshot): boolean {
  return !snap.board.some(
    (t) => isWorkable(t.status) && atOrAboveFloor(t.priority, snap.priorityFloor),
  );
}

/**
 * **Trigger 4 — explicit `milestone:` marker.** Fires when the just-completed ticket carries
 * `milestone: owner-review` in its frontmatter — lets an author or the Owner pin a specific
 * deliverable as sign-off-worthy even when it crosses no other boundary.
 */
function explicitMarker(snap: MilestoneSnapshot): boolean {
  return snap.justCompleted.milestone === "owner-review";
}

/**
 * Evaluate the milestone rule after a ticket flips terminal. Returns **all** triggers that
 * fired (several can fire together), ordered by {@link TRIGGER_ORDER} for deterministic tests,
 * or `[]` when none did — in which case the sweep rolls straight on to the next ready ticket.
 * Pure: no I/O, no clock, decided entirely from `snap`.
 */
export function evaluateMilestone(snap: MilestoneSnapshot): MilestoneTrigger[] {
  const fired = new Set<MilestoneTrigger>();
  if (themeBoundary(snap)) fired.add("theme-boundary");
  if (releaseBoundary(snap)) fired.add("release-boundary");
  if (priorityFloorExhausted(snap)) fired.add("priority-floor-exhausted");
  if (explicitMarker(snap)) fired.add("explicit-marker");
  return TRIGGER_ORDER.filter((t) => fired.has(t));
}

// --- The cadence-decision self-tune protocol ------------------------------

/** The live signals that drive a cadence decision (read by the runner from board + ledger). */
export type CadenceSignal = {
  /** Count of workable tickets at/above the floor — the ready backlog depth. */
  readyBacklogDepth: number;
  /** 0..1 — fraction of recent runs that hit a blocker/milestone (the Owner-pull rate). */
  ownerPullRate: number;
  /** Active workstreams. The [[ticket-cycle]] WIP cap is 2 ({@link WIP_CAP}). */
  wipActive: number;
  /** The last live cadence, in days (read from the most recent ledger block). */
  currentCadenceDays: number;
};

/** Policy bounds (from the [[work-sweep]] manifest; changing them is a [[core-upgrade]]). */
export type CadenceBounds = { minDays: number; maxDays: number };

/** A cadence decision: the next interval (clamped) + a one-line human reason. */
export type CadenceDecision = { nextCadenceDays: number; reason: string };

/** The [[ticket-cycle]] work-in-progress cap — cited in the decision reason. */
const WIP_CAP = 2;

/** At/above this recent-Owner-pull fraction, batching beats backlog-chasing (slow down). */
const OWNER_PULL_HIGH = 0.5;

/** Backlog depth treated as "maximally deep" — the fraction of the current→floor gap to close. */
const DEEP_BACKLOG_AT = 8;

/** Clamp `n` into `[lo, hi]` (integer days). */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Decide the sweep's next cadence from live signal — deterministic, clamped, documented. The
 * required directions (each unit-tested in isolation):
 *
 * - **Dry backlog** (`readyBacklogDepth === 0`) → back off to the ceiling (`bounds.maxDays`):
 *   nothing is ready, so don't wake to spin.
 * - **Deep backlog** → wake sooner. The proposal is **never larger than the current cadence**
 *   and shrinks as the backlog deepens (proportional to depth, up to {@link DEEP_BACKLOG_AT}),
 *   floored at `bounds.minDays`.
 * - **Frequent Owner pulls** (`ownerPullRate >= {@link OWNER_PULL_HIGH}`) → slow down / batch:
 *   this **takes precedence** over the backlog pull and pushes the cadence **up** (never below
 *   the current cadence), so the loop doesn't thrash the Owner — responsiveness-to-thrash beats
 *   backlog greed, the same "don't over-pull the Owner" instinct as [[request-triage]].
 *
 * The result is always clamped into `[minDays, maxDays]`. `reason` cites the signals that drove
 * it (backlog depth, Owner-pull rate, and WIP vs. the {@link WIP_CAP}).
 */
export function decideCadence(signal: CadenceSignal, bounds: CadenceBounds): CadenceDecision {
  const { minDays, maxDays } = bounds;
  const { readyBacklogDepth, ownerPullRate, wipActive, currentCadenceDays } = signal;
  const wipNote = `wip ${wipActive}/${WIP_CAP}`;

  // 1. Dry backlog → back off fully toward the ceiling.
  if (readyBacklogDepth === 0) {
    return {
      nextCadenceDays: clamp(maxDays, minDays, maxDays),
      reason: `backlog dry (0 ready) — backing off to the ${maxDays}-day ceiling; ${wipNote}`,
    };
  }

  // 2. Frequent Owner pulls → slow down / batch (takes precedence over the backlog pull).
  if (ownerPullRate >= OWNER_PULL_HIGH) {
    const headroom = Math.max(0, maxDays - currentCadenceDays);
    const push = Math.ceil(headroom * ownerPullRate);
    return {
      nextCadenceDays: clamp(currentCadenceDays + push, minDays, maxDays),
      reason:
        `frequent Owner pulls (rate ${ownerPullRate}) — slowing down to batch, ` +
        `${currentCadenceDays}→${clamp(currentCadenceDays + push, minDays, maxDays)}d; ${wipNote}`,
    };
  }

  // 3. Backlog present, Owner not thrashing → wake sooner, proportional to depth.
  const depthFraction = Math.min(readyBacklogDepth, DEEP_BACKLOG_AT) / DEEP_BACKLOG_AT;
  const room = Math.max(0, currentCadenceDays - minDays);
  const reduction = Math.ceil(room * depthFraction);
  const next = clamp(currentCadenceDays - reduction, minDays, maxDays);
  return {
    nextCadenceDays: next,
    reason:
      `ready backlog ${readyBacklogDepth} deep — waking sooner, ` +
      `${currentCadenceDays}→${next}d; ${wipNote}`,
  };
}

/** The fields of a `cadence-decision` ledger block (caller supplies the ISO `ranAt`). */
export type CadenceBlock = {
  ranAt: string;
  trigger: string;
  nextCadenceDays: number;
  reason: string;
};

/**
 * Render a compact, greppable `cadence-decision` block for the scope-creep [[ledger]] — the
 * same convention `registry/routines.json` points at (`ran_at`, `trigger`, `next_cadence_days`,
 * `reason`), so the operating session's recurring trigger can read the most recent block's
 * `next_cadence_days` to set its next fire. Pure: the caller supplies `ranAt` (an ISO string),
 * so it is deterministic and unit-testable.
 */
export function renderCadenceDecision(block: CadenceBlock): string {
  return [
    "### cadence-decision",
    "- loop: work-sweep",
    `- ran_at: ${block.ranAt}`,
    `- trigger: ${block.trigger}`,
    `- next_cadence_days: ${block.nextCadenceDays}`,
    `- reason: ${block.reason}`,
    "",
  ].join("\n");
}
