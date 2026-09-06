import { describe, expect, it } from "vitest";
import { formatResetEta, isInterruptionActive, parseInterruption } from "./processing";

describe("isInterruptionActive", () => {
  const base = { reason: "x", since: 0, resetAt: 1000 };
  it("is active before the reset ETA", () => {
    expect(isInterruptionActive(base, 500)).toBe(true);
  });
  it("is inactive at or after the reset ETA", () => {
    expect(isInterruptionActive(base, 1000)).toBe(false);
    expect(isInterruptionActive(base, 2000)).toBe(false);
  });
  it("is inactive for null/undefined", () => {
    expect(isInterruptionActive(null, 0)).toBe(false);
    expect(isInterruptionActive(undefined, 0)).toBe(false);
  });
});

describe("parseInterruption", () => {
  it("returns null for empty/garbage", () => {
    expect(parseInterruption("")).toBeNull();
    expect(parseInterruption(null)).toBeNull();
    expect(parseInterruption("not json")).toBeNull();
    expect(parseInterruption("{}")).toBeNull();
  });
  it("round-trips a well-formed blob", () => {
    const raw = JSON.stringify({ reason: "Token/rate limit reached", resetAt: 42, since: 1 });
    expect(parseInterruption(raw)).toEqual({
      reason: "Token/rate limit reached",
      resetAt: 42,
      since: 1,
      detail: undefined,
    });
  });
  it("defaults a missing reason", () => {
    const raw = JSON.stringify({ resetAt: 5, since: 1 });
    expect(parseInterruption(raw)?.reason).toBe("Processing paused");
  });
});

describe("formatResetEta", () => {
  it("reads 'any moment now' at/after reset", () => {
    expect(formatResetEta(1000, 1000)).toBe("any moment now");
    expect(formatResetEta(1000, 2000)).toBe("any moment now");
  });
  it("formats seconds, minutes, and hours", () => {
    const now = 0;
    expect(formatResetEta(45_000, now)).toBe("45s");
    expect(formatResetEta(60_000, now)).toBe("1m");
    expect(formatResetEta(80_000, now)).toBe("1m 20s");
    expect(formatResetEta(3_600_000, now)).toBe("1h");
    expect(formatResetEta(3_660_000, now)).toBe("1h 1m");
  });
});
