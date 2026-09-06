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
 * The Claude Desktop deep-link scheme that hosts Claude Code (`claude://…`). This is the
 * scheme the Owner's machine actually registers — Claude Code runs embedded in Claude
 * Desktop, so there is no standalone `claude` binary registering a `claude-cli:` scheme.
 * Verified: `open -g "claude://code/new?q=…"` returns exit 0. The `folder` argument is
 * treated as untrusted by the app, so opening one shows a confirmation dialog (expected).
 */
export const CLAUDE_DESKTOP_SCHEME = "claude:";

/**
 * The deep link that opens a NEW Claude Code session (via Claude Desktop) in `cwd` with
 * `prompt` prefilled (ADR-016 / work-046). Per Anthropic's deep-link docs, `claude://code/new`
 * accepts `q` (the prompt prefill — placed in the composer, *sent when the human presses
 * Enter*, not auto-sent) and `folder` (the working directory; treated as untrusted → the app
 * confirms it). Both values are percent-encoded so the resulting URL is unambiguous, and the
 * `[scope-creep-thread:<id>]` marker inside `prompt` survives into `q` for correlation
 * (work-047). NOTE: the `claude:` scheme must be OS-registered (Claude Desktop installed); the
 * server verifies it (see claude-sessions.server `verifyClaudeCliScheme`) and the UI degrades
 * honestly to the copyable command when it isn't.
 */
export function buildDeepLink(opts: { cwd: string; prompt: string }): string {
  const q = encodeURIComponent(opts.prompt);
  const folder = encodeURIComponent(opts.cwd);
  return `claude://code/new?q=${q}&folder=${folder}`;
}

/**
 * A generic deep link that opens a NEW Claude Code session in the repo with no seeded prompt
 * (the resume/open floor). Same `claude://code/new` scheme, `folder` only.
 */
export function buildOpenRepoLink(cwd: string): string {
  return `claude://code/new?folder=${encodeURIComponent(cwd)}`;
}

/**
 * The exact shell command to start the same seeded session by hand — the graceful fallback
 * for environments where the `claude:` scheme isn't registered (e.g. a deployed Linux Console
 * with the CLI available; work-046). Double quotes in the prompt are escaped so the command is
 * safe to paste.
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
  /** Claude Code marks its own injected (non-Owner) `user` records with this. */
  isMeta?: boolean;
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
 * Content Claude Code injects into the transcript as `user`-type records even though the
 * Owner never typed it: leading XML-ish tags Claude Code wraps around system/slash-command
 * payloads. Matched by *leading* prefix so a genuine Owner message that merely mentions one
 * of these mid-body is never nuked.
 */
const INJECTED_TAG_PREFIXES = [
  "<system-reminder>",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-stderr>",
] as const;

/** Interrupt notices Claude Code writes as `user` records — not the Owner's words. */
const INTERRUPT_NOTICES = new Set([
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
]);

/**
 * Is this text (a whole string content, or one text block) a system-injected, non-Owner
 * payload? True when it *is* an interrupt notice, or *leads* with a system/slash-command
 * wrapper. Keyed on leading/whole so a real Owner message that only *contains* such text
 * mid-body survives.
 */
function isInjectedText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (INTERRUPT_NOTICES.has(t)) return true;
  return INJECTED_TAG_PREFIXES.some((p) => t.startsWith(p));
}

/**
 * Extract genuine Owner text from a `user` record, or null if the record carries no Owner
 * turn. Claude Code injects non-Owner content as `user` records (system-reminders like the
 * working-directory notice, slash-command wrappers, interrupt notices, and `isMeta` records);
 * those must not render as the Owner ("YOU"). We drop a whole record that is `isMeta` or whose
 * (leading) content is injected, and inside a multi-block record we drop the injected blocks
 * while keeping genuine Owner text. The returned text is raw (marker NOT stripped) so
 * correlation still sees it; display callers strip the marker themselves.
 */
function ownerTextFromUserRecord(rec: SessionRecord): string | null {
  if (rec.isMeta) return null;
  const content = rec.message?.content;
  if (typeof content === "string") {
    if (isInjectedText(content)) return null;
    return content.trim() ? content : null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block?.type !== "text" || typeof block.text !== "string") continue;
      // tool_result blocks (non-text) are mechanical tool feedback — not an Owner turn.
      if (isInjectedText(block.text)) continue; // drop an injected block, keep the rest
      if (block.text.trim()) parts.push(block.text);
    }
    const joined = parts.join("\n");
    return joined.trim() ? joined : null;
  }
  return null;
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
    // Skip system-injected `user` records (system-reminders, slash-command wrappers,
    // interrupt notices, isMeta) so a leading injected record can't fool correlation.
    const owner = ownerTextFromUserRecord(rec);
    if (owner) return owner;
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
      // Only genuine Owner text becomes an `owner` turn. System-injected `user` records
      // (system-reminders like the working-directory notice, slash-command wrappers,
      // interrupt notices, isMeta) are filtered out so they never render as the Owner.
      const owner = ownerTextFromUserRecord(rec);
      if (owner) {
        const text = stripMarker(owner);
        if (text) turns.push({ role: "owner", text, at });
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
