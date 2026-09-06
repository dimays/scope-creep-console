import { afterEach, describe, expect, it } from "vitest";
import { clearInterruption, readInterruption, recordInterruption } from "./processing.server";

afterEach(async () => {
  await clearInterruption();
});

describe("processing.server", () => {
  it("returns null when nothing is recorded", async () => {
    expect(await readInterruption()).toBeNull();
  });

  it("records and reads back an active interruption", async () => {
    const now = 10_000;
    await recordInterruption({
      reason: "Token/rate limit reached",
      resetAt: now + 60_000,
      detail: "paused",
      now,
    });
    const intr = await readInterruption(now + 1);
    expect(intr).not.toBeNull();
    expect(intr?.reason).toBe("Token/rate limit reached");
    expect(intr?.resetAt).toBe(now + 60_000);
    expect(intr?.since).toBe(now);
    expect(intr?.detail).toBe("paused");
  });

  it("auto-clears a lapsed interruption and returns null", async () => {
    const now = 10_000;
    await recordInterruption({ reason: "gone", resetAt: now + 1000, now });
    // Read past the reset ETA: treated as resolved and cleared.
    expect(await readInterruption(now + 2000)).toBeNull();
    // A subsequent read (even before a fresh ETA) confirms it stayed cleared.
    expect(await readInterruption(now)).toBeNull();
  });

  it("clearInterruption removes an active one (processing resumed)", async () => {
    const now = 10_000;
    await recordInterruption({ reason: "x", resetAt: now + 60_000, now });
    expect(await readInterruption(now + 1)).not.toBeNull();
    await clearInterruption();
    expect(await readInterruption(now + 1)).toBeNull();
  });
});
