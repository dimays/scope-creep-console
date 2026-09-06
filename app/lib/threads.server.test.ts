import { describe, expect, it } from "vitest";
import { parseMeta } from "./threads";
import {
  addMessage,
  createOrgThread,
  createThread,
  getThread,
  listThreads,
  orgFollowup,
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
