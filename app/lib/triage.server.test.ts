import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archiveThread, createOrgThread, createThread, getThread } from "./threads.server";
import {
  authorTicketPR,
  isKnownFixtureThread,
  listNewRequestThreads,
  nextTicketId,
  renderTicket,
  type TicketSpec,
  ticketId,
  ticketPath,
  writeBackOutcome,
} from "./triage.server";

async function sweptIds(): Promise<Set<number>> {
  return new Set((await listNewRequestThreads()).map((t) => t.id));
}

describe("listNewRequestThreads — the sweep (work-066)", () => {
  // NB (work-115): these sweep-membership fixtures deliberately use content that is NOT on the
  // FIXTURE_DENYLIST, so they exercise the genuine sweep path. The denylist skip itself is
  // proven in the dedicated "work-115" block below.
  it("includes a fresh owner request thread with no org reply", async () => {
    const t = await createThread("Speed up the dashboard", "The metrics view takes 8s to load.");
    expect(await sweptIds()).toContain(t.id);
  });

  it("drops a thread once the org has written back (never re-triaged)", async () => {
    const t = await createThread("Export threads to CSV", "I'd like to export my threads as CSV.");
    expect(await sweptIds()).toContain(t.id);
    await writeBackOutcome(t.id, "critical-update", { label: "Triaged — ticket created" });
    expect(await sweptIds()).not.toContain(t.id);
  });

  it("never sweeps chat-kind, org-initiated, or archived threads", async () => {
    const chat = await createThread("Just chatting", "hi", "chat");
    const org = await createOrgThread("Org opener", "The org needs your call.");
    const archived = await createThread("Old ask", "please do X");
    await archiveThread(archived.id);

    const ids = await sweptIds();
    expect(ids).not.toContain(chat.id);
    expect(ids).not.toContain(org.id);
    expect(ids).not.toContain(archived.id);
  });

  it("orders oldest-first (FIFO triage)", async () => {
    const a = await createThread("Older ask", "Filed earlier in the queue.");
    const b = await createThread("Newer ask", "Filed later in the queue.");
    const swept = await listNewRequestThreads();
    const ia = swept.findIndex((t) => t.id === a.id);
    const ib = swept.findIndex((t) => t.id === b.id);
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib).toBeGreaterThan(ia);
  });
});

describe("known-fixture skip — defense-in-depth (work-115)", () => {
  it("skips a known console test fixture even when it is a fresh, unanswered request", async () => {
    // Verbatim from triage.server.test.ts — exactly the kind of row that leaked into the store.
    const fixture = await createThread("Add a dark mode toggle", "Please add dark mode.");
    // A genuine Owner request with the same shape must still be swept.
    const real = await createThread(
      "Add SSO to the admin panel",
      "We need SSO for the admin panel.",
    );

    const ids = await sweptIds();
    expect(ids).not.toContain(fixture.id); // dropped defensively
    expect(ids).toContain(real.id); // genuine request untouched
  });

  it("only skips on an EXACT title+body pair — a matching title with a different body is kept", async () => {
    // Same title as a fixture, but a real body → NOT a fixture; the sweep must keep it.
    const t = await createThread(
      "Add a dark mode toggle",
      "Actually, make the whole app dark by default.",
    );
    expect(await sweptIds()).toContain(t.id);
  });

  it("isKnownFixtureThread matches exact fixture pairs and nothing else", () => {
    expect(isKnownFixtureThread("Add a dark mode toggle", "Please add dark mode.")).toBe(true);
    expect(isKnownFixtureThread("a work request", "a work request")).toBe(true);
    expect(
      isKnownFixtureThread(
        "Theme 2 as its own effort",
        "Theme 2 deserves its own thread — let's scope it.",
      ),
    ).toBe(true);
    // work-115 (CoS re-audit): fixtures from the previously-unscanned test files.
    // route-entrypoints.test.ts (owner-initiated request threads via the /threads route).
    expect(isKnownFixtureThread("A test thread", "Please do the thing.")).toBe(true);
    expect(isKnownFixtureThread("A tangent", "This deserves its own thread.")).toBe(true);
    expect(isKnownFixtureThread("Round-trip via route", "Archive then restore.")).toBe(true);
    // work-sweep.server.test.ts.
    expect(isKnownFixtureThread("Loop milestone", "please review")).toBe(true);
    // Org-initiated fixtures are intentionally NOT on the denylist — the sweep filters
    // initiator="owner", so they can never reach it (the cleanup doc's dedup criterion
    // removes them from the store instead).
    expect(isKnownFixtureThread("Org opener", "The org needs your call.")).toBe(false);
    // Title-only or body-only matches are NOT enough (never drop a real request).
    expect(isKnownFixtureThread("Add a dark mode toggle", "A genuine, different ask.")).toBe(false);
    expect(isKnownFixtureThread("A genuine title", "Please add dark mode.")).toBe(false);
    expect(
      isKnownFixtureThread("Add SSO to the admin panel", "We need SSO for the admin panel."),
    ).toBe(false);
  });
});

