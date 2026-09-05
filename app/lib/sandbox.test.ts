import { describe, expect, it } from "vitest";
import { type Edit, validateProposal } from "./sandbox.server";

const ok = (edits: Edit[]) => validateProposal(edits).ok;

describe("validateProposal (path safety)", () => {
  it("accepts a normal repo-relative path", () => {
    expect(ok([{ path: "app/routes/home.tsx", content: "x" }])).toBe(true);
  });

  it("rejects absolute paths", () => {
    expect(ok([{ path: "/etc/passwd", content: "x" }])).toBe(false);
    expect(ok([{ path: "C:/win", content: "x" }])).toBe(false);
  });

  it("rejects parent-directory escapes", () => {
    expect(ok([{ path: "../secrets", content: "x" }])).toBe(false);
    expect(ok([{ path: "app/../../etc", content: "x" }])).toBe(false);
  });

  it("rejects empty edit sets and empty paths", () => {
    expect(ok([])).toBe(false);
    expect(ok([{ path: "", content: "x" }])).toBe(false);
  });

  it("requires string content", () => {
    expect(ok([{ path: "a.txt", content: 5 as unknown as string }])).toBe(false);
  });
});
