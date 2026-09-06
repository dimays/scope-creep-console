import { describe, expect, it } from "vitest";
import { parseMeta } from "./threads";
import {
  addGeneratedRequest,
  addMessage,
  archiveThread,
  branchThread,
  createOrgThread,
  createThread,
  firstOwnerBody,
  getThread,
  launchThread,
  linkThreadSession,
  listArchivedThreads,
  listThreads,
  orgFollowup,
  restoreThread,
  setStatus,
} from "./threads.server";

describe("Owner-initiated threads", () => {
  it("createThread opens an owner-initiated thread on the org's turn", async () => {
    const row = await createThread("Ship the queue", "Please build the needs-you queue.");
    expect(row.initiator).toBe("owner");
    expect(row.status).toBe("working"); // the org's court

    const loaded = await getThread(row.id);
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0].role).toBe("owner");
    expect(loaded?.thread.initiator).toBe("owner");
  });
});

describe("CoS-initiated threads (work-030)", () => {
  it("createOrgThread opens an org-initiated thread parked on the Owner", async () => {
    const row = await createOrgThread(
      "Need your call on model spend",
      "The nightly crank is nearing the token budget — pause or continue?",
    );
    expect(row.initiator).toBe("org");
    expect(row.status).toBe("needs-you"); // lands in the Owner's queue

    const loaded = await getThread(row.id);
    expect(loaded?.messages).toHaveLength(1);
    // The opener is an `agent` message — so it never enters the Human-Input Log
    // (which unions only role = owner). This is an org→Owner event, not a human input.
    expect(loaded?.messages[0].role).toBe("agent");
    expect(parseMeta(loaded?.messages[0].meta ?? null).author).toBe("chief-of-staff");
  });

  it("createOrgThread honors an explicit author and starting status", async () => {
    const row = await createOrgThread("FYI", "Heads up on the design pin.", {
      author: "chief-designer",
      status: "working",
    });
    const loaded = await getThread(row.id);
    expect(loaded?.thread.status).toBe("working");
    expect(parseMeta(loaded?.messages[0].meta ?? null).author).toBe("chief-designer");
  });

  it("orgFollowup posts on an existing thread and hands the turn back to the Owner", async () => {
    const row = await createThread("A question", "What should we prioritize?");
    // The org first takes the turn to work, then follows up needing the Owner.
    await setStatus(row.id, "working");
    await orgFollowup(row.id, "Two options — which do you prefer?");

    const loaded = await getThread(row.id);
    expect(loaded?.thread.status).toBe("needs-you");
    const last = loaded?.messages.at(-1);
    expect(last?.role).toBe("agent");
    expect(last?.body).toBe("Two options — which do you prefer?");
    expect(parseMeta(last?.meta ?? null).author).toBe("chief-of-staff");
  });

  it("orgFollowup reopens a closed thread onto the Owner's queue", async () => {
    const row = await createThread("Done thing", "Thanks!");
    await setStatus(row.id, "closed");
    await orgFollowup(row.id, "One more thing before we close this out.");

    const loaded = await getThread(row.id);
    expect(loaded?.thread.status).toBe("needs-you");
  });
});

