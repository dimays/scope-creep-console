import { describe, expect, it } from "vitest";
import type { NotifiableMessage, NotifiableThread, Thread } from "./threads";
import {
  buildNotifications,
  countUnread,
  groupThreads,
  isArchived,
  isNotableUpdate,
  isUnread,
  NOTABLE_MESSAGE_TYPES,
  needsYouThreads,
  parseMeta,
} from "./threads";

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

describe("notable org write-back types (work-064)", () => {
  it("isNotableUpdate is true only for the async write-back card types", () => {
    expect(isNotableUpdate("needs-input")).toBe(true);
    expect(isNotableUpdate("critical-update")).toBe(true);
    // Routine chatter and the older typed cards are not "notable" org signals.
    expect(isNotableUpdate("message")).toBe(false);
    expect(isNotableUpdate("outcome")).toBe(false);
    expect(isNotableUpdate("generated-request")).toBe(false);
    expect(isNotableUpdate("branch")).toBe(false);
    expect(isNotableUpdate("")).toBe(false);
  });

  it("NOTABLE_MESSAGE_TYPES is the single source of truth for isNotableUpdate", () => {
    for (const type of NOTABLE_MESSAGE_TYPES) {
      expect(isNotableUpdate(type)).toBe(true);
    }
  });
});

describe("unread derivation (work-063)", () => {
  it("isUnread is true when the newest org message postdates the last open", () => {
    expect(isUnread({ lastOrgAt: 200, lastReadAt: 100 })).toBe(true);
  });

  it("isUnread is false once the thread has been opened at/after its latest org activity", () => {
    expect(isUnread({ lastOrgAt: 100, lastReadAt: 100 })).toBe(false); // opened at the same tick
    expect(isUnread({ lastOrgAt: 100, lastReadAt: 200 })).toBe(false); // opened after
  });

  it("a never-opened thread with org activity is unread; owner-only activity never is", () => {
    expect(isUnread({ lastOrgAt: 100, lastReadAt: null })).toBe(true);
    expect(isUnread({ lastOrgAt: null, lastReadAt: null })).toBe(false); // no org message
    expect(isUnread({ lastOrgAt: null, lastReadAt: 100 })).toBe(false);
  });

  it("countUnread counts only the threads that are unread", () => {
    const count = countUnread([
      { lastOrgAt: 200, lastReadAt: 100 }, // unread
      { lastOrgAt: 100, lastReadAt: 100 }, // read
      { lastOrgAt: 300, lastReadAt: null }, // unread
      { lastOrgAt: null, lastReadAt: null }, // no org activity
    ]);
    expect(count).toBe(2);
  });
});

