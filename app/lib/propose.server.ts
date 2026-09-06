/**
 * Agent-generated proposals (work-017, part 1 — the flagship's highest-value slice).
 *
 * Gives the in-app agent runtime (work-014) a small, bounded code tool loop so a
 * natural-language request from the Owner turns into a concrete set of `{path, content}`
 * edits. Those edits are NEVER applied here: they flow to the ADR-009 sandbox
 * (`previewProposal`) for an isolated diff and, only on the Owner's approval, to the
 * gated PR flow (`landProposal`, work-016). This module just *proposes*.
 *
 * Two tools are exposed to the model:
 *  - `read_file` — read a repo-relative file so the edit can be accurate (path-safety
 *    gated by the same `isSafeRelPath` the applier uses).
 *  - `propose_edits` — emit the final proposal; each edit's `content` is the COMPLETE
 *    new file contents (the sandbox writes files whole).
 *
 * The loop is hard-bounded by `maxSteps` (INVARIANTS §12: loops must terminate). The
 * model transport is injectable so the whole loop is unit-testable with no API key.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type AgentMessage, toAnthropicMessages } from "./agent.server";
import { type Edit, isSafeRelPath } from "./sandbox.server";

export type ProposedEdit = Edit;
export type AgentProposal = { title: string; summary: string; edits: ProposedEdit[] };

type TextBlock = { type: "text"; text?: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type ContentBlock = TextBlock | ToolUseBlock | { type: string; [k: string]: unknown };
export type ModelResponse = { stop_reason?: string; content?: ContentBlock[] };
/** Injectable model call — the real one POSTs to Anthropic; tests pass a fake. */
export type ProposeTransport = (body: Record<string, unknown>) => Promise<ModelResponse>;

export type ProposeReason = "proposed" | "no_proposal" | "max_steps" | "no_key" | "error";
export type ProposeResult = {
  proposal: AgentProposal | null;
  text: string;
  steps: number;
  reason: ProposeReason;
};

const MAX_CONTENT = 200_000; // per-file content ceiling (chars)
const MAX_READ = 60_000; // read_file result ceiling (chars)
const MAX_EDITS = 20;

const SYSTEM_PROMPT = [
  "You are the Scope Creep Console's in-app code assistant.",
  "The Owner describes a change to THIS app's repository; you propose the file edits to make it.",
  "Use `read_file` to inspect the current contents of any file you intend to change before proposing.",
  "When you are ready, call `propose_edits` exactly once. Each edit's `content` is the COMPLETE new",
  "contents of that file — it replaces the file wholesale, so include everything, not just the changed lines.",
  "Keep the change minimal and correct. You only PROPOSE: the Owner reviews the diff and approves the",
  "merge through the gated PR flow. Never claim you have applied or merged anything.",
].join(" ");

export const READ_FILE_TOOL = {
  name: "read_file",
  description:
    "Read the current full contents of a repo-relative file so you can propose an accurate edit. Returns the file text, or an error string if it does not exist or the path is unsafe.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repo-relative path, e.g. app/routes/home.tsx" },
    },
    required: ["path"],
  },
} as const;

export const PROPOSE_EDITS_TOOL = {
  name: "propose_edits",
  description:
    "Propose one or more file edits for the Owner to review. Each edit's `content` is the COMPLETE new contents of the file at `path` (it REPLACES the file). Do NOT apply anything — this only proposes; the Owner previews the diff and approves through the gated PR flow.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A short, PR-style title for the change." },
      summary: {
        type: "string",
        description: "1-3 sentences: what the change does and why.",
      },
      edits: {
        type: "array",
        description: "The files to create or replace.",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "Repo-relative path." },
            content: { type: "string", description: "The full new file contents." },
          },
          required: ["path", "content"],
        },
      },
    },
    required: ["title", "summary", "edits"],
  },
} as const;

/**
 * Extract a well-formed proposal from a `propose_edits` tool call, or null. Pure —
 * validates shape only; path safety is enforced separately by `validateProposal`
 * before anything touches the filesystem.
 */
