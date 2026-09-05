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

export async function agentRespond(history: AgentMessage[], userText: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallbackReply(userText);

  const model = process.env.CHAT_MODEL ?? "claude-sonnet-5";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
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
