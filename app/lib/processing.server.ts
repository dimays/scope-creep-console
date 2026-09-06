import { type Interruption, isInterruptionActive, parseInterruption } from "./processing";
import { getSetting, setSetting } from "./settings.server";

/**
 * The server side of processing-state clarity (work-011). Persists the one global
 * interruption fact in the `settings` k/v store, so it survives a process restart and is
 * readable by the app-wide root loader. Recorded by the agent runtime on a token/rate
 * limit (429) and cleared on the next successful call — the banner is therefore driven by
 * real backend state, never fabricated.
 *
 * Single-user by invariant, so the key is global (no scoping).
 */
export const INTERRUPTION_SETTING = "processing_interruption";

export type { Interruption } from "./processing";

/** Record (or replace) the current interruption. */
export async function recordInterruption(input: {
  reason: string;
  resetAt: number;
  detail?: string;
  now?: number;
}): Promise<void> {
  const now = input.now ?? Date.now();
  const intr: Interruption = {
    reason: input.reason,
    resetAt: input.resetAt,
    since: now,
    detail: input.detail,
  };
  await setSetting(INTERRUPTION_SETTING, JSON.stringify(intr));
}

/** Clear the interruption — processing has resumed. */
export async function clearInterruption(): Promise<void> {
  await setSetting(INTERRUPTION_SETTING, "");
}

/**
 * Read the current interruption, or null if none is active. A stored interruption whose
 * reset ETA has already passed is treated as resolved: it's cleared and null is returned,
 * so a stale banner never lingers past its own ETA.
 */
export async function readInterruption(now: number = Date.now()): Promise<Interruption | null> {
  const intr = parseInterruption(await getSetting(INTERRUPTION_SETTING));
  if (!intr) return null;
  if (!isInterruptionActive(intr, now)) {
    await clearInterruption();
    return null;
  }
  return intr;
}