describe("writeBackOutcome — the write-back path (work-066)", () => {
  it("dry-run returns the planned write and does NOT touch the thread", async () => {
    const t = await createThread("Rename the workspace", "Rename the workspace to Scope Creep HQ.");
    const planned = await writeBackOutcome(
      t.id,
      "needs-input",
      { label: "Need your call" },
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
    expect(await sweptIds()).toContain(t.id); // still untriaged
  });

  it("critical-update keeps the org's turn (working)", async () => {
    const t = await createThread("FYI path", "test");
    await writeBackOutcome(t.id, "critical-update", { label: "Declined — out of scope" });
    const loaded = await getThread(t.id);
    expect(loaded?.thread.status).toBe("working");
    expect(loaded?.messages.at(-1)?.type).toBe("critical-update");
  });

  it("needs-input parks the thread on the Owner (needs-you)", async () => {
    const t = await createThread("Judgment path", "test");
    await writeBackOutcome(t.id, "needs-input", { label: "Your call on scope" });
    const loaded = await getThread(t.id);
    expect(loaded?.thread.status).toBe("needs-you");
    expect(loaded?.messages.at(-1)?.type).toBe("needs-input");
  });

  it("honours an explicit status override (e.g. decline → closed)", async () => {
    const t = await createThread("Close it", "test");
    await writeBackOutcome(t.id, "critical-update", { label: "Declined", status: "closed" });
    const loaded = await getThread(t.id);
    expect(loaded?.thread.status).toBe("closed");
  });
});

describe("ticket authoring — render + id (work-066)", () => {
  const base: TicketSpec = {
    num: 78,
    slug: "remote-thread-store",
    title: "A shiny new capability",
    type: "feature",
    owner: "chief-of-staff",
    priority: "high",
    spec: "prd-request-loop",
    body: "Do the thing.\n\nAcceptance: it works.",
    date: "2026-09-07",
  };

  it("ticketId / ticketPath pad to three digits", () => {
    expect(ticketId(78)).toBe("work-078");
    expect(ticketId(3)).toBe("work-003");
    expect(ticketPath(78, "remote-thread-store")).toBe("work/078-remote-thread-store.md");
  });

  it("renderTicket emits parseable frontmatter + body, status proposed", () => {
    const md = renderTicket(base);
    expect(md).toContain("id: work-078");
    expect(md).toContain("title: A shiny new capability");
    expect(md).toContain("status: proposed");
    expect(md).toContain("priority: high");
    expect(md).toContain("owner: chief-of-staff");
    expect(md).toContain("spec: prd-request-loop");
    expect(md).toContain("created: 2026-09-07");
    expect(md.trimEnd().endsWith("Acceptance: it works.")).toBe(true);
  });

  it("omits the spec line when there is no tracing spec (new scope)", () => {
    const md = renderTicket({ ...base, spec: undefined });
    expect(md).not.toContain("spec:");
  });

  it("authorTicketPR dry-run returns the rendered ticket without opening a PR", async () => {
    const planned = await authorTicketPR(base, { dryRun: true });
    expect(planned).toMatchObject({
      action: "author-ticket",
      dryRun: true,
      id: "work-078",
      path: "work/078-remote-thread-store.md",
    });
    expect(planned.prUrl).toBeUndefined();
    expect(planned.branch).toBeUndefined();
    expect(planned.content).toContain("id: work-078");
  });
});

describe("nextTicketId (work-066)", () => {
  it("returns one past the highest NNN- ticket in a work dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-work-"));
    await writeFile(join(dir, "001-first.md"), "x");
    await writeFile(join(dir, "064-write-back.md"), "x");
    await writeFile(join(dir, "077-cadence.md"), "x");
    await writeFile(join(dir, "README.md"), "x"); // ignored
    expect(await nextTicketId(dir)).toBe(78);
  });

  it("returns 1 for a missing/empty dir", async () => {
    expect(await nextTicketId(join(tmpdir(), "sc-nope-does-not-exist"))).toBe(1);
  });
});
