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
