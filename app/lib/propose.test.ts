import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ContentBlock,
  type ModelResponse,
  type ProposeTransport,
  parseProposal,
  runProposalLoop,
} from "./propose.server";

// ---- parseProposal (pure) --------------------------------------------------

const proposeCall = (input: unknown): ContentBlock[] => [
  { type: "text", text: "Here's the change." },
  { type: "tool_use", id: "t1", name: "propose_edits", input } as ContentBlock,
];

describe("parseProposal", () => {
  it("extracts a well-formed proposal", () => {
    const p = parseProposal(
      proposeCall({
        title: "Add a footer",
        summary: "Adds a footer link.",
        edits: [{ path: "app/x.ts", content: "export const x = 1;" }],
      }),
    );
    expect(p).not.toBeNull();
    expect(p?.title).toBe("Add a footer");
    expect(p?.edits).toHaveLength(1);
    expect(p?.edits[0]).toEqual({ path: "app/x.ts", content: "export const x = 1;" });
  });

  it("returns null when there is no propose_edits call", () => {
    expect(parseProposal([{ type: "text", text: "just talking" }])).toBeNull();
    expect(parseProposal(undefined)).toBeNull();
    expect(
      parseProposal([{ type: "tool_use", id: "r", name: "read_file", input: {} } as ContentBlock]),
    ).toBeNull();
  });

  it("rejects empty or malformed edits", () => {
    expect(parseProposal(proposeCall({ title: "t", summary: "s", edits: [] }))).toBeNull();
    expect(
      parseProposal(proposeCall({ title: "t", summary: "s", edits: [{ path: "a" }] })),
    ).toBeNull();
    expect(
      parseProposal(proposeCall({ title: "t", summary: "s", edits: [{ content: "c" }] })),
    ).toBeNull();
  });

  it("defaults a missing title but keeps a valid proposal", () => {
    const p = parseProposal(proposeCall({ edits: [{ path: "a.ts", content: "x" }] }));
    expect(p?.title).toBe("Proposed change");
    expect(p?.summary).toBe("");
  });
});

// ---- runProposalLoop (bounded read → propose loop) -------------------------

describe("runProposalLoop", () => {
  let repoDir: string;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "sc-propose-test-"));
    await writeFile(join(repoDir, "target.ts"), "export const before = 1;\n");
  });
  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true }).catch(() => undefined);
  });

  // Built lazily so it reads the repoDir assigned in beforeAll (not the undefined
  // value at describe-body evaluation time).
  const base = () => ({
    repoDir,
    history: [],
    userText: "change target.ts",
    model: "test-model",
  });

  it("reads a file, then returns the parsed proposal, feeding the real file content back", async () => {
    const seen: Array<{ role: string; content: unknown }[]> = [];
    let call = 0;
    const transport: ProposeTransport = async (body) => {
      seen.push(body.messages as { role: string; content: unknown }[]);
      call += 1;
      if (call === 1) {
        return {
          content: [
            { type: "text", text: "Let me look." },
            { type: "tool_use", id: "r1", name: "read_file", input: { path: "target.ts" } },
          ],
        } as ModelResponse;
      }
      return {
        content: [
          {
            type: "tool_use",
            id: "p1",
            name: "propose_edits",
            input: {
              title: "Bump before",
              summary: "1 -> 2",
              edits: [{ path: "target.ts", content: "export const before = 2;\n" }],
            },
          },
        ],
      } as ModelResponse;
    };

    const res = await runProposalLoop({ ...base(), transport });
    expect(res.reason).toBe("proposed");
    expect(res.steps).toBe(2);
    expect(res.proposal?.edits[0].content).toBe("export const before = 2;\n");

    // The second model call must have received the actual file content as a tool_result.
    const secondCallMessages = seen[1];
    const toolResultTurn = secondCallMessages.find(
      (m) => m.role === "user" && Array.isArray(m.content),
    );
    const results = toolResultTurn?.content as Array<{ type: string; content: string }>;
    expect(results[0].content).toContain("export const before = 1;");
  });

  it("returns an error for an unsafe read_file path without touching the filesystem", async () => {
    // A const array (never narrowed to null by TS) captures the tool_result content.
    const captured: Array<{ type: string; content: string }> = [];
    let call = 0;
    const transport: ProposeTransport = async (body) => {
      call += 1;
      if (call === 1) {
        return {
          content: [
            { type: "tool_use", id: "r1", name: "read_file", input: { path: "../../etc/passwd" } },
          ],
        } as ModelResponse;
      }
      const msgs = body.messages as { role: string; content: unknown }[];
      const turn = msgs.find((m) => m.role === "user" && Array.isArray(m.content));
      const content = turn?.content as Array<{ type: string; content: string }> | undefined;
      if (content) captured.push(...content);
      return { content: [{ type: "text", text: "can't" }] } as ModelResponse;
    };
    const res = await runProposalLoop({ ...base(), transport });
    expect(res.reason).toBe("no_proposal");
    expect(captured[0]?.content).toContain("unsafe");
  });

  it("stops with no_proposal when the model only talks", async () => {
    const transport: ProposeTransport = async () =>
      ({ content: [{ type: "text", text: "What file should I change?" }] }) as ModelResponse;
    const res = await runProposalLoop({ ...base(), transport });
    expect(res.reason).toBe("no_proposal");
    expect(res.text).toContain("What file");
  });

  it("terminates at maxSteps if the model never proposes (loops must terminate)", async () => {
    const transport: ProposeTransport = async () =>
      ({
        content: [{ type: "tool_use", id: "r", name: "read_file", input: { path: "target.ts" } }],
      }) as ModelResponse;
    const res = await runProposalLoop({ ...base(), transport, maxSteps: 3 });
    expect(res.reason).toBe("max_steps");
    expect(res.steps).toBe(3);
    expect(res.proposal).toBeNull();
  });

  it("returns reason=error if the transport throws", async () => {
    const transport: ProposeTransport = async () => {
      throw new Error("network");
    };
    const res = await runProposalLoop({ ...base(), transport });
    expect(res.reason).toBe("error");
    expect(res.proposal).toBeNull();
  });
});
