import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

/** The control-plane repo — the `cwd` a launched Claude Code session opens in. */
export function controlPlaneHome(): string {
  return process.env.SCOPE_CREEP_HOME ?? join(process.cwd(), "..", "scope-creep");
}

/** Root of Claude Code's per-project session store (overridable for tests). */
function claudeProjectsRoot(): string {
  return process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
}

/** The project dir holding sessions for the control-plane cwd. */
function projectDir(cwd = controlPlaneHome()): string {
  return join(claudeProjectsRoot(), claudeProjectDirName(cwd));
}

// ---- URL-scheme verification (honest launcher) ------------------------------------------

let schemeCache: boolean | undefined;

/**
 * Is the `claude-cli:` URL scheme registered with the OS? (work-046 live-check.) We use a
 * **side-effect-free** LaunchServices query (`lsregister -dump | grep claude-cli:`) rather
 * than `open`, because `open` would *launch* the app on a hit. macOS only; anything else
 * (or any failure) is reported as "not registered" so the UI shows the honest fallback
 * (the copyable `claude "…"` command) instead of claiming a launch it can't guarantee.
 * Cached for the process — registration doesn't change mid-run.
 *
 * `SC_CLAUDE_CLI_SCHEME=1|0` overrides the probe. This matters for a **deployed** (Linux)
 * Console: the server runs on a different host than the Owner's Mac and can't probe it, so
 * the Owner can declare "the scheme works in my browser" (`=1`) or force the copyable
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
 * Find the local Claude Code session correlated to a thread by its marker. Scans the
 * control-plane project dir's `*.jsonl` files and returns the first whose opening Owner
 * message carries `threadMarker(threadId)`. Best-effort: a missing dir (no sessions yet,
 * or Claude Code never run here) yields null, never throws. Only the first Owner message
 * of each file is scanned (early-exit), so large transcripts aren't fully parsed.
 */
export async function findSessionForThread(
  threadId: number,
  cwd = controlPlaneHome(),
): Promise<SessionMatch | null> {
  const dir = projectDir(cwd);
  const marker = threadMarker(threadId);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  // Newest file first: a fresh launch is the likeliest match, and it bounds the scan.
  const withPaths = files.map((f) => ({ uuid: f.replace(/\.jsonl$/, ""), path: join(dir, f) }));
  for (const { uuid, path } of withPaths) {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue;
    }
    if (sessionMatchesMarker(raw, marker)) return { uuid, path };
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
  /** Launch affordances (built from local data; no Claude call). */
  cwd: string;
  deepLink: string;
  cliCommand: string;
  openRepoLink: string;
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
  cwd = controlPlaneHome(),
): Promise<ThreadProjection> {
  const schemeRegistered = await verifyClaudeCliScheme();
  const seedPrompt = buildSeedPrompt(thread.id, seedText);
  const base = {
    cwd,
    deepLink: buildDeepLink({ cwd, prompt: seedPrompt }),
    cliCommand: buildCliCommand({ cwd, prompt: seedPrompt }),
    openRepoLink: buildOpenRepoLink(cwd),
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

  // Launched but not yet linked — attempt correlation now.
  const match = await findSessionForThread(thread.id, cwd);
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
