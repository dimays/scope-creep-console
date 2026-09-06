import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCliCommand,
  buildDeepLink,
  buildOpenRepoLink,
  buildResumeCommand,
  buildSeedPrompt,
  claudeProjectDirName,
  firstOwnerText,
  parseTranscript,
  sessionMatchesMarker,
  stripMarker,
  threadMarker,
} from "./claude-sessions";

const FIXTURE = readFileSync(join(__dirname, "__fixtures__", "claude-session.jsonl"), "utf8");
const INJECTED_FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "injected-records.jsonl"),
  "utf8",
);

describe("thread ↔ session correlation markers (work-046)", () => {
  it("threadMarker is compact and unique per thread", () => {
    expect(threadMarker(7)).toBe("[scope-creep-thread:7]");
    expect(threadMarker(7)).not.toBe(threadMarker(8));
  });

  it("buildSeedPrompt appends the marker on its own line", () => {
    const p = buildSeedPrompt(7, "Do the thing.");
    expect(p).toContain("Do the thing.");
    expect(p).toContain(threadMarker(7));
    expect(p.trimEnd().endsWith(threadMarker(7))).toBe(true);
  });

  it("firstOwnerText returns the seed prompt (with marker) and ignores metadata/tool records", () => {
    expect(firstOwnerText(FIXTURE)).toContain("Give me a concise State of the Product.");
    expect(firstOwnerText(FIXTURE)).toContain("[scope-creep-thread:7]");
  });

  it("sessionMatchesMarker matches the right thread and rejects others", () => {
    expect(sessionMatchesMarker(FIXTURE, threadMarker(7))).toBe(true);
    expect(sessionMatchesMarker(FIXTURE, threadMarker(8))).toBe(false);
  });

  it("firstOwnerText is null when there is no owner text yet (empty is empty)", () => {
    const onlyMeta = '{"type":"queue-operation","content":"x"}\n{"type":"system"}';
    expect(firstOwnerText(onlyMeta)).toBeNull();
    expect(firstOwnerText("")).toBeNull();
  });
});

describe("launch URLs + fallback command (work-046)", () => {
  it("buildDeepLink opens a new Claude Code session with folder + prompt, both encoded", () => {
    const url = buildDeepLink({ cwd: "/Users/x/code/scope-creep", prompt: "hi there & bye" });
    // Claude Desktop scheme (the one actually registered), new-session route.
    expect(url.startsWith("claude://code/new?q=")).toBe(true);
    expect(url).toContain(`folder=${encodeURIComponent("/Users/x/code/scope-creep")}`);
    expect(url).toContain(`q=${encodeURIComponent("hi there & bye")}`);
    // No raw ampersand from the prompt leaking a spurious query param.
    expect(url.split("&").length).toBe(2); // exactly q=… & folder=…
  });

  it("buildDeepLink preserves the thread marker inside q (work-047 correlation)", () => {
    const seed = buildSeedPrompt(7, "Give me a State of the Product.");
    const url = buildDeepLink({ cwd: "/Users/x/code/scope-creep", prompt: seed });
    // The marker survives url-encoding inside q so the transcript correlator can resolve it.
    expect(url).toContain(encodeURIComponent(threadMarker(7)));
    const q = new URL(url).searchParams.get("q");
    expect(q).toContain(threadMarker(7));
  });

  it("buildOpenRepoLink opens a new session in the folder with no seed", () => {
    const url = buildOpenRepoLink("/Users/x/code/scope-creep");
    expect(url).toBe(`claude://code/new?folder=${encodeURIComponent("/Users/x/code/scope-creep")}`);
    expect(url).not.toContain("q=");
  });

  it("buildCliCommand escapes quotes so it is paste-safe", () => {
    const cmd = buildCliCommand({ cwd: "/repo", prompt: 'say "hello"' });
    expect(cmd).toBe('cd /repo && claude "say \\"hello\\""');
  });

  it("buildResumeCommand targets a specific session uuid", () => {
    expect(buildResumeCommand("abc-123")).toBe("claude --resume abc-123");
  });
});

describe("project-dir mangling", () => {
  it("maps a cwd to Claude Code's ~/.claude/projects folder name", () => {
    expect(claudeProjectDirName("/Users/davidmays/code/scope-creep")).toBe(
      "-Users-davidmays-code-scope-creep",
    );
  });
  it("turns dots into dashes too", () => {
    expect(claudeProjectDirName("/a/b.c/d")).toBe("-a-b-c-d");
  });
});

