import { describe, expect, it } from "vitest";
import {
  type CommitRecord,
  type ConsistencyInput,
  checkInputConsistency,
  isExpandable,
  truncate,
} from "./human-input";

describe("truncate", () => {
  it("leaves short strings intact (trimmed)", () => {
    expect(truncate("  hello  ")).toBe("hello");
  });

  it("truncates long strings with an ellipsis", () => {
    const out = truncate("x".repeat(200), 10);
    expect(out).toBe(`${"x".repeat(10)}…`);
    expect(out.length).toBe(11);
  });
});

describe("isExpandable", () => {
  it("is expandable when the full excerpt is longer than the preview", () => {
    const full = "x".repeat(200);
    expect(isExpandable(truncate(full), full)).toBe(true);
  });

  it("is not expandable when there is no excerpt", () => {
    expect(isExpandable("a short line")).toBe(false);
  });

  it("is not expandable when the excerpt is no longer than the summary", () => {
    // e.g. feedback: summary "Feedback 👍: nice" is longer than the "nice" comment.
    expect(isExpandable("Feedback 👍: nice", "nice")).toBe(false);
  });
});

describe("checkInputConsistency", () => {
  // Helpers to keep the intent of each timeline obvious.
  const input = (id: string, ts: number, text: string): ConsistencyInput => ({
    id,
    ts,
    summary: text,
    excerpt: text,
  });
  const commit = (ts: number, subject: string, merge = false): CommitRecord => ({
    ts,
    subject,
    merge,
  });

  it("flags a GAP: control-plane commits with no captured input preceding them", () => {
    // Two commits shipped at t=50/60 before the earliest captured input at t=100 —
    // work with nothing to account for it (an uninstalled/misfiring hook).
    const inputs = [input("a", 100, "kick off the work")];
    const commits = [commit(50, "feat: land thing"), commit(60, "merge: land branch", true)];

    const checks = checkInputConsistency(inputs, commits);

    expect(checks.hasData).toBe(true);
    expect(checks.gaps).toHaveLength(1);
    expect(checks.gaps[0].count).toBe(2);
    expect(checks.gaps[0].fromTs).toBe(50);
    expect(checks.gaps[0].toTs).toBe(60);
    expect(checks.gaps[0].commits).toEqual(["feat: land thing", "merge: land branch"]);
    expect(checks.dups).toHaveLength(0);
    expect(checks.ok).toBe(false);
  });

  it("flags a DUP: a duplicate input id", () => {
    const inputs = [input("dup-id", 100, "first"), input("dup-id", 200, "second")];

    const checks = checkInputConsistency(inputs, [commit(150, "work")]);

    const idDup = checks.dups.find((d) => d.kind === "id");
    expect(idDup).toBeDefined();
    expect(idDup?.key).toBe("dup-id");
    expect(idDup?.count).toBe(2);
    expect(checks.ok).toBe(false);
  });

  it("flags a DUP: a duplicate (ts, text) pair with distinct ids (backfill over live capture)", () => {
    const inputs = [
      input("live:1", 1000, "approve the merge"),
      input("backfill:1", 1000, "approve the merge"),
    ];

    const checks = checkInputConsistency(inputs, [commit(1100, "merge", true)]);

    const ttDup = checks.dups.find((d) => d.kind === "ts-text");
    expect(ttDup).toBeDefined();
    expect(ttDup?.count).toBe(2);
    expect(ttDup?.ids.sort()).toEqual(["backfill:1", "live:1"]);
    expect(checks.ok).toBe(false);
  });

  it("flags NEITHER on a clean timeline: every commit is preceded by an input, no dups", () => {
    const inputs = [input("a", 100, "directive one"), input("b", 300, "directive two")];
    // All work ships AFTER the earliest input; ids and (ts,text) are unique.
    const commits = [commit(150, "feat: a"), commit(350, "merge: b", true)];

    const checks = checkInputConsistency(inputs, commits);

    expect(checks.hasData).toBe(true);
    expect(checks.gaps).toEqual([]);
    expect(checks.dups).toEqual([]);
    expect(checks.ok).toBe(true);
  });

  it("reports CAN'T-VERIFY, not clean, when there is no data at all", () => {
    const checks = checkInputConsistency([], []);
    expect(checks.hasData).toBe(false);
    expect(checks.ok).toBe(false); // "no data" must never read as a green all-clear
    expect(checks.gaps).toEqual([]);
    expect(checks.dups).toEqual([]);
  });
});