describe("notification feed (work-063)", () => {
  const thread = (
    over: Partial<NotifiableThread> & Pick<NotifiableThread, "id">,
  ): NotifiableThread => ({
    title: `Thread ${over.id}`,
    status: "working",
    updatedAt: over.id,
    archivedAt: null,
    lastOrgAt: null,
    lastReadAt: null,
    ...over,
  });
  const msg = (
    over: Partial<NotifiableMessage> & Pick<NotifiableMessage, "conversationId" | "type" | "at">,
  ): NotifiableMessage => ({ body: "", meta: null, ...over });

  it("lists notable org updates + needs-you threads, newest-first, each linking to its thread", () => {
    const threads = [
      thread({ id: 1, status: "needs-you", updatedAt: 50, lastOrgAt: 50 }),
      thread({ id: 2, status: "working", updatedAt: 40, lastOrgAt: 40 }),
    ];
    const messages = [
      msg({ conversationId: 2, type: "critical-update", at: 40, meta: '{"label":"Triaged"}' }),
    ];
    const items = buildNotifications(threads, messages);
    // Newest-first by ts: thread 1's needs-you (ts 50) before thread 2's update (ts 40).
    expect(items.map((i) => i.threadId)).toEqual([1, 2]);
    expect(items[0].kind).toBe("needs-you");
    expect(items[1].kind).toBe("critical-update");
    expect(items[1].label).toBe("Triaged");
    expect(items.every((i) => i.href === `/threads/${i.threadId}`)).toBe(true);
  });

  it("dedups: a needs-you thread already shown via its notable message is not repeated", () => {
    const threads = [thread({ id: 7, status: "needs-you", updatedAt: 100, lastOrgAt: 100 })];
    const messages = [
      msg({ conversationId: 7, type: "needs-input", at: 100, meta: '{"label":"Your call?"}' }),
    ];
    const items = buildNotifications(threads, messages);
    expect(items).toHaveLength(1); // the message, not a duplicate bare needs-you row
    expect(items[0].kind).toBe("needs-input");
    expect(items[0].label).toBe("Your call?");
  });

  it("a needs-you thread parked without a typed card still surfaces (via orgFollowup)", () => {
    const threads = [thread({ id: 3, status: "needs-you", updatedAt: 70, lastOrgAt: 70 })];
    const items = buildNotifications(threads, []); // no notable message rows
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("needs-you");
  });

  it("excludes archived threads and their messages", () => {
    const threads = [thread({ id: 4, status: "needs-you", updatedAt: 80, archivedAt: 999 })];
    const messages = [msg({ conversationId: 4, type: "needs-input", at: 80 })];
    expect(buildNotifications(threads, messages)).toEqual([]);
  });

  it("carries the unread flag from the thread's read-state", () => {
    const threads = [
      thread({ id: 5, status: "needs-you", updatedAt: 60, lastOrgAt: 60, lastReadAt: null }),
      thread({ id: 6, status: "needs-you", updatedAt: 55, lastOrgAt: 55, lastReadAt: 55 }),
    ];
    const items = buildNotifications(threads, []);
    expect(items.find((i) => i.threadId === 5)?.unread).toBe(true);
    expect(items.find((i) => i.threadId === 6)?.unread).toBe(false);
  });

  it("ignores non-notable message types", () => {
    const threads = [thread({ id: 8, status: "working", updatedAt: 90 })];
    const messages = [msg({ conversationId: 8, type: "message", at: 90 })];
    expect(buildNotifications(threads, messages)).toEqual([]);
  });

  // --- Noise reduction: collapse + consume FYIs (Owner "absurd notifications" fix) ---

  it("collapses a burst of critical-updates on one thread into a single newest row", () => {
    const threads = [thread({ id: 10, status: "working", updatedAt: 5, lastOrgAt: 5 })];
    const messages = [
      msg({ conversationId: 10, type: "critical-update", at: 1, meta: '{"label":"step 1"}' }),
      msg({ conversationId: 10, type: "critical-update", at: 2, meta: '{"label":"step 2"}' }),
      msg({ conversationId: 10, type: "critical-update", at: 5, meta: '{"label":"step 3"}' }),
    ];
    const items = buildNotifications(threads, messages);
    expect(items).toHaveLength(1); // three pings → one row
    expect(items[0].kind).toBe("critical-update");
    expect(items[0].label).toBe("step 3"); // the newest survives
    expect(items[0].ts).toBe(5);
  });

  it("drops a critical-update FYI once the thread has been read (consumed, not a standing signal)", () => {
    const threads = [
      // read: lastReadAt >= lastOrgAt → not unread → FYI consumed, no row.
      thread({ id: 11, status: "working", updatedAt: 40, lastOrgAt: 40, lastReadAt: 40 }),
      // unread: still surfaces.
      thread({ id: 12, status: "working", updatedAt: 30, lastOrgAt: 30, lastReadAt: null }),
    ];
    const messages = [
      msg({ conversationId: 11, type: "critical-update", at: 40, meta: '{"label":"seen"}' }),
      msg({ conversationId: 12, type: "critical-update", at: 30, meta: '{"label":"unseen"}' }),
    ];
    const items = buildNotifications(threads, messages);
    expect(items.map((i) => i.threadId)).toEqual([12]); // only the unread FYI
    expect(items[0].label).toBe("unseen");
  });

  it("a needs-you blocker persists even after the thread is read (a standing 'your turn')", () => {
    const threads = [
      thread({ id: 13, status: "needs-you", updatedAt: 20, lastOrgAt: 20, lastReadAt: 99 }),
    ];
    const items = buildNotifications(threads, []);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("needs-you");
    expect(items[0].unread).toBe(false); // shown despite being read — it's a blocker
  });

  it("a blocker outranks an FYI on the same thread: one needs-input row, not two", () => {
    const threads = [thread({ id: 14, status: "needs-you", updatedAt: 60, lastOrgAt: 60 })];
    const messages = [
      msg({ conversationId: 14, type: "critical-update", at: 50, meta: '{"label":"progress"}' }),
      msg({ conversationId: 14, type: "needs-input", at: 60, meta: '{"label":"decide this"}' }),
    ];
    const items = buildNotifications(threads, messages);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("needs-input");
    expect(items[0].label).toBe("decide this");
  });
});

describe("parseMeta", () => {
  it("returns {} for null or malformed JSON, and the object otherwise", () => {
    expect(parseMeta(null)).toEqual({});
    expect(parseMeta("{ not json")).toEqual({});
    expect(parseMeta('{"author":"chief-of-staff"}')).toEqual({ author: "chief-of-staff" });
  });
});
