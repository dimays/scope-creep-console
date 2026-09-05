// Pure types + helpers for the Human-Input Log — no server/db imports, so they're
// unit-testable. The DB/git projection lives in human-input.server.ts.

export type InputSource =
  | "console-chat"
  | "work-request"
  | "request-reply"
  | "feedback"
  | "operator-session"
  | "owner-action";

export type InputIntent =
  | "directive"
  | "request"
  | "answer"
  | "decision"
  | "feedback"
  | "correction";

export type HumanInputEvent = {
  id: string;
  ts: number;
  source: InputSource;
  intent: InputIntent;
  summary: string;
  excerpt?: string;
  refUrl?: string;
};

export type Interlude = { fromTs: number; toTs: number; commits: string[] };

export type SpineItem =
  | { kind: "input"; input: HumanInputEvent }
  | { kind: "interlude"; interlude: Interlude };

export function truncate(s: string, n = 140): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
