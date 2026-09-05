import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

/**
 * The ADR-009 preview sandbox: apply a proposed edit in an ISOLATED git worktree,
 * never the running checkout, and produce the diff. The live app is provably
 * untouched. Merge is a separate, gated step (work-016); this only previews.
 *
 * v1 = isolation + diff. Interactive live-serve preview + agent-generated proposals
 * are work-017.
 */

export type Edit = { path: string; content: string };
export type Proposal = { edits: Edit[] };
export type PreviewResult = { diff: string; liveClean: boolean };

const exec = promisify(execFile);

/**
 * Path safety (the CRO gate): reject anything that could escape the repo. Pure +
 * unit-tested. Applied before any filesystem/git action.
 */
export function validateProposal(edits: Edit[]): { ok: boolean; error?: string } {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: "no edits" };
  }
  for (const edit of edits) {
    const p = edit?.path;
    if (typeof p !== "string" || p.length === 0) return { ok: false, error: "empty path" };
    if (p.startsWith("/") || /^[A-Za-z]:/.test(p))
      return { ok: false, error: `absolute path: ${p}` };
    if (p.split(/[\\/]/).includes("..")) return { ok: false, error: `path escapes repo: ${p}` };
    if (p.includes("\0")) return { ok: false, error: "null byte in path" };
    if (typeof edit.content !== "string") return { ok: false, error: `no content for ${p}` };
  }
  return { ok: true };
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/**
 * Apply the proposal in a throwaway worktree of `repoDir` at HEAD, return the diff,
 * and confirm `repoDir`'s own working tree was not modified. Cleans up the worktree.
 */
export async function previewProposal(repoDir: string, proposal: Proposal): Promise<PreviewResult> {
  const check = validateProposal(proposal.edits);
  if (!check.ok) throw new Error(`unsafe proposal: ${check.error}`);

  const before = await git(["status", "--porcelain"], repoDir);
  const wt = await mkdtemp(join(tmpdir(), "sc-preview-"));
  try {
    await git(["worktree", "add", "--detach", wt, "HEAD"], repoDir);
    for (const edit of proposal.edits) {
      const full = join(wt, edit.path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, edit.content);
    }
    await git(["add", "-A"], wt);
    const diff = await git(["diff", "--cached"], wt);
    const after = await git(["status", "--porcelain"], repoDir);
    return { diff, liveClean: after === before };
  } finally {
    await git(["worktree", "remove", "--force", wt], repoDir).catch(() => undefined);
    await rm(wt, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A unique branch name for a chat proposal. */
export function proposalBranch(now: number = Date.now()): string {
  return `chat/proposal-${now}`;
}

export type LandResult = { branch: string; prUrl: string };

/**
 * Approve a proposal: build the edits on an ISOLATED branch (worktree, never the
 * running checkout), push it, and open a GATED PR. Does NOT merge — the merge stays
 * the Owner's gated action (ADR-009: never auto-merge, never merge red).
 */
export async function landProposal(
  repoDir: string,
  proposal: Proposal,
  opts: { title: string; body?: string; branch?: string },
): Promise<LandResult> {
  const check = validateProposal(proposal.edits);
  if (!check.ok) throw new Error(`unsafe proposal: ${check.error}`);

  const branch = opts.branch ?? proposalBranch();
  const body = opts.body ?? "Proposed via the Console chat.";
  const wt = await mkdtemp(join(tmpdir(), "sc-land-"));
  try {
    await git(["worktree", "add", "-b", branch, wt, "HEAD"], repoDir);
    for (const edit of proposal.edits) {
      const full = join(wt, edit.path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, edit.content);
    }
    await git(["add", "-A"], wt);
    const message = `${opts.title}\n\n${body}\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`;
    await git(["commit", "-m", message], wt);
    await git(["push", "-u", "origin", branch], wt);
    const { stdout } = await exec(
      "gh",
      ["pr", "create", "--head", branch, "--title", opts.title, "--body", body],
      { cwd: repoDir, maxBuffer: 4 * 1024 * 1024 },
    );
    return { branch, prUrl: stdout.trim() };
  } finally {
    await git(["worktree", "remove", "--force", wt], repoDir).catch(() => undefined);
    await rm(wt, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Decline: close the proposal's PR and delete its branch. */
export async function declineProposal(repoDir: string, branch: string): Promise<void> {
  await exec("gh", ["pr", "close", branch, "--delete-branch"], { cwd: repoDir });
}
