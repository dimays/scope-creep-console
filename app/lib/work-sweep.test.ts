import { describe, expect, it } from "vitest";
import {
  atOrAboveFloor,
  type CadenceBounds,
  type CadenceSignal,
  decideCadence,
  evaluateMilestone,
  isTerminal,
  isWorkable,
  type MilestoneSnapshot,
  priorityRank,
  renderCadenceDecision,
  type SweepTicket,
} from "./work-sweep";

// --- Fixtures -------------------------------------------------------------

function ticket(over: Partial<SweepTicket> = {}): SweepTicket {
  return { id: "work-001", status: "done", priority: "medium", ...over };
}

function snapshot(over: Partial<MilestoneSnapshot> = {}): MilestoneSnapshot {
  const justCompleted = over.justCompleted ?? ticket();
  return {
    board: over.board ?? [justCompleted],
    justCompleted,
    priorityFloor: over.priorityFloor ?? "medium",
    unreleasedCount: over.unreleasedCount ?? 0,
    releaseThreshold: over.releaseThreshold ?? 0,
  };
}

// --- Status / priority helpers -------------------------------------------

describe("status + priority partitions (work-087)", () => {
  it("TERMINAL = done|superseded|dropped; WORKABLE = proposed|active; blocked is parked", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("superseded")).toBe(true);
    expect(isTerminal("dropped")).toBe(true);
    expect(isTerminal("proposed")).toBe(false);
    expect(isTerminal("active")).toBe(false);
    expect(isTerminal("blocked")).toBe(false);

    expect(isWorkable("proposed")).toBe(true);
    expect(isWorkable("active")).toBe(true);
    expect(isWorkable("blocked")).toBe(false); // parked, not workable
    expect(isWorkable("done")).toBe(false);
  });

  it("priority rank high<medium<low, and 'at/above floor' is rank(t) <= rank(floor)", () => {
    expect(priorityRank("high")).toBe(0);
    expect(priorityRank("medium")).toBe(1);
    expect(priorityRank("low")).toBe(2);

    expect(atOrAboveFloor("high", "medium")).toBe(true);
    expect(atOrAboveFloor("medium", "medium")).toBe(true);
    expect(atOrAboveFloor("low", "medium")).toBe(false); // below the floor
  });
});

// --- Milestone predicate: each trigger fires in isolation -----------------

describe("evaluateMilestone — each trigger fires alone (work-087)", () => {
  it("theme-boundary: group's last ticket goes terminal → fires, and only it", () => {
    const done = ticket({ id: "work-001", status: "done", group: "theme-3", priority: "low" });
    const sibling = ticket({ id: "work-002", status: "done", group: "theme-3", priority: "low" });
    // A low workable ticket below the medium floor keeps the floor NOT exhausted from firing…
    const other = ticket({ id: "work-003", status: "active", group: "other", priority: "medium" });
    const snap = snapshot({ board: [done, sibling, other], justCompleted: done });
    expect(evaluateMilestone(snap)).toEqual(["theme-boundary"]);
  });

  it("release-boundary: unreleased crosses threshold → fires, and only it", () => {
    // active at/above floor prevents floor-exhaustion; no group on justCompleted.
    const active = ticket({ id: "work-002", status: "active", priority: "high" });
    const done = ticket({ id: "work-001", status: "done" });
    const snap = snapshot({
      board: [done, active],
      justCompleted: done,
      unreleasedCount: 5,
      releaseThreshold: 5,
    });
    expect(evaluateMilestone(snap)).toEqual(["release-boundary"]);
  });

  it("priority-floor-exhausted: no workable ticket at/above the floor → fires, and only it", () => {
    const done = ticket({ id: "work-001", status: "done" });
    const snap = snapshot({ board: [done], justCompleted: done, priorityFloor: "medium" });
    expect(evaluateMilestone(snap)).toEqual(["priority-floor-exhausted"]);
  });

  it("explicit-marker: milestone: owner-review → fires, and only it", () => {
    const done = ticket({ id: "work-001", status: "done", milestone: "owner-review" });
    // active at/above floor keeps floor-exhaustion from also firing.
    const active = ticket({ id: "work-002", status: "active", priority: "high" });
    const snap = snapshot({ board: [done, active], justCompleted: done });
    expect(evaluateMilestone(snap)).toEqual(["explicit-marker"]);
  });

  it("nothing fires → [] (the sweep rolls on)", () => {
    const done = ticket({ id: "work-001", status: "done" });
    const active = ticket({ id: "work-002", status: "active", priority: "high" });
    const snap = snapshot({ board: [done, active], justCompleted: done });
    expect(evaluateMilestone(snap)).toEqual([]);
  });
});

