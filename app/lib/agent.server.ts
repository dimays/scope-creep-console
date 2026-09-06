/**
 * The in-app agent runtime (ADR-008). Produces an agent reply for a conversation.
 * Calls Claude's Messages API when ANTHROPIC_API_KEY is set (server-side auth),
 * and otherwise returns a clearly-labeled fallback so the app runs without a key.
 *
 * v1 is text-only: no tools. Code-editing tools arrive with work-015/016 behind the
 * ADR-009 sandbox + gates.
 */

import { clearInterruption, recordInterruption } from "./processing.server";

export type AgentRole = "owner" | "agent" | "system";
export type AgentMessage = { role: AgentRole; body: string };

const SYSTEM_PROMPT = [
  "You are the Scope Creep Console's in-app assistant.",
  "Scope Creep is a single-user, agent-driven software factory that builds and rewrites its own apps.",
  "Help the Owner understand and shape the platform. Be concise and concrete.",
  "You cannot edit code yet — live edit/preview/merge arrives in work-015/016. Say so if asked to change code.",
].join(" ");

type AnthropicMessage = { role: "user" | "assistant"; content: string };

/** Map our thread + the new user text to Anthropic's alternating message shape. */
export function toAnthropicMessages(history: AgentMessage[], userText: string): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of history) {
    if (m.role === "owner") out.push({ role: "user", content: m.body });
    else if (m.role === "agent") out.push({ role: "assistant", content: m.body });
    // system messages are not part of the turn history
  }
  while (out.length > 0 && out[0].role === "assistant") out.shift(); // must start with user
  out.push({ role: "user", content: userText });
  return out;
}

function fallbackReply(userText: string): string {
  return (
    "The chat runtime is live (work-014), but no ANTHROPIC_API_KEY is configured, " +
    "so I can't reach Claude yet. Set the key to enable real replies. " +
    `You said: "${userText}"`
  );
}

function anthropicHeaders(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  };
}

/**
 * The model for a turn (work-018). Callers resolve the effective model — the Owner's
 * persisted pick, or an agent's per-task choice, validated against `models.json` — and
 * pass it in. When omitted (e.g. legacy callers/tests) we fall back to the `CHAT_MODEL`
 * env default, then the hardcoded floor. Resolution/validation lives in `models*.ts`;
 * this module never invents an id.
 */
const MODEL = (model?: string) => model ?? process.env.CHAT_MODEL ?? "claude-sonnet-5";

/**
 * Derive a reset ETA (epoch ms) from a 429 response's headers. Prefers Anthropic's
 * `retry-after` (seconds) and falls back to the `anthropic-ratelimit-*-reset` ISO
 * timestamps; defaults to +60s when nothing usable is present.
 */
function resetAtFromHeaders(headers: Headers, now: number): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return now + secs * 1000;
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate) && asDate > now) return asDate;
  }
  for (const h of ["anthropic-ratelimit-tokens-reset", "anthropic-ratelimit-requests-reset"]) {
    const iso = headers.get(h);
    if (iso) {
      const t = Date.parse(iso);
      if (!Number.isNaN(t) && t > now) return t;
    }
  }
  return now + 60_000;
}

/**
 * Reflect the upstream response into the app-wide processing state (work-011): a 429
 * records an interruption with a reset ETA; any successful call clears it (processing
 * resumed). Guarded so it can never break the reply path — the persisted reply/thread
 * is always the source of truth.
 */
async function noteRateLimit(res: Response): Promise<void> {
  try {
    if (res.status === 429) {
      const now = Date.now();
      await recordInterruption({
        reason: "Token/rate limit reached",
        resetAt: resetAtFromHeaders(res.headers, now),
        detail: "The agent runtime hit Claude's rate limit. New work is paused until it resets.",
        now,
      });
    } else if (res.ok) {
      await clearInterruption();
    }
  } catch {
    // processing state is advisory; never let it break a reply
  }
}

export async function agentRespond(
  history: AgentMessage[],
  userText: string,
  opts: { model?: string } = {},
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallbackReply(userText);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(key),
      body: JSON.stringify({
        model: MODEL(opts.model),
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: toAnthropicMessages(history, userText),
      }),
    });
    await noteRateLimit(res);
    if (!res.ok) {
      return `The chat runtime reached Claude but got an error (${res.status}). Check the model or key.`;
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    return text || "(Claude returned an empty reply.)";
  } catch {
    return "The chat runtime couldn't reach Claude (network error). Try again.";
  }
}