describe("thread branching (work-032)", () => {
  it("branchThread links parent↔child both ways from a point in the parent", async () => {
    const parent = await createThread("Roadmap", "Let's talk Q4 priorities.");
    await addMessage(parent.id, "agent", "Here are three themes.", {
      status: "needs-you",
      meta: { author: "chief-of-staff" },
    });
    const loadedParent = await getThread(parent.id);
    const splitPoint = loadedParent?.messages.at(-1)?.id ?? null;

    const child = await branchThread({
      parentId: parent.id,
      title: "Theme 2 as its own effort",
      body: "Theme 2 deserves its own thread — let's scope it.",
      fromMessageId: splitPoint,
    });

    // Reverse link (child→parent) + the recorded split point.
    expect(child.parentId).toBe(parent.id);
    expect(child.branchedFromMessageId).toBe(splitPoint);
    expect(child.status).toBe("working"); // the Owner's tangent → the org's turn

    // The child is seeded with the Owner's tangent and knows its parent.
    const loadedChild = await getThread(child.id);
    expect(loadedChild?.parent).toEqual({ id: parent.id, title: "Roadmap" });
    expect(loadedChild?.messages).toHaveLength(1);
    expect(loadedChild?.messages[0].role).toBe("owner");
    expect(loadedChild?.messages[0].body).toBe("Theme 2 deserves its own thread — let's scope it.");

    // Forward link (parent→child): both a derived branches list and an inline `branch` card.
    const reloadedParent = await getThread(parent.id);
    expect(reloadedParent?.branches).toContainEqual({
      id: child.id,
      title: "Theme 2 as its own effort",
    });
    const branchCard = reloadedParent?.messages.find((m) => m.type === "branch");
    expect(branchCard).toBeTruthy();
    const meta = parseMeta(branchCard?.meta ?? null);
    expect(meta.childThreadId).toBe(child.id);
    expect(meta.refUrl).toBe(`/threads/${child.id}`);
  });

  it("branching does not change the parent's turn/status (a branch is not a reply)", async () => {
    const parent = await createThread("Keep working", "Please keep building.");
    expect((await getThread(parent.id))?.thread.status).toBe("working");
    await branchThread({ parentId: parent.id, title: "Tangent", body: "A side thought." });
    // Still `working` — only `updatedAt` was bumped so the parent resurfaces.
    expect((await getThread(parent.id))?.thread.status).toBe("working");
  });

  it("followups thread cleanly on a branched child", async () => {
    const parent = await createThread("P", "…");
    const child = await branchThread({ parentId: parent.id, title: "Child", body: "Scope this." });
    await addMessage(child.id, "agent", "Drafted a ticket.", {
      status: "needs-you",
      meta: { author: "chief-of-staff" },
    });
    const loaded = await getThread(child.id);
    expect(loaded?.thread.status).toBe("needs-you");
    expect(loaded?.messages).toHaveLength(2); // opener + followup, both on the child
    expect(loaded?.parent?.id).toBe(parent.id); // link intact after the followup
  });

  it("a non-branched thread has no parent and no branches", async () => {
    const t = await createThread("Solo", "No branches here.");
    const loaded = await getThread(t.id);
    expect(loaded?.parent).toBeNull();
    expect(loaded?.branches).toEqual([]);
  });
});

describe("generated feature-request cards (work-032)", () => {
  it("addGeneratedRequest records a first-class card linking to its created ticket", async () => {
    const thread = await createThread("New idea", "Could we branch tangents into threads?");
    await addGeneratedRequest(thread.id, {
      label: "Thread branching + generated-request cards",
      body: "Distilled from this thread — branch tangents into linked child threads.",
      refUrl: "/work/032",
      refLabel: "work-032",
    });

    const loaded = await getThread(thread.id);
    const card = loaded?.messages.find((m) => m.type === "generated-request");
    expect(card).toBeTruthy();
    expect(card?.role).toBe("agent"); // org-authored → never enters the Human-Input Log
    const meta = parseMeta(card?.meta ?? null);
    expect(meta.label).toBe("Thread branching + generated-request cards");
    expect(meta.refUrl).toBe("/work/032");
    expect(meta.refLabel).toBe("work-032");
    expect(meta.author).toBe("chief-of-staff");
  });

  it("a generated request can park the thread on the Owner", async () => {
    const thread = await createThread("Idea 2", "Another one.");
    await addGeneratedRequest(thread.id, {
      label: "A ticket",
      refUrl: "/work/099",
      status: "needs-you",
    });
    expect((await getThread(thread.id))?.thread.status).toBe("needs-you");
  });
});

