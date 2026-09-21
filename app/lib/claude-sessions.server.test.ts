import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claudeProjectDirName } from "./claude-sessions";
import {
  __resetSchemeCache,
  findSessionForThread,
  projectSessionFile,
  resolveControlPlaneHome,
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

  it("finds a session that landed in a DIFFERENT project dir (folder param didn't take)", async () => {
    // The real dogfood bug: the launched session opened in the console repo's project dir,
    // not the control-plane one. Correlation by the (globally-unique) marker must still find it.
    const otherDir = join(root, claudeProjectDirName("/Users/test/code/scope-creep-console"));
    mkdirSync(otherDir, { recursive: true });
    const otherUuid = "99999999-8888-7777-6666-555555555555";
    writeFileSync(
      join(otherDir, `${otherUuid}.jsonl`),
      '{"type":"user","isSidechain":false,"message":{"role":"user","content":"do a thing [scope-creep-thread:8]"},"timestamp":"2026-09-06T00:00:00.000Z"}\n',
      "utf8",
    );
    const match = await findSessionForThread(8, CWD);
    expect(match?.uuid).toBe(otherUuid);
  });

  it("returns null (never throws) when the projects root does not exist", async () => {
    const prev = process.env.CLAUDE_PROJECTS_DIR;
    process.env.CLAUDE_PROJECTS_DIR = "/no/such/projects/root/anywhere";
    try {
      expect(await findSessionForThread(7, CWD)).toBeNull();
    } finally {
      process.env.CLAUDE_PROJECTS_DIR = prev;
    }
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
    expect(p.homeResolved).toBe(true);
    // Corrected scheme (work-098): claude-cli://open?cwd=…&q=…, no code/new, no folder.
    expect(p.deepLink).toContain("claude-cli://open?cwd=");
    expect(p.deepLink).toContain(`cwd=${encodeURIComponent(CWD)}`);
    expect(p.deepLink).not.toContain("code/new");
    expect(p.deepLink).not.toContain("folder=");
    // The correlation marker survives into q so work-047 can resolve the resulting session.
    expect(p.deepLink).toContain(encodeURIComponent("[scope-creep-thread:7]"));
    expect(typeof p.schemeRegistered).toBe("boolean");
  });

  it("unresolved home → null launch affordances, no bogus cwd (work-099 honest fallback)", async () => {
    // Passing cwd:null models resolveControlPlaneHome() returning null (home not on disk).
    const p = await resolveThreadProjection(
      { id: 7, launchedAt: null, sessionUuid: null, sessionPath: null },
      "Give me a concise State of the Product.",
      null,
    );
    expect(p.status).toBe("not-launched");
    expect(p.homeResolved).toBe(false);
    expect(p.cwd).toBeNull();
    expect(p.deepLink).toBeNull();
    expect(p.cliCommand).toBeNull();
    expect(p.openRepoLink).toBeNull();
  });

  it("unresolved home still correlates a launched session (scan is home-independent)", async () => {
    // Even with no launch URL, a launched thread whose session already landed must still link:
    // the marker scan runs over every project dir, not just the (missing) home.
    const p = await resolveThreadProjection(
      { id: 7, launchedAt: Date.now(), sessionUuid: null, sessionPath: null },
      "Give me a concise State of the Product.",
      null,
    );
    expect(p.homeResolved).toBe(false);
    expect(p.deepLink).toBeNull();
    expect(p.status).toBe("matched");
    expect(p.sessionUuid).toBe(SESSION_UUID);
    expect(p.resumeCommand).toBe(`claude --resume ${SESSION_UUID}`);
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

describe("resolveControlPlaneHome (work-099 hardening)", () => {
  const prevHome = process.env.SCOPE_CREEP_HOME;
  afterAll(() => {
    if (prevHome === undefined) delete process.env.SCOPE_CREEP_HOME;
    else process.env.SCOPE_CREEP_HOME = prevHome;
  });

  it("returns an absolute, real dir when SCOPE_CREEP_HOME points at one", () => {
    // `root` is a real tmp dir created in beforeAll — a valid stand-in for the control plane.
    process.env.SCOPE_CREEP_HOME = root;
    const resolved = resolveControlPlaneHome();
    expect(resolved).toBe(root);
  });

  it("returns null when SCOPE_CREEP_HOME is a bogus/non-existent path (fail honestly)", () => {
    process.env.SCOPE_CREEP_HOME = join(root, "definitely", "not", "here");
    expect(resolveControlPlaneHome()).toBeNull();
  });

  it("returns null rather than a bogus relative path when the sibling default is missing", () => {
    // Empty env → the historical `<cwd>/../scope-creep` default; under the test runner that
    // path won't be a real dir, so we must get null, never a coincidence-dependent string.
    delete process.env.SCOPE_CREEP_HOME;
    const resolved = resolveControlPlaneHome();
    // Either the real sibling exists (absolute) or it doesn't (null) — never relative/bogus.
    if (resolved !== null) expect(resolved.startsWith("/")).toBe(true);
  });
});

describe("verifyClaudeCliScheme", () => {
  it("resolves to a boolean without throwing", async () => {
    expect(typeof (await verifyClaudeCliScheme())).toBe("boolean");
  });

  it("honors the SC_CLAUDE_CLI_SCHEME override in both directions", async () => {
    const prev = process.env.SC_CLAUDE_CLI_SCHEME;
    try {
      process.env.SC_CLAUDE_CLI_SCHEME = "1";
      __resetSchemeCache();
      expect(await verifyClaudeCliScheme()).toBe(true);
      process.env.SC_CLAUDE_CLI_SCHEME = "0";
      __resetSchemeCache();
      expect(await verifyClaudeCliScheme()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.SC_CLAUDE_CLI_SCHEME;
      else process.env.SC_CLAUDE_CLI_SCHEME = prev;
      __resetSchemeCache();
    }
  });
});