// --- Milestone predicate: boundary conditions -----------------------------

describe("evaluateMilestone — theme-boundary boundary conditions (work-087)", () => {
  it("does NOT fire when a group sibling is blocked (theme not complete)", () => {
    const done = ticket({ id: "work-001", status: "done", group: "theme-3" });
    const blocked = ticket({
      id: "work-002",
      status: "blocked",
      group: "theme-3",
      priority: "high",
    });
    const snap = snapshot({ board: [done, blocked], justCompleted: done });
    expect(evaluateMilestone(snap)).not.toContain("theme-boundary");
  });

  it("does NOT fire when a group sibling is still workable", () => {
    const done = ticket({ id: "work-001", status: "done", group: "theme-3" });
    const active = ticket({ id: "work-002", status: "active", group: "theme-3", priority: "high" });
    const snap = snapshot({ board: [done, active], justCompleted: done });
    expect(evaluateMilestone(snap)).not.toContain("theme-boundary");
  });

  it("does NOT fire when the just-completed ticket has no group", () => {
    const done = ticket({ id: "work-001", status: "done", group: undefined });
    const active = ticket({ id: "work-002", status: "active", priority: "high" });
    const snap = snapshot({ board: [done, active], justCompleted: done });
    expect(evaluateMilestone(snap)).not.toContain("theme-boundary");
  });
});

describe("evaluateMilestone — release-boundary boundary conditions (work-087)", () => {
  const active = ticket({ id: "work-002", status: "active", priority: "high" });
  const done = ticket({ id: "work-001", status: "done" });

  it("threshold <= 0 disables the trigger even when unreleased is high", () => {
    const snap = snapshot({
      board: [done, active],
      justCompleted: done,
      unreleasedCount: 99,
      releaseThreshold: 0,
    });
    expect(evaluateMilestone(snap)).not.toContain("release-boundary");
  });

  it("fires on the inclusive >= boundary, not one below it", () => {
    const below = snapshot({
      board: [done, active],
      justCompleted: done,
      unreleasedCount: 4,
      releaseThreshold: 5,
    });
    expect(evaluateMilestone(below)).not.toContain("release-boundary");

    const at = snapshot({
      board: [done, active],
      justCompleted: done,
      unreleasedCount: 5,
      releaseThreshold: 5,
    });
    expect(evaluateMilestone(at)).toContain("release-boundary");
  });
});

describe("evaluateMilestone — priority-floor exhaustion (work-087)", () => {
  it("a workable low ticket below a medium floor does NOT count (still exhausted)", () => {
    const done = ticket({ id: "work-001", status: "done" });
    const low = ticket({ id: "work-002", status: "active", priority: "low" });
    const snap = snapshot({ board: [done, low], justCompleted: done, priorityFloor: "medium" });
    expect(evaluateMilestone(snap)).toContain("priority-floor-exhausted");
  });

  it("a workable ticket AT the floor prevents exhaustion", () => {
    const done = ticket({ id: "work-001", status: "done" });
    const atFloor = ticket({ id: "work-002", status: "proposed", priority: "medium" });
    const snap = snapshot({ board: [done, atFloor], justCompleted: done, priorityFloor: "medium" });
    expect(evaluateMilestone(snap)).not.toContain("priority-floor-exhausted");
  });

  it("a blocked ticket at/above the floor does NOT prevent exhaustion (parked, not ready)", () => {
    const done = ticket({ id: "work-001", status: "done" });
    const blocked = ticket({ id: "work-002", status: "blocked", priority: "high" });
    const snap = snapshot({ board: [done, blocked], justCompleted: done, priorityFloor: "medium" });
    expect(evaluateMilestone(snap)).toContain("priority-floor-exhausted");
  });
});