describe("thread launcher (work-046, ADR-016)", () => {
  it("launchThread stamps launchedAt without duplicating the opener when unchanged", async () => {
    const t = await createThread("Launch me", "Give me a State of the Product.");
    const seed = await firstOwnerBody(t.id);
    expect(seed).toBe("Give me a State of the Product.");

    await launchThread(t.id, seed); // same as the opener — must not append a second copy
    const loaded = await getThread(t.id);
    expect(loaded?.thread.launchedAt).toBeTruthy();
    expect(loaded?.thread.status).toBe("working");
    const ownerMsgs = loaded?.messages.filter((m) => m.role === "owner" && m.type === "message");
    expect(ownerMsgs).toHaveLength(1); // no duplicate
  });

  it("launchThread records an edited seed as a new owner message", async () => {
    const t = await createThread("Edit at launch", "First draft of the ask.");
    await launchThread(t.id, "A refined ask, edited before launch.");
    const loaded = await getThread(t.id);
    const ownerMsgs = loaded?.messages.filter((m) => m.role === "owner" && m.type === "message");
    expect(ownerMsgs).toHaveLength(2);
    expect(ownerMsgs?.at(-1)?.body).toBe("A refined ask, edited before launch.");
    expect(loaded?.thread.launchedAt).toBeTruthy();
  });

  it("linkThreadSession persists the correlated session so it isn't rescanned", async () => {
    const t = await createThread("Correlate me", "Do a thing.");
    await launchThread(t.id, "Do a thing.");
    await linkThreadSession(t.id, "sess-uuid-xyz", "/home/.claude/projects/x/sess-uuid-xyz.jsonl");
    const loaded = await getThread(t.id);
    expect(loaded?.thread.sessionUuid).toBe("sess-uuid-xyz");
    expect(loaded?.thread.sessionPath).toBe("/home/.claude/projects/x/sess-uuid-xyz.jsonl");
  });

  it("a fresh thread is not launched and has no correlated session", async () => {
    const t = await createThread("Fresh", "Nothing launched yet.");
    const loaded = await getThread(t.id);
    expect(loaded?.thread.launchedAt).toBeNull();
    expect(loaded?.thread.sessionUuid).toBeNull();
  });
});

describe("archive / restore threads (work-049)", () => {
  it("archiveThread sets archived_at and restoreThread clears it", async () => {
    const t = await createThread("Wrap it up", "This one is done — tuck it away.");
    expect((await getThread(t.id))?.thread.archivedAt).toBeNull();

    await archiveThread(t.id);
    const archived = await getThread(t.id);
    expect(archived?.thread.archivedAt).toBeTruthy();
    // Orthogonal to status — the lifecycle is untouched by archiving.
    expect(archived?.thread.status).toBe("working");

    await restoreThread(t.id);
    expect((await getThread(t.id))?.thread.archivedAt).toBeNull();
  });

  it("archive is orthogonal to status — a closed thread can be archived and restored", async () => {
    const t = await createThread("Closed then archived", "Done and away.");
    await setStatus(t.id, "closed");
    await archiveThread(t.id);
    const loaded = await getThread(t.id);
    expect(loaded?.thread.status).toBe("closed"); // status preserved
    expect(loaded?.thread.archivedAt).toBeTruthy();
    await restoreThread(t.id);
    expect((await getThread(t.id))?.thread.status).toBe("closed"); // still closed after restore
    expect((await getThread(t.id))?.thread.archivedAt).toBeNull();
  });

  it("listThreads excludes archived; listArchivedThreads includes only archived", async () => {
    const live = await createThread("Stay visible", "Keep me on the board.");
    const gone = await createThread("Hide me", "Off the board, please.");
    await archiveThread(gone.id);

    const main = await listThreads();
    expect(main.some((t) => t.id === live.id)).toBe(true);
    expect(main.some((t) => t.id === gone.id)).toBe(false);
    expect(main.every((t) => t.archivedAt == null)).toBe(true);

    const archived = await listArchivedThreads();
    expect(archived.some((t) => t.id === gone.id)).toBe(true);
    expect(archived.some((t) => t.id === live.id)).toBe(false);
    expect(archived.every((t) => t.archivedAt != null)).toBe(true);
  });

  it("restore returns a thread to the main list", async () => {
    const t = await createThread("Round trip", "Archive then restore me.");
    await archiveThread(t.id);
    expect((await listThreads()).some((x) => x.id === t.id)).toBe(false);
    await restoreThread(t.id);
    expect((await listThreads()).some((x) => x.id === t.id)).toBe(true);
    expect((await listArchivedThreads()).some((x) => x.id === t.id)).toBe(false);
  });
});

describe("thread turn-flips", () => {
  it("an Owner reply flips the turn back to the org (working)", async () => {
    const row = await createOrgThread("Need input", "Please decide.");
    expect((await getThread(row.id))?.thread.status).toBe("needs-you");

    await addMessage(row.id, "owner", "Go with option A.");
    expect((await getThread(row.id))?.thread.status).toBe("working");
  });

  it("listThreads surfaces the needs-you queue members with initiator intact", async () => {
    await createOrgThread("Parked A", "…");
    const all = await listThreads();
    const parked = all.filter((t) => t.status === "needs-you" && t.initiator === "org");
    expect(parked.length).toBeGreaterThan(0);
  });
});