describe("transcript projection from local JSONL (work-047)", () => {
  const turns = parseTranscript(FIXTURE);

  it("projects owner + agent turns in order, never inventing", () => {
    const roles = turns.map((t) => t.role);
    // owner(seed) → agent(text) → tool ×3 → agent(text) → owner(text); the sidechain
    // agent text and the thinking/tool_result records in between are all skipped.
    expect(roles).toEqual(["owner", "agent", "tool", "tool", "tool", "agent", "owner"]);
  });

  it("strips the correlation marker from displayed owner text", () => {
    const firstOwner = turns.find((t) => t.role === "owner");
    expect(firstOwner?.text).toBe("Give me a concise State of the Product.");
    expect(firstOwner?.text).not.toContain("scope-creep-thread");
  });

  it("summarizes tool_use at a high level (name only, no args/output)", () => {
    const toolTurns = turns.filter((t) => t.role === "tool");
    expect(toolTurns.map((t) => t.tool)).toEqual(["Read", "Read", "Bash"]);
    // never leaks tool input/output
    expect(JSON.stringify(toolTurns)).not.toContain("git log");
    expect(JSON.stringify(toolTurns)).not.toContain("/x");
  });

  it("skips thinking blocks, tool_result feedback, sidechains, and metadata records", () => {
    const joined = JSON.stringify(turns);
    expect(joined).not.toContain("private reasoning");
    expect(joined).not.toContain("mechanical, must be ignored");
    expect(joined).not.toContain("sub-agent turn");
    expect(joined).not.toContain("metadata record");
  });

  it("carries timestamps and reads the agent's spoken text", () => {
    const firstAgent = turns.find((t) => t.role === "agent");
    expect(firstAgent?.text).toBe("On it — let me check the ledger and the work board.");
    expect(typeof firstAgent?.at).toBe("number");
  });

  it("empty is empty — no turns from an empty or metadata-only session", () => {
    expect(parseTranscript("")).toEqual([]);
    expect(parseTranscript('{"type":"queue-operation","content":"x"}')).toEqual([]);
  });

  it("stripMarker removes the marker and trims", () => {
    expect(stripMarker("hello\n\n[scope-creep-thread:42]")).toBe("hello");
  });
});

describe("system-injected user records don't render as the Owner (Bug 1)", () => {
  const turns = parseTranscript(INJECTED_FIXTURE);
  const ownerTexts = turns.filter((t) => t.role === "owner").map((t) => t.text);

  it("keeps genuine owner/agent turns, in order, and excludes every injected record", () => {
    // Interleaved: isMeta system-reminder, owner, agent, string system-reminder, command
    // wrapper, local-command-stdout, two interrupt notices, owner (mid-body mention), agent,
    // owner. Only the three real owner + two agent turns survive, in order.
    expect(turns.map((t) => t.role)).toEqual(["owner", "agent", "owner", "agent", "owner"]);
  });

  it("filters the working-directory system-reminder (verified live on thread 7) so it isn't YOU", () => {
    const joined = JSON.stringify(turns);
    expect(joined).not.toContain("working directory has changed");
    expect(joined).not.toContain("Plan mode is active");
  });

  it("filters slash-command wrappers and their stdout", () => {
    const joined = JSON.stringify(turns);
    expect(joined).not.toContain("<command-name>");
    expect(joined).not.toContain("/compact");
    expect(joined).not.toContain("<local-command-stdout>");
    expect(joined).not.toContain("compacted 40 messages");
  });

  it("filters both interrupt notices", () => {
    const joined = JSON.stringify(turns);
    expect(joined).not.toContain("[Request interrupted by user]");
    expect(joined).not.toContain("[Request interrupted by user for tool use]");
  });

  it("keeps a real owner message that only MENTIONS an injected tag mid-body", () => {
    expect(ownerTexts).toContain("Please explain what a <system-reminder> block is.");
  });

  it("keeps genuine owner text (marker stripped) in the right order", () => {
    expect(ownerTexts).toEqual([
      "Kick off the crank.",
      "Please explain what a <system-reminder> block is.",
      "Thanks, wrap it up.",
    ]);
  });

  it("firstOwnerText skips a leading injected record and returns the real seed (marker intact)", () => {
    const first = firstOwnerText(INJECTED_FIXTURE);
    // The leading isMeta system-reminder must not fool correlation.
    expect(first).not.toContain("working directory has changed");
    expect(first).toContain("Kick off the crank.");
    expect(first).toContain("[scope-creep-thread:9]");
    expect(sessionMatchesMarker(INJECTED_FIXTURE, threadMarker(9))).toBe(true);
  });
});
