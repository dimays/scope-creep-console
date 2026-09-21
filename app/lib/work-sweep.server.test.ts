import { describe, expect, it } from "vitest";
import { createThread, getThread } from "./threads.server";
import type { WorkItem } from "./work.server";
import { evaluateMilestone } from "./work-sweep";
import {
  buildMilestoneSnapshot,
  computeReadySet,
  planCadence,
  toSweepTicket,
  WIP_CAP,
  writeBackOutcome,
} from "./work-sweep.server";

// --- Fixtures -------------------------------------------------------------

function item(over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-001",
    title: "A ticket",
    type: "feature",
    status: "proposed",
    priority: "medium",
    owner: "cto",
    assignees: [],
    spec: "prd-autonomous-execution-loop",
    created: "2026-09-01",
    updated: "2026-09-01",
    file: "001-a-ticket.md",
    ...over,
  };
}

// --- toSweepTicket --------------------------------------------------------

describe("toSweepTicket (work-086)", () => {
  it("maps group:=spec and carries id/status/priority/milestone", () => {
    const t = toSweepTicket(
      item({
        id: "work-042",
        status: "active",
        priority: "high",
        spec: "prd-request-loop",
        milestone: "owner-review",
      }),
    );
    expect(t).toEqual({
      id: "work-042",
      status: "active",
      priority: "high",
      group: "prd-request-loop",
      milestone: "owner-review",
    });
  });

  it("leaves group undefined when the ticket has no spec trace", () => {
    expect(toSweepTicket(item({ spec: undefined })).group).toBeUndefined();
  });
});

// --- computeReadySet ------------------------------------------------------

describe("computeReadySet (work-086)", () => {
  it("includes only workable (proposed|active) tickets — excludes terminal + blocked", () => {
    const items = [
      item({ id: "work-001", status: "proposed" }),
      item({ id: "work-002", status: "active" }),
      item({ id: "work-003", status: "blocked" }),
      item({ id: "work-004", status: "done" }),
    ];
    const ids = computeReadySet(items).ready.map((t) => t.id);
    expect(ids).toEqual(["work-001", "work-002"]);
  });

  it("excludes tickets with no live-spec trace (empty/undefined spec)", () => {
    const items = [
      item({ id: "work-001", spec: "prd-x" }),
      item({ id: "work-002", spec: undefined }),
      item({ id: "work-003", spec: "" }),
    ];
    expect(computeReadySet(items).ready.map((t) => t.id)).toEqual(["work-001"]);
  });

  it("excludes below-floor tickets", () => {
    const items = [
      item({ id: "work-001", priority: "high" }),
      item({ id: "work-002", priority: "medium" }),
      item({ id: "work-003", priority: "low" }),
    ];
    expect(computeReadySet(items, { floor: "medium" }).ready.map((t) => t.id)).toEqual([
      "work-001",
      "work-002",
    ]);
  });

  it("orders ready by priority rank then id", () => {
    const items = [
      item({ id: "work-002", priority: "medium" }),
      item({ id: "work-005", priority: "high" }),
      item({ id: "work-001", priority: "high" }),
      item({ id: "work-003", priority: "low" }),
    ];
    expect(computeReadySet(items).ready.map((t) => t.id)).toEqual([
      "work-001",
      "work-005",
      "work-002",
      "work-003",
    ]);
  });

  it("computes activeCount / wipCap / atCap", () => {
    const oneActive = computeReadySet([
      item({ id: "work-001", status: "active" }),
      item({ id: "work-002", status: "proposed" }),
    ]);
    expect(oneActive).toMatchObject({ activeCount: 1, wipCap: WIP_CAP, atCap: false });

    const atCap = computeReadySet([
      item({ id: "work-001", status: "active" }),
      item({ id: "work-002", status: "active" }),
    ]);
    expect(atCap).toMatchObject({ activeCount: 2, wipCap: 2, atCap: true });
  });

  it("exhausted is true only when no workable ticket at/above the floor remains", () => {
    const dry = computeReadySet([
      item({ id: "work-001", status: "done" }),
      item({ id: "work-002", status: "blocked" }),
    ]);
    expect(dry.exhausted).toBe(true);
    expect(dry.ready).toEqual([]);

    const hasWork = computeReadySet([item({ id: "work-001", status: "proposed" })]);
    expect(hasWork.exhausted).toBe(false);

    // A workable low ticket below a medium floor does NOT keep the backlog alive.
    const belowFloorOnly = computeReadySet(
      [item({ id: "work-001", status: "proposed", priority: "low" })],
      { floor: "medium" },
    );
    expect(belowFloorOnly.exhausted).toBe(true);
  });

  it("counts exhaustion independently of the spec trace (matches work-087's floor rule)", () => {
    // Workable + at-floor but no spec → not READY, but still keeps the backlog non-exhausted.
    const res = computeReadySet([item({ id: "work-001", status: "proposed", spec: undefined })]);
    expect(res.ready).toEqual([]);
    expect(res.exhausted).toBe(false);
  });
});

