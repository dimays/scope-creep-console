// Pure types + helpers for the Human-Input Log — no server/db imports, so they're
// unit-testable. The DB/git projection lives in human-input.server.ts.

export type InputSource =
  | "console-chat"
  | "work-request"
  | "request-reply"
  | "feedback"
  | "operator-session"
  | "owner-action";

export type InputIntent =
  | "directive"
  | "request"
  | "answer"
  | "decision"
  | "feedback"
  | "correction";

export type HumanInputEvent = {
  id: string;
  ts: number;
  source: InputSource;
  intent: InputIntent;
  summary: string;
  excerpt?: string;
  refUrl?: string;
};

export type Interlude = { fromTs: number; toTs: number; commits: string[] };

export type SpineItem =
  | { kind: "input"; input: HumanInputEvent }
  | { kind: "interlude"; interlude: Interlude };

export function truncate(s: string, n = 140): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** True when there's more full text (`excerpt`) than the preview `summary` shows,
 * so the entry is worth an expand affordance. Guards the feedback case where the
 * summary ("Feedback 👍: …") is longer than a short comment excerpt. */
export function isExpandable(summary: string, excerpt?: string): boolean {
  const full = excerpt?.trim();
  return !!full && full.length > summary.length;
}

// --- Consistency self-checks (work-022) ----------------------------------
// The Human-Input Log is a projection over real systems of record, so it can drift
// from them. Two honest, threshold-free checks over the spine (work-012 / ADR-010):
//
//   Gap — control-plane commits/merges with NO captured input preceding them. Read as
//         a missed input or an uninstalled/misfiring capture hook: work happened that
//         no recorded human input can account for.
//   Dup — the same input recorded twice: a duplicate id, or a duplicate (ts, text)
//         pair (e.g. a backfill overlapping a live capture).
//
// Honesty contract (this is a Chief-Reality-Officer check, so it must not cry wolf):
//   * We flag only what the records actually show — a gap is grounded in real commit
//     records, a dup in real input records. Nothing is inferred or invented.
//   * "No data" is NOT "clean". With neither inputs nor commits to compare there is
//     nothing to verify, so `hasData` is false and `ok` is false — we report
//     "can't verify", never a false all-clear.
//   * A commit counts as anchored when a captured input is at or before it. So the
//     caller decides the observation window (see human-input.server.ts): we never
//     drag in repo prehistory from before the log existed and call it a gap.

/** A control-plane commit (or merge) with the timestamp used to anchor it to an input. */
export type CommitRecord = { ts: number; subject: string; merge?: boolean };

/** A run of control-plane commits with no captured input preceding them. */
export type InputGap = {
  fromTs: number;
  toTs: number;
  commits: string[];
  count: number;
};

/** Two or more input records that collide — a sign the projection double-counted. */
export type InputDup = {
  kind: "id" | "ts-text";
  /** The colliding id, or `${ts}␟${text}` for a (ts, text) collision. */
  key: string;
  /** The input ids involved in the collision (>= 2). */
  ids: string[];
  count: number;
};

export type ConsistencyChecks = {
  /** false = nothing to compare (no inputs AND no commits). NOT the same as "clean". */
  hasData: boolean;
  gaps: InputGap[];
  dups: InputDup[];
  /** true only when we actually had data AND found neither a gap nor a dup. */
  ok: boolean;
};

/** The minimal shape the checks need from a captured input. */
export type ConsistencyInput = Pick<HumanInputEvent, "id" | "ts" | "summary" | "excerpt">;

const US = "␟"; // unit-separator glyph, safe inside a composite key

/**
 * Run the gap + dup checks over captured inputs and the control-plane commits in the
 * observation window. Pure and deterministic — the caller supplies both record sets
 * (the server wrapper sources them from the DB/ndjson union and `git log`). See the
 * honesty contract above: this reports only what the records show.
 */
export function checkInputConsistency(
  inputs: ConsistencyInput[],
  commits: CommitRecord[],
): ConsistencyChecks {
  const hasData = inputs.length > 0 || commits.length > 0;

  // --- Gap: commits with no captured input at or before them ---
  // When there are inputs, the earliest one is the baseline: any commit before it has
  // no input to account for it. When there are none at all, every commit is orphaned
  // (the strongest signal — the hook captured nothing while work still shipped).
  const earliestInputTs = inputs.length > 0 ? Math.min(...inputs.map((i) => i.ts)) : undefined;
  const orphaned = commits
    .filter((c) => earliestInputTs === undefined || c.ts < earliestInputTs)
    .sort((a, b) => a.ts - b.ts);
  const gaps: InputGap[] =
    orphaned.length > 0
      ? [
          {
            fromTs: orphaned[0].ts,
            toTs: orphaned[orphaned.length - 1].ts,
            commits: orphaned.map((c) => c.subject),
            count: orphaned.length,
          },
        ]
      : [];

  // --- Dup: same id, or same (ts, text) pair, recorded more than once ---
  const byId = new Map<string, string[]>();
  const byTsText = new Map<string, string[]>();
  for (const input of inputs) {
    const idArr = byId.get(input.id) ?? [];
    idArr.push(input.id);
    byId.set(input.id, idArr);

    const text = (input.excerpt ?? input.summary).trim();
    const key = `${input.ts}${US}${text}`;
    const ttArr = byTsText.get(key) ?? [];
    ttArr.push(input.id);
    byTsText.set(key, ttArr);
  }
  const dups: InputDup[] = [];
  for (const [id, ids] of byId) {
    if (ids.length > 1) dups.push({ kind: "id", key: id, ids, count: ids.length });
  }
  for (const [key, ids] of byTsText) {
    if (ids.length > 1) dups.push({ kind: "ts-text", key, ids, count: ids.length });
  }

  return { hasData, gaps, dups, ok: hasData && gaps.length === 0 && dups.length === 0 };
}
