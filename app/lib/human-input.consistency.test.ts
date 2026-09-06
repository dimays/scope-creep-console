import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commitsWithTimestamps, inputConsistency } from "./human-input.server";

// Grounds the consistency self-check (work-022) in a REAL git repo read through
// SCOPE_CREEP_HOME — proving the timestamped commit reader (including merges) and the
// end-to-end wrapper flag on the actual record, never a synthesized one.

const exec = promisify(execFile);
const prevHome = process.env.SCOPE_CREEP_HOME;
let home: string;

const DAY = 86_400_000;
// Dated relative to now so the wrapper's 30-day no-input lookback always covers them.
const t1 = Date.now() - 5 * DAY;
const t2 = Date.now() - 4 * DAY;
const t3 = Date.now() - 3 * DAY;

async function git(args: string[], atMs?: number): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (atMs !== undefined) {
    const iso = new Date(atMs).toISOString();
    env.GIT_AUTHOR_DATE = iso;
    env.GIT_COMMITTER_DATE = iso;
  }
  await exec("git", ["-C", home, ...args], { env });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "sc-git-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "commit.gpgsign", "false"]);

  // A non-merge commit, then a feature branch merged back with --no-ff (a real merge
  // commit with two parents) — so the reader has both kinds to classify.
  await git(["commit", "--allow-empty", "-q", "-m", "feat: first work"], t1);
  await git(["checkout", "-q", "-b", "feature"]);
  await git(["commit", "--allow-empty", "-q", "-m", "feat: feature work"], t2);
  await git(["checkout", "-q", "-"]);
  await git(["merge", "--no-ff", "-q", "-m", "merge: land feature", "feature"], t3);

  process.env.SCOPE_CREEP_HOME = home;
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.SCOPE_CREEP_HOME;
  else process.env.SCOPE_CREEP_HOME = prevHome;
});

describe("commitsWithTimestamps", () => {
  it("reads real commit timestamps and classifies merges", async () => {
    const commits = await commitsWithTimestamps();
    const bySubject = new Map(commits.map((c) => [c.subject, c]));

    expect(commits).toHaveLength(3);
    expect(bySubject.get("feat: first work")?.merge).toBe(false);
    expect(bySubject.get("feat: feature work")?.merge).toBe(false);
    expect(bySubject.get("merge: land feature")?.merge).toBe(true);

    // Timestamps are the real committer dates (git stores whole seconds).
    expect(bySubject.get("feat: first work")?.ts).toBe(Math.floor(t1 / 1000) * 1000);
    expect(bySubject.get("merge: land feature")?.ts).toBe(Math.floor(t3 / 1000) * 1000);
  });

  it("honors the since bound", async () => {
    // Only commits at/after the feature commit (t2) — drops the first commit.
    const commits = await commitsWithTimestamps(t2);
    const subjects = commits.map((c) => c.subject);
    expect(subjects).toContain("merge: land feature");
    expect(subjects).not.toContain("feat: first work");
  });
});

describe("inputConsistency (grounded)", () => {
  it("flags a gap when real control-plane work exists but no input was captured", async () => {
    // Fresh in-memory DB + a home with no human-input/ ndjson ⇒ zero captured inputs,
    // while the real repo shipped three commits within the lookback window.
    const checks = await inputConsistency();
    expect(checks.hasData).toBe(true);
    expect(checks.gaps).toHaveLength(1);
    expect(checks.gaps[0].count).toBe(3);
    expect(checks.dups).toHaveLength(0);
    expect(checks.ok).toBe(false);
  });
});
