import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, ensureSchema } from "~/db";
import { conversationMessages, conversations, feedback } from "~/db/schema";
import { buildSpine, listHumanInput } from "./human-input.server";

const prevHome = process.env.SCOPE_CREEP_HOME;

beforeAll(async () => {
  await ensureSchema();

  // A fixture control-plane home holding one operator-session capture line.
  const home = await mkdtemp(join(tmpdir(), "sc-home-"));
  await mkdir(join(home, "human-input"), { recursive: true });
  await writeFile(
    join(home, "human-input", "2026-09.ndjson"),
    `${JSON.stringify({
      source: "operator-session",
      ts: 1_700_000_000_000,
      session: "s",
      cwd: "/x",
      text: "kick off work-026 runtime tests",
    })}\n`,
  );
  process.env.SCOPE_CREEP_HOME = home; // not a git repo → commitsBetween returns []

  // Seed the in-DB owner-input sources on the unified conversation primitive: a
  // chat-kind thread (→ console-chat) and a request-kind thread (→ work-request).
  const now = 1_700_000_000_000;
  const [chat] = await db
    .insert(conversations)
    .values({ kind: "chat", title: "Console chat", status: "open", createdAt: now, updatedAt: now })
    .returning();
  await db.insert(conversationMessages).values({
    conversationId: chat.id,
    role: "owner",
    body: "a chat directive",
    at: 1_700_000_100_000,
  });
  const [req] = await db
    .insert(conversations)
    .values({
      kind: "request",
      title: "a work request",
      status: "working",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await db.insert(conversationMessages).values({
    conversationId: req.id,
    role: "owner",
    body: "a work request",
    at: 1_700_000_200_000,
  });
  await db
    .insert(feedback)
    .values({ contextKey: "explore", rating: "up", comment: "nice", at: 1_700_000_300_000 });
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.SCOPE_CREEP_HOME;
  else process.env.SCOPE_CREEP_HOME = prevHome;
});

describe("listHumanInput", () => {
  it("unions the DB sources + the operator-session ndjson, newest first", async () => {
    const events = await listHumanInput();
    const sources = new Set(events.map((e) => e.source));
    expect(sources.has("operator-session")).toBe(true);
    expect(sources.has("console-chat")).toBe(true);
    expect(sources.has("work-request")).toBe(true);
    expect(sources.has("feedback")).toBe(true);

    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].ts >= events[i].ts).toBe(true); // newest-first
    }

    const op = events.find((e) => e.source === "operator-session");
    expect(op?.summary).toContain("work-026");
  });

  it("buildSpine returns the inputs (no git interludes in a fixture home)", async () => {
    const spine = await buildSpine();
    const inputs = spine.filter((s) => s.kind === "input");
    expect(inputs.length).toBeGreaterThanOrEqual(4);
  });
});
