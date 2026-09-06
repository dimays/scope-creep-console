import { afterEach, describe, expect, it, vi } from "vitest";
import { agentRespond } from "./agent.server";
import { clearInterruption, readInterruption } from "./processing.server";

/**
 * Proves the interrupted/token-limit banner is driven by real backend state (work-011):
 * a 429 from the agent runtime records an interruption; a successful call clears it.
 */

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await clearInterruption();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("agentRespond → processing state", () => {
  it("records an interruption on a 429 with a reset ETA from retry-after", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("rate limited", { status: 429, headers: { "retry-after": "30" } }),
      ),
    );

    const before = Date.now();
    await agentRespond([], "hello");
    const intr = await readInterruption();
    expect(intr).not.toBeNull();
    expect(intr?.reason).toBe("Token/rate limit reached");
    // retry-after: 30s → reset ~30s out.
    expect(intr?.resetAt).toBeGreaterThanOrEqual(before + 29_000);
    expect(intr?.resetAt).toBeLessThanOrEqual(Date.now() + 31_000);
  });

  it("clears the interruption when a call succeeds (processing resumed)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    // First a 429 to arm the banner…
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("rate limited", { status: 429, headers: { "retry-after": "30" } }),
      ),
    );
    await agentRespond([], "hello");
    expect(await readInterruption()).not.toBeNull();

    // …then a success clears it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ content: [{ type: "text", text: "hi there" }] })),
    );
    const reply = await agentRespond([], "hello again");
    expect(reply).toBe("hi there");
    expect(await readInterruption()).toBeNull();
  });
});
