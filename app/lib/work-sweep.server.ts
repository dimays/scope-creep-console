import { listWork, type WorkItem } from "./work.server";
import {
  atOrAboveFloor,
  type CadenceBounds,
  type CadenceDecision,
  type CadenceSignal,
  decideCadence,
  isWorkable,
  type MilestoneSnapshot,
  type Priority,
  priorityRank,
  renderCadenceDecision,
  type SweepTicket,
} from "./work-sweep";

/**
 * The **work-sweep runner** mechanics (work-086, [[work-sweep]] loop,
 * [[prd-autonomous-execution-loop]], ADR-025 runner topology).
 *
 * ## What this module is — and is NOT
 * This is the *mechanism* half of the work-sweep loop: it reads the control-plane work board,
 * computes the ready set, assembles the milestone stop-state snapshot, writes outcomes back into
 * threads, and composes the cadence-decision block. Per **ADR-025** the runner gives the
 * scheduled routine session **verbs**; the *judgment* — driving a ticket through the
 * [[dev-cycle]], deciding proceed/park, confirming dependencies are met — is the session's
 * runtime Claude reasoning against the loop spec, **never hardcoded here**.
 *
 * It **never authors tickets** (that is the [[request-triage]] runner's job — this loop
 * *executes* the backlog, it does not create it) and it **never merges**: ADR-022 independent
 * review (author ≠ merger) is the finish line, so this runner only *reads* the board and
 * *stages* outcomes.
 *
 * ## Reuse over rebuild (mirrors `triage.server.ts` exactly)
 * - The **milestone/cadence judgment** is work-087's pure predicate ({@link decideCadence},
 *   `evaluateMilestone`, etc. in `./work-sweep`) — imported, never duplicated.
 * - The **board read** is `listWork()` from `./work.server` — the console's single system of
 *   record for `work/*.md`; re-reading it anywhere would fork it.
 * - The **write-back** is the *same* {@link writeBackOutcome} the request-triage runner uses —
 *   re-exported from `./triage.server`, not re-implemented, so there is one writer.
 *
 * Everything that can be pure is pure: `computeReadySet`, `buildMilestoneSnapshot`,
 * `toSweepTicket` and `planCadence` take plain arrays / injected signals and touch no I/O, so
 * the whole runner is exercisable over an in-memory board. The one board-touching entry point
 * ({@link sweep}) is thin and delegates to `listWork()`.
 */

// --- Board → predicate view -----------------------------------------------

/**
 * Map a console work-board {@link WorkItem} to the work-087 predicate's minimal
 * {@link SweepTicket} view. `group := item.spec` — a ticket traces to its spec / PRD-theme, and
 * that trace is what drives the theme-boundary milestone trigger. Carries `status`, `priority`,
 * `id` and the frontmatter `milestone` marker. Pure.
 */
export function toSweepTicket(item: WorkItem): SweepTicket {
  return {
    id: item.id,
    status: item.status,
    priority: item.priority as Priority,
    group: item.spec,
    milestone: item.milestone,
  };
}

// --- The ready set (loop step 1: compute the workable backlog) -------------

/** The [[ticket-cycle]] work-in-progress cap — at most this many `active` tickets at once. */
export const WIP_CAP = 2;

/**
 * The computed ready set + the WIP / termination signals the routine session reasons over.
 * `ready` is only *candidates*: "dependencies met" is a runtime judgment the session confirms
 * before pulling one — the mechanism returns the workable, at-floor, spec-traced set; it does
 * not decide readiness-to-start.
 */
export type ReadySet = {
  /** Workable, at/above the floor, spec-traced candidates — ordered by priority then id. */
  ready: SweepTicket[];
  /** Count of `active` tickets on the board — the current WIP. */
  activeCount: number;
  /** The WIP cap ({@link WIP_CAP}). */
  wipCap: number;
  /** `activeCount >= wipCap` — the session should land before pulling more. */
  atCap: boolean;
  /** No workable ticket at/above the floor remains — the priority-floor termination signal. */
  exhausted: boolean;
};

/**
 * Compute the ready set from a board snapshot. **Pure** — decided entirely from `items`.
 *
 * A ticket is **ready** when it is all three of:
 * - **workable** — `proposed | active` (uses {@link isWorkable}; `blocked` and terminal are out);
 * - **at/above the floor** — priority ≥ the active floor (uses {@link atOrAboveFloor}; the default
 *   floor `"low"` admits every priority);
 * - **spec-traced** — a non-empty `spec` (`group`), so it traces to a live spec/PRD-theme; an
 *   untraced ticket is not part of the autonomous backlog.
 *
 * `ready` is ordered by priority rank then id (stable, deterministic). `activeCount` counts
 * `active` items; `atCap` is `activeCount >= wipCap`. `exhausted` mirrors work-087's
 * priority-floor rule exactly (workable at/above floor, *regardless* of spec trace) so the
 * termination signal here and in `evaluateMilestone` agree.
 *
 * Note: "dependencies met" is deliberately NOT decided here — it is a runtime judgment the
 * routine session confirms per candidate (ADR-025). This returns candidates, not commitments.
 */
