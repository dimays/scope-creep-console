import { describe, expect, it } from "vitest";
import type { ProjectedTurn, ProjectionStatus } from "./claude-sessions";
import { isSeedMessage, projectionHasTurns, shouldRenderWhenLaunched } from "./thread-view";

// Minimal builders — the helpers reason structurally over just these fields (work-089).
function msg(overrides: Partial<{ id: number; role: string; type: string }> = {}) {
  return { id: 1, role: "owner", type: "message", ...overrides };
}
function projection(status: ProjectionStatus, turns: ProjectedTurn[] = []) {
  return { status, turns };
}
const TURN: ProjectedTurn = { role: "owner", text: "hi" };

describe("projectionHasTurns", () => {
  it("is true only for a matched projection with at least one turn", () => {
    expect(projectionHasTurns(projection("matched", [TURN]))).toBe(true);
  });

  it("is false for a matched-but-empty projection (cloud launch, no local JSONL)", () => {
    expect(projectionHasTurns(projection("matched", []))).toBe(false);
  });

  it("is false for a not-yet-correlated projection regardless of any stray turns", () => {
    expect(projectionHasTurns(projection("pending"))).toBe(false);
    expect(projectionHasTurns(projection("not-launched"))).toBe(false);
  });
});

describe("isSeedMessage", () => {
  it("matches the Owner's first plain message by id", () => {
    expect(isSeedMessage(msg({ id: 7 }), 7)).toBe(true);
  });

  it("does not match a different message id", () => {
    expect(isSeedMessage(msg({ id: 9 }), 7)).toBe(false);
  });

  it("does not match a non-owner or non-plain message even at the seed id", () => {
    expect(isSeedMessage(msg({ id: 7, role: "agent" }), 7)).toBe(false);
    expect(isSeedMessage(msg({ id: 7, type: "outcome" }), 7)).toBe(false);
  });

  it("never matches when there is no seed id", () => {
    expect(isSeedMessage(msg({ id: 7 }), null)).toBe(false);
    expect(isSeedMessage(msg({ id: 7 }), undefined)).toBe(false);
  });
});

describe("shouldRenderWhenLaunched — the work-089 fix", () => {
  const seedId = 7;
  const seed = msg({ id: seedId });
  const plain = msg({ id: 42 });

  it("shows the seed when a matched projection has NO turns (cloud launch)", () => {
    expect(
      shouldRenderWhenLaunched(seed, {
        seedMessageId: seedId,
        projectionHasTurns: projectionHasTurns(projection("matched", [])),
      }),
    ).toBe(true);
  });

  it("shows the seed when the projection is unavailable (pending/unmatched)", () => {
    expect(
      shouldRenderWhenLaunched(seed, {
        seedMessageId: seedId,
        projectionHasTurns: projectionHasTurns(projection("pending")),
      }),
    ).toBe(true);
  });

  it("HIDES the seed when the transcript actually has turns (the opener would duplicate)", () => {
    expect(
      shouldRenderWhenLaunched(seed, {
        seedMessageId: seedId,
        projectionHasTurns: projectionHasTurns(projection("matched", [TURN])),
      }),
    ).toBe(false);
  });

  it("HIDES a non-seed plain message even when the transcript is empty (transcript's job)", () => {
    expect(
      shouldRenderWhenLaunched(plain, {
        seedMessageId: seedId,
        projectionHasTurns: projectionHasTurns(projection("matched", [])),
      }),
    ).toBe(false);
  });

  // Typed cards (outcome/generated-request/branch/critical-update/needs-input) are NOT routed
  // through this helper — they render before the `launched` check in thread.tsx. Documented
  // here: even at the seed id, a typed row is not a plain message and is never shown by it.
  it("does not govern typed cards — a typed row is never rendered as a plain message", () => {
    const card = msg({ id: seedId, type: "outcome" });
    expect(
      shouldRenderWhenLaunched(card, {
        seedMessageId: seedId,
        projectionHasTurns: projectionHasTurns(projection("matched", [])),
      }),
    ).toBe(false);
  });
});
