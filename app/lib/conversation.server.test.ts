import { describe, expect, it } from "vitest";
import { agentTurn, getOrCreateConversation, listMessages } from "./conversation.server";

describe("conversation primitive", () => {
  it("creates one ongoing conversation per kind and seeds a greeting", async () => {
    const id = await getOrCreateConversation("chat", "Chat");
    const again = await getOrCreateConversation("chat", "Chat");
    expect(again).toBe(id); // single ongoing conversation per kind

    const msgs = await listMessages(id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("agent"); // the greeting
  });

  it("agentTurn records the owner message + an agent reply and returns it", async () => {
    const id = await getOrCreateConversation("chat", "Chat");
    const before = (await listMessages(id)).length;

    const reply = await agentTurn(id, "What is Scope Creep?");
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0); // offline fallback (no API key in tests)

    const after = await listMessages(id);
    expect(after).toHaveLength(before + 2);
    expect(after.at(-2)?.role).toBe("owner");
    expect(after.at(-2)?.body).toBe("What is Scope Creep?");
    expect(after.at(-1)?.role).toBe("agent");
  });
});
