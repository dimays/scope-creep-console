// Pure, client-safe helpers for the Threads launcher + transcript projection
// (work-046 / work-047, ADR-016). No node/fs/db imports, so these are safe to import
// from route components (the client bundle) and are trivially unit-testable. The
// fs + child_process side of the feature (scanning ~/.claude/projects, verifying the
// URL scheme) lives in claude-sessions.server.ts. Same split as threads.ts / .server.ts.
//
// The ADR-016 hard rule lives here by construction: **nothing in this module calls
// Claude.** It only builds launch URLs and *reads* a local Claude Code session JSONL
// into a projected transcript. The intelligence stays in the first-party harness.

/**
 * A single projected turn in a thread's transcript, derived from one content block of a
 * local Claude Code session JSONL. We never invent turns — every turn maps to a real
 * record. `tool` turns summarize tool activity at a high level (the tool's name), never
 * its arguments or output.
 */
export type ProjectedTurn = {
  role: "owner" | "agent" | "tool";
  /** Owner/agent prose, or a one-line summary for a tool turn. */
  text: string;
  /** For a `tool` turn: the tool's name (e.g. "Read", "Bash"). */
  tool?: string;
  /** Wall-clock time of the source record, ms since epoch (best-effort). */
  at?: number;
};

/** The correlation marker prefix embedded in a launched session's seed prompt. */
export const THREAD_MARKER_PREFIX = "scope-creep-thread:";

/**
 * The unique marker for a thread. We can't pre-assign a session UUID from a launch URL,
 * so we embed this compact marker into the seeded prompt (`q`); the correlator then finds
 * the local session JSONL whose first Owner message contains it. Deterministic from the
 * thread id — nothing extra to store to *compute* it (only the resolved path is persisted,
 * so we don't rescan).
 */
export function threadMarker(threadId: number): string {
  return `[${THREAD_MARKER_PREFIX}${threadId}]`;
}

/**
 * The full prompt that seeds the launched Claude Code session: the Owner's text followed
 * by the correlation marker on its own trailing line. The in-app timeline stores the clean
 * text; only the launched session carries the marker (for correlation).
 */
export function buildSeedPrompt(threadId: number, body: string): string {
  return `${body.trim()}\n\n${threadMarker(threadId)}`;
}

/**
 * Map a working directory to the folder name Claude Code uses under `~/.claude/projects/`.
 * Observed rule (verified against the live control-plane dir): path separators (`/`) and
 * dots (`.`) become `-`, so `/Users/x/code/scope-creep` → `-Users-x-code-scope-creep`.
 */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/**
 * The documented deep link that opens a NEW Claude Code session in `cwd` with `prompt`
 * prefilled (ADR-016 / work-046). NOTE: the `claude-cli:` scheme is only OS-registered
 * after Claude Code's first interactive run on the machine — the server verifies it
 * (see claude-sessions.server `verifyClaudeCliScheme`) and the UI degrades honestly when
 * it isn't registered.
 */
export function buildDeepLink(opts: { cwd: string; prompt: string }): string {
  const q = encodeURIComponent(opts.prompt);
  const cwd = encodeURIComponent(opts.cwd);
  return `claude-cli://open?cwd=${cwd}&q=${q}`;
}

/** A generic deep link that opens Claude Code in the repo with no seeded prompt (the resume/open floor). */
export function buildOpenRepoLink(cwd: string): string {
  return `claude-cli://open?cwd=${encodeURIComponent(cwd)}`;
}

/**
 * The exact shell command to start the same seeded session by hand — the graceful fallback
 * when `claude-cli:` isn't registered (work-046). Double quotes in the prompt are escaped so
 * the command is safe to paste.
 */
export function buildCliCommand(opts: { cwd: string; prompt: string }): string {
  const escaped = opts.prompt.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `cd ${opts.cwd} && claude "${escaped}"`;
}

/** The command to resume a specific Claude Code session by its UUID (work-046). */
export function buildResumeCommand(sessionUuid: string): string {
  return `claude --resume ${sessionUuid}`;
}

