import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claudeProjectDirName } from "./claude-sessions";
import {
  findSessionForThread,
  projectSessionFile,
  resolveThreadProjection,
  verifyClaudeCliScheme,
} from "./claude-sessions.server";

// A throwaway ~/.claude/projects root, so the correlation/projection logic is exercised
// against a fixture JSONL — never the Owner's real sessions.
const CWD = "/Users/test/code/scope-creep";
let root: string;
let sessionPath: string;
const SESSION_UUID = "11111111-2222-3333-4444-555555555555";
const prevProjectsDir = process.env.CLAUDE_PROJECTS_DIR;

const FIXTURE = readFileSync(join(__dirname, "__fixtures__", "claude-session.jsonl"), "utf8");

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sc-projects-"));
  process.env.CLAUDE_PROJECTS_DIR = root;
  const dir = join(root, claudeProjectDirName(CWD));
  mkdirSync(dir, { recursive: true });
  sessionPath = join(dir, `${SESSION_UUID}.jsonl`);
  // The fixture's first owner message carries [scope-creep-thread:7].
  writeFileSync(sessionPath, FIXTURE, "utf8");
  // A decoy session for a different thread — must not match thread 7.
  writeFileSync(
    join(dir, "decoy.jsonl"),
    '{"type":"user","isSidechain":false,"message":{"role":"user","content":"unrelated [scope-creep-thread:99]"},"timestamp":"2026-09-06T00:00:00.000Z"}\n',
    "utf8",
  );
});

afterAll(() => {
  if (prevProjectsDir === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
  else process.env.CLAUDE_PROJECTS_DIR = prevProjectsDir;
});

describe("findSessionForThread (correlation by marker)", () => {
  it("finds the session whose first owner message carries the thread marker", async () => {
    const match = await findSessionForThread(7, CWD);
    expect(match?.uuid).toBe(SESSION_UUID);
    expect(match?.path).toBe(sessionPath);
  });

  it("returns null when no session carries the thread marker", async () => {
    expect(await findSessionForThread(1234, CWD)).toBeNull();
  });

  it("returns null (never throws) when the project dir does not exist", async () => {
    expect(await findSessionForThread(7, "/no/such/repo/anywhere")).toBeNull();
  });
});

describe("projectSessionFile", () => {
  it("projects a real file path into a transcript", async () => {
    const turns = await projectSessionFile(sessionPath);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns[0]).toMatchObject({ role: "owner" });
  });

  it("returns [] for an unreadable path", async () => {
    expect(await projectSessionFile("/no/such/file.jsonl")).toEqual([]);
  });
});

describe("resolveThreadProjection (orchestration)", () => {
  it("not-launched → no turns, but launch affordances are ready", async () => {
    const p = await resolveThreadProjection(
      { id: 7, launchedAt: null, sessionUuid: null, sessionPath: null },
      "Give me a concise State of the Product.",
      CWD,
    );
    expect(p.status).toBe("not-launched");
    expect(p.turns).toEqual([]);
    expect(p.deepLink).toContain("claude://code/new?q=");
    expect(p.deepLink).toContain(`folder=${encodeURIComponent(CWD)}`);
    // The correlation marker survives into q so work-047 can resolve the resulting session.
    expect(p.deepLink).toContain(encodeURIComponent("[scope-creep-thread:7]"));
    expect(typeof p.schemeRegistered).toBe("boolean");
  });

  it("launched + uncorrelated → resolves by marker and flags newlyResolved", async () => {
    const p = await resolveThreadProjection(
      { id: 7, launchedAt: Date.now(), sessionUuid: null, sessionPath: null },
      "Give me a concise State of the Product.",
      CWD,
    );
    expect(p.status).toBe("matched");
    expect(p.newlyResolved).toBe(true);
    expect(p.sessionUuid).toBe(SESSION_UUID);
    expect(p.resumeCommand).toBe(`claude --resume ${SESSION_UUID}`);
    expect(p.turns.length).toBeGreaterThan(0);
  });

  it("launched + already linked → projects the stored path, not newly resolved", async () => {
    const p = await resolveThreadProjection(
      { id: 7, launchedAt: Date.now(), sessionUuid: SESSION_UUID, sessionPath },
      "seed",
      CWD,
    );
    expect(p.status).toBe("matched");
    expect(p.newlyResolved).toBe(false);
    expect(p.turns.length).toBeGreaterThan(0);
  });

  it("launched + no matching session → pending (empty is empty), no fabricated turns", async () => {
    const p = await resolveThreadProjection(
      { id: 424242, launchedAt: Date.now(), sessionUuid: null, sessionPath: null },
      "seed with no session yet",
      CWD,
    );
    expect(p.status).toBe("pending");
    expect(p.turns).toEqual([]);
    expect(p.resumeCommand).toBeNull();
  });
});

describe("verifyClaudeCliScheme", () => {
  it("resolves to a boolean without throwing", async () => {
    expect(typeof (await verifyClaudeCliScheme())).toBe("boolean");
  });
});