// --- buildMilestoneSnapshot + evaluateMilestone integration ---------------

describe("buildMilestoneSnapshot + evaluateMilestone (work-086 × work-087)", () => {
  it("completing the last workable ticket of a spec-group yields theme-boundary", () => {
    const items = [
      item({ id: "work-001", status: "done", spec: "prd-theme" }),
      item({ id: "work-002", status: "done", spec: "prd-theme" }),
      item({ id: "work-003", status: "done", spec: "other-theme" }),
    ];
    const snap = buildMilestoneSnapshot(items, "work-002");
    expect(evaluateMilestone(snap)).toContain("theme-boundary");
  });

  it("does NOT fire theme-boundary while a sibling is still workable/blocked", () => {
    const items = [
      item({ id: "work-001", status: "done", spec: "prd-theme" }),
      item({ id: "work-002", status: "blocked", spec: "prd-theme" }),
    ];
    const snap = buildMilestoneSnapshot(items, "work-001");
    expect(evaluateMilestone(snap)).not.toContain("theme-boundary");
  });

  it("a milestone: owner-review just-completed ticket yields explicit-marker", () => {
    const items = [
      item({ id: "work-001", status: "done", milestone: "owner-review", spec: "prd-theme" }),
      item({ id: "work-002", status: "proposed", spec: "prd-theme" }),
    ];
    const snap = buildMilestoneSnapshot(items, "work-001");
    expect(evaluateMilestone(snap)).toContain("explicit-marker");
  });

  it("a dry board yields priority-floor-exhausted", () => {
    const items = [item({ id: "work-001", status: "done", spec: "prd-theme" })];
    const snap = buildMilestoneSnapshot(items, "work-001");
    expect(evaluateMilestone(snap)).toContain("priority-floor-exhausted");
  });

  it("throws when the just-completed id is not on the board", () => {
    expect(() => buildMilestoneSnapshot([item({ id: "work-001" })], "work-999")).toThrow(
      /work-999/,
    );
  });
});

// --- write-back REUSE (same writer as request-triage) ---------------------

describe("writeBackOutcome reuse (work-086 → work-064 writer)", () => {
  it("dry-run through the runner returns the planned write and does NOT touch the store", async () => {
    const t = await createThread("Loop milestone", "please review");
    const planned = await writeBackOutcome(
      t.id,
      "needs-input",
      { label: "Milestone reached — your sign-off" },
      { dryRun: true },
    );
    expect(planned).toMatchObject({
      action: "write-back",
      dryRun: true,
      threadId: t.id,
      kind: "needs-input",
      status: "needs-you",
    });

    const loaded = await getThread(t.id);
    expect(loaded?.messages).toHaveLength(1); // only the owner opener — nothing was posted
    expect(loaded?.thread.status).toBe("working");
  });
});

// --- planCadence ----------------------------------------------------------

describe("planCadence (work-086 × work-087)", () => {
  const bounds = { minDays: 1, maxDays: 14 };

  it("returns a decision clamped within bounds and a block containing next_cadence_days", () => {
    const { decision, block } = planCadence(
      { currentCadenceDays: 7, readyBacklogDepth: 8, ownerPullRate: 0, wipActive: 1 },
      bounds,
      { ranAt: "2026-09-21T00:00:00.000Z", trigger: "post-ticket" },
    );
    expect(decision.nextCadenceDays).toBeGreaterThanOrEqual(bounds.minDays);
    expect(decision.nextCadenceDays).toBeLessThanOrEqual(bounds.maxDays);
    expect(block).toContain("### cadence-decision");
    expect(block).toContain(`next_cadence_days: ${decision.nextCadenceDays}`);
    expect(block).toContain("ran_at: 2026-09-21T00:00:00.000Z");
    expect(block).toContain("trigger: post-ticket");
  });

  it("backs off to the ceiling on a dry backlog", () => {
    const { decision } = planCadence(
      { currentCadenceDays: 3, readyBacklogDepth: 0, ownerPullRate: 0, wipActive: 0 },
      bounds,
      { ranAt: "2026-09-21T00:00:00.000Z", trigger: "work-sweep" },
    );
    expect(decision.nextCadenceDays).toBe(bounds.maxDays);
  });
});
