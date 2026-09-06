/**
 * The in-app agent runtime (ADR-008). Produces an agent reply for a conversation.
 * Calls Claude's Messages API when ANTHROPIC_API_KEY is set (server-side auth),
 * and otherwise returns a clearly-labeled fallback so the app runs without a key.
 *
 * v1 is text-only: no tools. Code-editing tools arrive with work-015/016 behind the
 * ADR-009 sandbox + gates.
 */

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

const MODEL = () => process.env.CHAT_MODEL ?? "claude-sonnet-5";

export async function agentRespond(history: AgentMessage[], userText: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallbackReply(userText);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(key),
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: toAnthropicMessages(history, userText),
      }),
    });
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

/**
 * Streaming variant (ADR-013): yields text deltas as Claude produces them, so the
 * Console can render a reply token-by-token with no browser refresh. Degrades to a
 * single yielded chunk when there's no key or on any error — i.e. batched-with-indicator
 * is the automatic floor. Same-process, request-scoped: no websocket/SSE-GET channel.
 */
export async function* agentRespondStream(
  history: AgentMessage[],
  userText: string,
): AsyncGenerator<string, void, unknown> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    yield fallbackReply(userText);
    return;
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(key),
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: toAnthropicMessages(history, userText),
        stream: true,
      }),
    });
  } catch {
    yield "The chat runtime couldn't reach Claude (network error). Try again.";
    return;
  }
  if (!res.ok || !res.body) {
    yield `The chat runtime reached Claude but got an error (${res.status}). Check the model or key.`;
    return;
  }

  // Parse the SSE stream: events are separated by a blank line; we only care about
  // `content_block_delta` text_delta events. Anything else is ignored.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emitted = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard SSE frame split
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload) as {
              type?: string;
              delta?: { type?: string; text?: string };
            };
            if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              const text = evt.delta.text ?? "";
              if (text) {
                emitted = true;
                yield text;
              }
            }
          } catch {
            // ignore a malformed frame
          }
        }
      }
    }
  } catch {
    if (!emitted) yield "The chat runtime lost the connection mid-reply. Try again.";
    return;
  }
  if (!emitted) yield "(Claude returned an empty reply.)";
}
