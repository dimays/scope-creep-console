import { describe, expect, it } from "vitest";
import { type AgentMessage, toAnthropicMessages } from "./agent.server";

describe("toAnthropicMessages", () => {
  it("maps roles and appends the new user text", () => {
    const history: AgentMessage[] = [
      { role: "owner", body: "hi" },
      { role: "agent", body: "hello" },
    ];
    const msgs = toAnthropicMessages(history, "what's next?");
    expect(msgs).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "what's next?" },
    ]);
  });

  it("drops a leading assistant (greeting) so it starts with user", () => {
    const history: AgentMessage[] = [
      { role: "agent", body: "greeting" },
      { role: "owner", body: "hi" },
      { role: "agent", body: "hello" },
    ];
    const msgs = toAnthropicMessages(history, "go");
    expect(msgs[0]).toEqual({ role: "user", content: "hi" });
    expect(msgs.at(-1)).toEqual({ role: "user", content: "go" });
  });

  it("ignores system messages", () => {
    const history: AgentMessage[] = [{ role: "system", body: "note" }];
    expect(toAnthropicMessages(history, "hi")).toEqual([{ role: "user", content: "hi" }]);
  });
});
