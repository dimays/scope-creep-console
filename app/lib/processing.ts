/**
 * Processing-state clarity (work-011). The Owner should always know when the org is
 * *blocked* — e.g. the agent runtime hit a token/rate limit — and roughly when it can
 * resume. This client-safe module holds the shared type plus the pure formatting/derivation
 * helpers used by both the server (which records interruptions) and the app-wide banner.
 *
 * An **interruption** is a single global fact (single-user by invariant): the backend is
 * paused until `resetAt`. It is recorded by the agent runtime on a 429 and cleared the
 * moment a call succeeds — see `processing.server.ts`.
 */

export type Interruption = {
  /** Short, Owner-readable reason, e.g. "Token/rate limit reached". */
  reason: string;
  /** Epoch ms when processing is expected to resume (the reset ETA). */
  resetAt: number;
  /** Epoch ms when the interruption was recorded. */
  since: number;
  /** Optional extra context (e.g. the upstream status). */
  detail?: string;
};

/** True while `now` is before the reset ETA — i.e. the org is still blocked. */
export function isInterruptionActive(intr: Interruption | null | undefined, now: number): boolean {
  return !!intr && intr.resetAt > now;
}

/** Best-effort parse of a stored interruption blob; never throws. */
export function parseInterruption(raw: string | null | undefined): Interruption | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Interruption>;
    if (typeof v.resetAt !== "number" || typeof v.since !== "number") return null;
    return {
      reason: typeof v.reason === "string" && v.reason ? v.reason : "Processing paused",
      resetAt: v.resetAt,
      since: v.since,
      detail: typeof v.detail === "string" ? v.detail : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * A friendly, tabular countdown from `now` to `resetAt` — the number part only
 * ("3m 20s", "45s"). At or past the reset it reads "any moment now".
 */
export function formatResetEta(resetAt: number, now: number): string {
  const ms = resetAt - now;
  if (ms <= 0) return "any moment now";
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}