describe("evaluateMilestone — combined triggers (work-087)", () => {
  it("returns ALL fired triggers, in canonical order", () => {
    // theme-boundary (group all terminal) AND priority-floor-exhausted (nothing workable).
    const done = ticket({ id: "work-001", status: "done", group: "theme-3" });
    const sibling = ticket({ id: "work-002", status: "done", group: "theme-3" });
    const snap = snapshot({ board: [done, sibling], justCompleted: done, priorityFloor: "medium" });
    expect(evaluateMilestone(snap)).toEqual(["theme-boundary", "priority-floor-exhausted"]);
  });
});

// --- Cadence decision -----------------------------------------------------

describe("decideCadence — self-tune directions (work-087)", () => {
  const bounds: CadenceBounds = { minDays: 2, maxDays: 14 };
  const base: CadenceSignal = {
    readyBacklogDepth: 3,
    ownerPullRate: 0.1,
    wipActive: 1,
    currentCadenceDays: 7,
  };

  it("dry backlog → backs off to maxDays", () => {
    const d = decideCadence({ ...base, readyBacklogDepth: 0 }, bounds);
    expect(d.nextCadenceDays).toBe(bounds.maxDays);
  });

  it("deep backlog → cadence not larger than current, and deeper is strictly smaller than shallow", () => {
    const shallow = decideCadence({ ...base, readyBacklogDepth: 1 }, bounds);
    const deep = decideCadence({ ...base, readyBacklogDepth: 8 }, bounds);
    expect(deep.nextCadenceDays).toBeLessThanOrEqual(base.currentCadenceDays);
    expect(shallow.nextCadenceDays).toBeLessThanOrEqual(base.currentCadenceDays);
    expect(deep.nextCadenceDays).toBeLessThan(shallow.nextCadenceDays);
  });

  it("frequent Owner pulls → cadence not smaller (pushes up vs. the low-pull case)", () => {
    const calm = decideCadence({ ...base, ownerPullRate: 0.1 }, bounds);
    const thrashing = decideCadence({ ...base, ownerPullRate: 0.9 }, bounds);
    expect(thrashing.nextCadenceDays).toBeGreaterThanOrEqual(base.currentCadenceDays);
    expect(thrashing.nextCadenceDays).toBeGreaterThan(calm.nextCadenceDays);
  });

  it("always clamps into [minDays, maxDays] — clamps at the LOW end", () => {
    // current below the floor, backlog present → would go lower, clamps up to minDays.
    const d = decideCadence({ ...base, currentCadenceDays: 1, readyBacklogDepth: 8 }, bounds);
    expect(d.nextCadenceDays).toBe(bounds.minDays);
  });

  it("always clamps into [minDays, maxDays] — clamps at the HIGH end", () => {
    // current far above the ceiling → the shrink still lands above max, clamps down to maxDays.
    const d = decideCadence({ ...base, currentCadenceDays: 50, readyBacklogDepth: 1 }, bounds);
    expect(d.nextCadenceDays).toBe(bounds.maxDays);
  });

  it("high-pull clamps at maxDays too", () => {
    const d = decideCadence({ ...base, currentCadenceDays: 13, ownerPullRate: 1 }, bounds);
    expect(d.nextCadenceDays).toBeLessThanOrEqual(bounds.maxDays);
    expect(d.nextCadenceDays).toBe(bounds.maxDays);
  });
});

// --- Ledger block renderer ------------------------------------------------

describe("renderCadenceDecision — greppable ledger block (work-087)", () => {
  it("emits all four keys with the value substrings and the work-sweep loop name", () => {
    const out = renderCadenceDecision({
      ranAt: "2026-09-21T14:00:00Z",
      trigger: "scheduled",
      nextCadenceDays: 5,
      reason: "ready backlog 8 deep — waking sooner",
    });
    expect(out).toContain("### cadence-decision");
    expect(out).toContain("loop: work-sweep");
    expect(out).toContain("ran_at: 2026-09-21T14:00:00Z");
    expect(out).toContain("trigger: scheduled");
    expect(out).toContain("next_cadence_days: 5");
    expect(out).toContain("reason: ready backlog 8 deep — waking sooner");
    // Non-vacuous: a key not present in the block must not leak in.
    expect(out).not.toContain("owner_pull_rate:");
  });
});