export function computeReadySet(items: WorkItem[], opts: { floor?: Priority } = {}): ReadySet {
  const floor: Priority = opts.floor ?? "low";
  const tickets = items.map(toSweepTicket);

  const ready = tickets
    .filter(
      (t) =>
        isWorkable(t.status) &&
        atOrAboveFloor(t.priority, floor) &&
        typeof t.group === "string" &&
        t.group.length > 0,
    )
    .sort(
      (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id),
    );

  const activeCount = tickets.filter((t) => t.status === "active").length;
  const exhausted = !tickets.some((t) => isWorkable(t.status) && atOrAboveFloor(t.priority, floor));

  return { ready, activeCount, wipCap: WIP_CAP, atCap: activeCount >= WIP_CAP, exhausted };
}

// --- The milestone stop-state snapshot (loop step 2) -----------------------

/**
 * Assemble the {@link MilestoneSnapshot} the routine passes to work-087's `evaluateMilestone`
 * after a ticket flips terminal. **Pure.** The board is mapped through {@link toSweepTicket};
 * `justCompleted` is resolved by id from that mapped board (it must be present — the caller just
 * completed it). Release inputs default to the disabled state (`unreleasedCount 0`,
 * `releaseThreshold 0` = the release trigger is off unless the roadmap supplies a threshold).
 */
export function buildMilestoneSnapshot(
  items: WorkItem[],
  justCompletedId: string,
  opts: { floor?: Priority; unreleasedCount?: number; releaseThreshold?: number } = {},
): MilestoneSnapshot {
  const board = items.map(toSweepTicket);
  const justCompleted = board.find((t) => t.id === justCompletedId);
  if (!justCompleted) {
    throw new Error(`buildMilestoneSnapshot: ${justCompletedId} is not on the board`);
  }
  return {
    board,
    justCompleted,
    priorityFloor: opts.floor ?? "low",
    unreleasedCount: opts.unreleasedCount ?? 0,
    releaseThreshold: opts.releaseThreshold ?? 0,
  };
}

// --- The thin board-touching entry point -----------------------------------

/**
 * Read the live control-plane board and compute the ready set. Thin: `await listWork()` then
 * {@link computeReadySet}. Reuses the console's board reader (the single system of record for
 * `work/*.md`) rather than re-reading the directory.
 *
 * Honest degradation (mirrors triage's sweep note): a genuine board *read failure* propagates as
 * a thrown error / non-zero exit — never a silently-empty ready set masquerading as "nothing to
 * do". (An absent `work/` dir is the distinct legitimately-empty case `listWork` returns `[]`
 * for.)
 */
export async function sweep(opts: { floor?: Priority } = {}): Promise<ReadySet> {
  const items = await listWork();
  return computeReadySet(items, opts);
}

// --- Write-back (loop step 4) — SAME writer as request-triage ---------------

export type { PlannedWriteBack, TriageOutcomeKind } from "./triage.server";
/**
 * Re-export the request-triage runner's write-back writer verbatim, so the work-sweep runner's
 * write-back path is the *same implementation* (work-064 writers, one source of truth) — not a
 * fork. The runner posts a `critical-update` (keeps the org's turn: progress / an FYI) or a
 * `needs-input` (parks the thread on the Owner: a milestone sign-off, a STOP-gate the routine
 * may not self-authorize) back into a thread; every call honours `{ dryRun }`.
 */
export { writeBackOutcome } from "./triage.server";

// --- Cadence-decision self-tune (between-runs step) ------------------------

/**
 * Compose work-087's {@link decideCadence} + {@link renderCadenceDecision} into one call: decide
 * the next interval from live `signal`, clamp to the injected policy `bounds`, and render the
 * greppable `cadence-decision` ledger block. **Pure** — `signal`, `bounds`, and `meta.ranAt` are
 * all injected (the seed and `cadence_bounds` are policy that lives in the [[work-sweep]]
 * manifest, moved only by [[core-upgrade]], never hardcoded here).
 */
export function planCadence(
  signal: CadenceSignal,
  bounds: CadenceBounds,
  meta: { ranAt: string; trigger: string },
): { decision: CadenceDecision; block: string } {
  const decision = decideCadence(signal, bounds);
  const block = renderCadenceDecision({
    ranAt: meta.ranAt,
    trigger: meta.trigger,
    nextCadenceDays: decision.nextCadenceDays,
    reason: decision.reason,
  });
  return { decision, block };
}
