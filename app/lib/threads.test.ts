import { describe, expect, it } from "vitest";
import type { Thread } from "./threads";
import { groupThreads, isArchived, needsYouThreads, parseMeta } from "./threads";

// A minimal thread factory — only the fields the pure derivations read.
function thread(over: Partial<Thread> & Pick<Thread, "id" | "status">): Thread {
  return {
    kind: "request",
    title: `Thread ${over.id}`,
    initiator: "owner",
    createdAt: 0,
    updatedAt: over.id, // default: id doubles as recency for deterministic ordering
    ...over,
  } as Thread;
}

describe("needs-you queue derivation (work-030)", () => {
  it("needsYouThreads keeps only threads parked on the Owner", () => {
    const threads = [
      thread({ id: 1, status: "needs-you" }),
      thread({ id: 2, status: "working" }),
      thread({ id: 3, status: "closed" }),
      thread({ id: 4, status: "open" }),
      thread({ id: 5, status: "needs-you" }),
    ];
    const queue = needsYouThreads(threads);
    expect(queue.map((t) => t.id)).toEqual([1, 5]);
  });

  it("needsYouThreads is empty when nothing is parked on the Owner", () => {
    const threads = [thread({ id: 1, status: "working" }), thread({ id: 2, status: "closed" })];
    expect(needsYouThreads(threads)).toHaveLength(0);
  });

  it("groupThreads partitions into needs-you / active / closed, each in exactly one group", () => {
    const threads = [
      thread({ id: 1, status: "needs-you" }),
      thread({ id: 2, status: "working" }),
      thread({ id: 3, status: "closed" }),
      thread({ id: 4, status: "open" }),
    ];
    const { needsYou, active, closed } = groupThreads(threads);
    expect(needsYou.map((t) => t.id)).toEqual([1]);
    // `working` and `open` both count as active (the org's court or freshly opened).
    expect(active.map((t) => t.id).sort()).toEqual([2, 4]);
    expect(closed.map((t) => t.id)).toEqual([3]);
    // No thread is dropped or double-counted.
    expect(needsYou.length + active.length + closed.length).toBe(threads.length);
  });

  it("groupThreads sorts each group newest-updated first", () => {
    const threads = [
      thread({ id: 1, status: "needs-you", updatedAt: 100 }),
      thread({ id: 2, status: "needs-you", updatedAt: 300 }),
      thread({ id: 3, status: "needs-you", updatedAt: 200 }),
    ];
    const { needsYou } = groupThreads(threads);
    expect(needsYou.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it("groupThreads does not mutate its input", () => {
    const threads = [
      thread({ id: 1, status: "working", updatedAt: 1 }),
      thread({ id: 2, status: "needs-you", updatedAt: 2 }),
    ];
    const before = threads.map((t) => t.id);
    groupThreads(threads);
    expect(threads.map((t) => t.id)).toEqual(before);
  });
});

describe("archive exclusion from groupings (work-049)", () => {
  it("isArchived reflects a stamped archived_at", () => {
    expect(isArchived(thread({ id: 1, status: "open" }))).toBe(false);
    expect(isArchived(thread({ id: 2, status: "open", archivedAt: Date.now() }))).toBe(true);
  });

  it("needsYouThreads drops archived threads even if their status is needs-you", () => {
    const threads = [
      thread({ id: 1, status: "needs-you" }),
      thread({ id: 2, status: "needs-you", archivedAt: Date.now() }),
    ];
    expect(needsYouThreads(threads).map((t) => t.id)).toEqual([1]);
  });

  it("groupThreads excludes archived threads from every group", () => {
    const threads = [
      thread({ id: 1, status: "needs-you" }),
      thread({ id: 2, status: "working" }),
      thread({ id: 3, status: "closed" }),
      thread({ id: 4, status: "needs-you", archivedAt: Date.now() }),
      thread({ id: 5, status: "working", archivedAt: Date.now() }),
      thread({ id: 6, status: "closed", archivedAt: Date.now() }),
    ];
    const { needsYou, active, closed } = groupThreads(threads);
    expect(needsYou.map((t) => t.id)).toEqual([1]);
    expect(active.map((t) => t.id)).toEqual([2]);
    expect(closed.map((t) => t.id)).toEqual([3]);
    // The three archived threads appear in no group.
    expect(needsYou.length + active.length + closed.length).toBe(3);
  });
});

describe("parseMeta", () => {
  it("returns {} for null or malformed JSON, and the object otherwise", () => {
    expect(parseMeta(null)).toEqual({});
    expect(parseMeta("{ not json")).toEqual({});
    expect(parseMeta('{"author":"chief-of-staff"}')).toEqual({ author: "chief-of-staff" });
  });
});