// ---- JSONL projection (work-047) --------------------------------------------------------

/** One parsed JSONL record (only the fields we project; everything else is ignored). */
type SessionRecord = {
  type?: string;
  isSidechain?: boolean;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
};

function parseTs(ts: unknown): number | undefined {
  if (typeof ts !== "string") return undefined;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Strip the correlation marker (and any resulting blank tail) from displayed Owner text. */
export function stripMarker(text: string): string {
  const re = new RegExp(`\\[${THREAD_MARKER_PREFIX}\\d+\\]`, "g");
  return text.replace(re, "").trim();
}

/**
 * Extract the first Owner (`user`) text from a session JSONL — the seed prompt of a
 * Claude Code session. Used for correlation (does it contain a thread's marker?). Skips
 * `tool_result`-only user records (mechanical tool feedback, not an Owner turn) and
 * sidechain (sub-agent) records. Returns null if no Owner text is present yet.
 *
 * Early-exits at the first Owner text so a multi-MB transcript isn't fully parsed just to
 * correlate.
 */
export function firstOwnerText(jsonl: string): string | null {
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: SessionRecord;
    try {
      rec = JSON.parse(trimmed) as SessionRecord;
    } catch {
      continue;
    }
    if (rec.isSidechain) continue;
    if (rec.type !== "user") continue;
    const content = rec.message?.content;
    if (typeof content === "string") {
      if (content.trim()) return content;
      continue;
    }
    if (Array.isArray(content)) {
      const text = (content as ContentBlock[])
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return null;
}

/** Does this session JSONL's first Owner message carry the given thread marker? */
export function sessionMatchesMarker(jsonl: string, marker: string): boolean {
  return firstOwnerText(jsonl)?.includes(marker) ?? false;
}

/**
 * Project a local Claude Code session JSONL into an ordered transcript (work-047). The
 * ADR-016 hard rule made concrete: this **reads local data only** and makes zero Claude
 * calls, and it **never invents a turn** — every projected turn maps to a real content
 * block:
 *  - `user` string / `text` block  → an `owner` turn (marker stripped for display);
 *  - `assistant` `text` block       → an `agent` turn;
 *  - `assistant` `tool_use` block   → a high-level `tool` turn (the tool's name only);
 *  - `thinking`, `tool_result`, sidechain (sub-agent) records, and non-message record
 *    types (queue-operation, attachment, system, …) are skipped.
 *
 * "Empty is empty": an empty or entirely-metadata JSONL yields `[]`.
 */
export function parseTranscript(jsonl: string): ProjectedTurn[] {
  const turns: ProjectedTurn[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: SessionRecord;
    try {
      rec = JSON.parse(trimmed) as SessionRecord;
    } catch {
      continue;
    }
    if (rec.isSidechain) continue;
    const at = parseTs(rec.timestamp);

    if (rec.type === "user") {
      const content = rec.message?.content;
      if (typeof content === "string") {
        const text = stripMarker(content);
        if (text) turns.push({ role: "owner", text, at });
      } else if (Array.isArray(content)) {
        for (const block of content as ContentBlock[]) {
          if (block?.type === "text" && typeof block.text === "string") {
            const text = stripMarker(block.text);
            if (text) turns.push({ role: "owner", text, at });
          }
          // tool_result blocks are mechanical tool feedback — not an Owner turn.
        }
      }
      continue;
    }

    if (rec.type === "assistant") {
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as ContentBlock[]) {
        if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
          turns.push({ role: "agent", text: block.text.trim(), at });
        } else if (block?.type === "tool_use" && typeof block.name === "string") {
          turns.push({ role: "tool", tool: block.name, text: `used ${block.name}`, at });
        }
        // thinking blocks are the model's private reasoning — not projected.
      }
    }
  }
  return turns;
}

/** The status of a thread's correlation to a local Claude Code session. */
export type ProjectionStatus = "not-launched" | "pending" | "matched";
