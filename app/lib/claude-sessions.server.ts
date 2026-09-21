import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildCliCommand,
  buildDeepLink,
  buildOpenRepoLink,
  buildResumeCommand,
  buildSeedPrompt,
  claudeProjectDirName,
  type ProjectedTurn,
  type ProjectionStatus,
  parseTranscript,
  sessionMatchesMarker,
  threadMarker,
} from "./claude-sessions";

const exec = promisify(execFile);

export type {
  ProjectedTurn,
  ProjectionStatus,
} from "./claude-sessions";

/**
 * The launcher + transcript-projection data layer (work-046 / work-047, ADR-016). It
 * reads **local** Claude Code session data (`~/.claude/projects/<mangled-cwd>/*.jsonl`)
 * and builds launch URLs — it makes **zero** Claude calls (the ADR-016 hard rule).
 *
 * Correlation: a launch URL can't pre-assign the session UUID, so `launchThread` seeds the
 * prompt with a per-thread marker (see ./claude-sessions `threadMarker`). Here we find the
 * session JSONL whose first Owner message contains that marker, and the caller persists the
 * resolved path on the thread so we never rescan.
 */

/**
 * Resolve the control-plane repo — the `cwd` a launched Claude Code session opens in — to an
 * **absolute, real directory**, or `null` when it can't be resolved (work-099). This is the
 * only value allowed to feed a launch URL: a deep link must never carry a bogus, relative, or
 * empty `cwd`, so an unresolved home degrades the UI to the honest needs-you/config state.
 *
 * Resolution: prefer `SCOPE_CREEP_HOME`; else the historical sibling default
 * (`<cwd>/../scope-creep`). Either way we `resolve()` to an absolute path (collapsing any `..`,
 * which the deep-link handler also rejects) and confirm it is a real directory on disk. The
 * old `SCOPE_CREEP_HOME ?? join(cwd,"..","scope-creep")` was unsound: in dev `.env` isn't
 * loaded so the env var is inert and the path was correct only by the coincidence that the
 * console sits beside the control plane, and on a deployed Linux console (cwd `/app`) the
 * fallback yields a bogus `/scope-creep`. We fail honestly instead of emitting that.
 */
export function resolveControlPlaneHome(): string | null {
  const raw = process.env.SCOPE_CREEP_HOME?.trim();
  const candidate = raw && raw.length > 0 ? raw : join(process.cwd(), "..", "scope-creep");
  const abs = resolve(candidate);
  if (!isAbsolute(abs)) return null;
  try {
    if (statSync(abs).isDirectory()) return abs;
  } catch {
    // Not on disk (deployed console without the control plane mounted, or a wrong path).
  }
  return null;
}

/**
 * A string accessor kept for the correlation scan, which uses `cwd` only as the *preferred*
 * project dir to check first and tolerates a wrong value (it scans every project dir anyway).
 * Falls back to the raw sibling path when the home can't be resolved to a real dir. **Never
 * used to build a launch URL** — those go through `resolveControlPlaneHome()` (null → honest
 * fallback), so a bogus path here can only misorder a scan, never mislead the Owner.
 */
export function controlPlaneHome(): string {
  return (
    resolveControlPlaneHome() ??
    (process.env.SCOPE_CREEP_HOME?.trim() || join(process.cwd(), "..", "scope-creep"))
  );
}

/** Root of Claude Code's per-project session store (overridable for tests). */
function claudeProjectsRoot(): string {
  return process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
}

// ---- URL-scheme verification (honest launcher) ------------------------------------------

let schemeCache: boolean | undefined;

/**
 * Is Claude Code's official `claude-cli://` URL handler registered with the OS? (work-098
 * live-check, corrected.) This is the scheme the launch link actually uses — Claude Code
 * installs a `~/Applications/Claude Code URL Handler.app` claiming `claude-cli:` the first time
 * you send a prompt in an interactive session (per the deep-links doc). We use a
 * **side-effect-free** LaunchServices query (`lsregister -dump`, matched for a registered
 * `claude-cli:` scheme) rather than `open`, because `open` would *launch* the app on a hit —
 * and, worse, `open`'s exit 0 is not proof of anything: the bare `claude:` scheme is claimed by
 * the Claude apps regardless, so probing `claude:` (as this did before work-098) returned true
 * even though a `claude://code/new?…&folder=` click dropped the Owner in "No folder." We probe
 * the exact scheme the link uses. macOS only; anything else (or any failure) is reported as
 * "not registered" so the UI shows the honest fallback (the copyable command) instead of
 * claiming a launch it can't guarantee. Cached for the process — registration doesn't change
 * mid-run.
 *
 * `SC_CLAUDE_CLI_SCHEME=1|0` overrides the probe. This matters for a **deployed** (Linux)
 * Console: the server runs on a different host than the Owner's Mac and can't probe it, so the
 * Owner can declare "the handler is registered on my machine" (`=1`) or force the copyable
 * fallback (`=0`). It also keeps tests deterministic and fast.
 */
export async function verifyClaudeCliScheme(): Promise<boolean> {
  if (schemeCache !== undefined) return schemeCache;
  const override = process.env.SC_CLAUDE_CLI_SCHEME;
  if (override === "1" || override === "0") {
    schemeCache = override === "1";
    return schemeCache;
  }
  if (process.platform !== "darwin") {
    schemeCache = false;
    return schemeCache;
  }
  const lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister";
  try {
    const { stdout } = await exec(lsregister, ["-dump"], { maxBuffer: 64 * 1024 * 1024 });
    // The official launcher scheme, exactly as lsregister prints it in a `claimed schemes:`
    // or `bindings:` line (e.g. `claude-cli:` or `claude-cli:,`). Distinct from the bare
    // `claude:` scheme, which is always claimed and is NOT the deep-link handler.
    schemeCache = /claude-cli:/.test(stdout);
  } catch {
    schemeCache = false;
  }
  return schemeCache;
}