export function parseProposal(blocks: ContentBlock[] | undefined): AgentProposal | null {
  if (!Array.isArray(blocks)) return null;
  const call = blocks.find(
    (b): b is ToolUseBlock =>
      b?.type === "tool_use" && (b as ToolUseBlock).name === "propose_edits",
  );
  if (!call) return null;
  const input = call.input as { title?: unknown; summary?: unknown; edits?: unknown } | undefined;
  if (!input || !Array.isArray(input.edits) || input.edits.length === 0) return null;

  const edits: ProposedEdit[] = [];
  for (const raw of input.edits.slice(0, MAX_EDITS)) {
    const e = raw as { path?: unknown; content?: unknown };
    if (typeof e?.path !== "string" || e.path.length === 0) return null;
    if (typeof e?.content !== "string") return null;
    if (e.content.length > MAX_CONTENT) return null;
    edits.push({ path: e.path, content: e.content });
  }
  return {
    title:
      typeof input.title === "string" && input.title.trim()
        ? input.title.trim()
        : "Proposed change",
    summary: typeof input.summary === "string" ? input.summary.trim() : "",
    edits,
  };
}

/** Collect the text blocks of a model response into one string. */
function textOf(blocks: ContentBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b): b is TextBlock => b?.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

/** Execute one `read_file` tool call against the repo, returning the tool_result text. */
async function runReadFile(repoDir: string, input: unknown): Promise<string> {
  const path = (input as { path?: unknown })?.path;
  if (!isSafeRelPath(path)) return `error: unsafe or missing path`;
  try {
    const text = await readFile(join(repoDir, path as string), "utf8");
    return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n… (truncated)` : text;
  } catch {
    return `error: file not found: ${path}`;
  }
}

/**
 * The bounded read → propose tool loop. Injectable transport; every path terminates
 * (returns on a proposal, on no tool use, or when `maxSteps` is hit). Never applies
 * edits — it only produces a proposal object for the gated preview/land flow.
 */
export async function runProposalLoop(opts: {
  repoDir: string;
  history: AgentMessage[];
  userText: string;
  model: string;
  transport: ProposeTransport;
  maxSteps?: number;
}): Promise<ProposeResult> {
  const maxSteps = opts.maxSteps ?? 6;
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...toAnthropicMessages(opts.history, opts.userText),
  ];
  let lastText = "";
  let steps = 0;

  for (let i = 0; i < maxSteps; i++) {
    steps = i + 1;
    let res: ModelResponse;
    try {
      res = await opts.transport({
        model: opts.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [READ_FILE_TOOL, PROPOSE_EDITS_TOOL],
        messages,
      });
    } catch {
      return { proposal: null, text: lastText, steps, reason: "error" };
    }

    const text = textOf(res.content);
    if (text) lastText = text;

    const proposal = parseProposal(res.content);
    if (proposal) return { proposal, text: lastText, steps, reason: "proposed" };

    const reads = (res.content ?? []).filter(
      (b): b is ToolUseBlock => b?.type === "tool_use" && (b as ToolUseBlock).name === "read_file",
    );
    if (reads.length === 0) {
      // No tool use and no proposal — the model answered in prose (e.g. asked a question).
      return { proposal: null, text: lastText, steps, reason: "no_proposal" };
    }

    // Feed the assistant's tool calls back, then the tool results, and continue.
    messages.push({ role: "assistant", content: res.content });
    const toolResults = [];
    for (const call of reads) {
      const out = await runReadFile(opts.repoDir, call.input);
      toolResults.push({ type: "tool_result", tool_use_id: call.id, content: out });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { proposal: null, text: lastText, steps, reason: "max_steps" };
}

function anthropicHeaders(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  };
}

/** The real Anthropic transport (used when a key is present). */
function httpTransport(key: string): ProposeTransport {
  return async (body) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(key),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    return (await res.json()) as ModelResponse;
  };
}

const NO_KEY_TEXT =
  "The proposal runtime is live (work-017), but no ANTHROPIC_API_KEY is configured, so I can't " +
  "reach Claude to draft edits. Set the key to enable agent-generated proposals.";

/**
 * Public entry point: turn a natural-language request into a proposal. Falls back
 * cleanly (no proposal, explanatory text) when there's no API key, so the app runs
 * and tests pass offline.
 */
export async function proposeEdits(
  history: AgentMessage[],
  userText: string,
  opts: { model: string; repoDir: string; maxSteps?: number },
): Promise<ProposeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { proposal: null, text: NO_KEY_TEXT, steps: 0, reason: "no_key" };
  return runProposalLoop({
    repoDir: opts.repoDir,
    history,
    userText,
    model: opts.model,
    transport: httpTransport(key),
    maxSteps: opts.maxSteps,
  });
}
