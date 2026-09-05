import { describe, expect, it } from "vitest";
import { parseWorkFrontmatter } from "./work.server";

describe("parseWorkFrontmatter", () => {
  it("reads flat key: value fields", () => {
    const src = [
      "---",
      "id: work-001",
      "title: Build the chatbot extension",
      "type: feature",
      "status: proposed",
      "priority: high",
      "owner: chief-designer",
      "---",
      "body text",
    ].join("\n");
    const fm = parseWorkFrontmatter(src);
    expect(fm.id).toBe("work-001");
    expect(fm.title).toBe("Build the chatbot extension");
    expect(fm.type).toBe("feature");
    expect(fm.status).toBe("proposed");
    expect(fm.priority).toBe("high");
    expect(fm.owner).toBe("chief-designer");
  });

  it("returns an empty object when there is no frontmatter", () => {
    expect(parseWorkFrontmatter("# no frontmatter")).toEqual({});
  });
});