/** Reset the scheme cache — for tests only. */
export function __resetSchemeCache(): void {
  schemeCache = undefined;
}

// ---- Correlation ------------------------------------------------------------------------

export type SessionMatch = { uuid: string; path: string };

/**
 * Find the local Claude Code session correlated to a thread by its marker. The marker is
 * globally unique per thread, so we scan **every** `~/.claude/projects/<dir>/*.jsonl` — not
 * just the control-plane project dir — because a launched session can land in a *different*
 * repo's project dir when the deep-link `folder` param doesn't take (Claude Desktop opens
 * Code in its already-active folder). `cwd` only sets the *preferred* dir to check first (the
 * common case + a bounded fast path); the search is not restricted to it. Best-effort: a
 * missing root/dir/file is skipped, never throws.
 */
export async function findSessionForThread(
  threadId: number,
  cwd = controlPlaneHome(),
): Promise<SessionMatch | null> {
  const root = claudeProjectsRoot();
  const marker = threadMarker(threadId);
  const preferred = claudeProjectDirName(cwd);
  let dirNames: string[];
  try {
    dirNames = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }
  // Preferred (control-plane) dir first, then the rest — a cross-repo match is valid.
  dirNames.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  for (const name of dirNames) {
    const dir = join(root, name);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const path = join(dir, f);
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        continue;
      }
      if (sessionMatchesMarker(raw, marker)) return { uuid: f.replace(/\.jsonl$/, ""), path };
    }
  }
  return null;
}

/** Read + project a session JSONL by path. Best-effort: an unreadable file projects to []. */
export async function projectSessionFile(path: string): Promise<ProjectedTurn[]> {
  try {
    return parseTranscript(await readFile(path, "utf8"));
  } catch {
    return [];
  }
}

// ---- Orchestration ----------------------------------------------------------------------

/** Everything the thread page needs to render the launcher + projected transcript. */
export type ThreadProjection = {
  status: ProjectionStatus;
  turns: ProjectedTurn[];
  /** Set once correlated. */
  sessionUuid?: string;
  sessionPath?: string;
  /** True when we just resolved the correlation this call — the caller persists it. */
  newlyResolved: boolean;
  /**
   * Launch affordances (built from local data; no Claude call). All are `null` when the
   * control-plane home can't be resolved to a real absolute dir (`homeResolved: false`) — we
   * never emit a bogus/relative/empty `cwd`; the UI shows the needs-you/config state instead.
   */
  cwd: string | null;
  /** False → the control-plane path is unknown; render the "set SCOPE_CREEP_HOME" state. */
  homeResolved: boolean;
  deepLink: string | null;
  cliCommand: string | null;
  openRepoLink: string | null;
  resumeCommand: string | null;
  schemeRegistered: boolean;
};

type ThreadLike = {
  id: number;
  launchedAt: number | null;
  sessionUuid: string | null;
  sessionPath: string | null;
};

/**
 * Resolve a thread's transcript + launch affordances (work-046 + work-047). Pass the
 * thread's already-loaded row and the Owner's seed text (the first Owner message).
 *
 *  - Not launched → `status: "not-launched"`, no turns; the page shows the launch composer.
 *  - Launched, already linked → project the stored session path.
 *  - Launched, not yet linked → try to correlate by marker; if found, project it and flag
 *    `newlyResolved` so the caller persists the path; else `status: "pending"` (empty is
 *    empty — the session may not exist yet, and we never fabricate a transcript).
 */
export async function resolveThreadProjection(
  thread: ThreadLike,
  seedText: string,
  cwd: string | null = resolveControlPlaneHome(),
): Promise<ThreadProjection> {
  const schemeRegistered = await verifyClaudeCliScheme();
  const seedPrompt = buildSeedPrompt(thread.id, seedText);
  // Only a resolved, real, absolute home may feed a launch URL — otherwise every launch
  // affordance is null and the UI degrades to the honest "set SCOPE_CREEP_HOME" state rather
  // than emitting a bogus `cwd` into a link the Owner would click (work-099).
  const homeResolved = cwd !== null;
  const base = {
    cwd,
    homeResolved,
    deepLink: cwd !== null ? buildDeepLink({ cwd, prompt: seedPrompt }) : null,
    cliCommand: cwd !== null ? buildCliCommand({ cwd, prompt: seedPrompt }) : null,
    openRepoLink: cwd !== null ? buildOpenRepoLink(cwd) : null,
    schemeRegistered,
    newlyResolved: false,
  };

  if (!thread.launchedAt) {
    return { ...base, status: "not-launched", turns: [], resumeCommand: null };
  }

  // Already correlated: project the stored session.
  if (thread.sessionPath && thread.sessionUuid) {
    return {
      ...base,
      status: "matched",
      turns: await projectSessionFile(thread.sessionPath),
      sessionUuid: thread.sessionUuid,
      sessionPath: thread.sessionPath,
      resumeCommand: buildResumeCommand(thread.sessionUuid),
    };
  }

  // Launched but not yet linked — attempt correlation now. The scan uses cwd only as the
  // preferred dir and tolerates a null home (it falls back to controlPlaneHome() and scans
  // every project dir), so correlation still works even when no launch URL can be built.
  const match = await findSessionForThread(thread.id, cwd ?? undefined);
  if (!match) {
    return { ...base, status: "pending", turns: [], resumeCommand: null };
  }
  return {
    ...base,
    status: "matched",
    turns: await projectSessionFile(match.path),
    sessionUuid: match.uuid,
    sessionPath: match.path,
    resumeCommand: buildResumeCommand(match.uuid),
    newlyResolved: true,
  };
}
