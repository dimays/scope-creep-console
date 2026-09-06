import { describe, expect, it } from "vitest";
import { renderTemplateManifest, templateFilePath } from "./template-scaffold";

describe("renderTemplateManifest", () => {
  it("writes template frontmatter with skills and default model", () => {
    const md = renderTemplateManifest({
      name: "data-analyst",
      description: "Turns questions into charts.",
      ownerAgent: "chief-product-officer",
      defaultModel: "claude-sonnet-5",
      skills: "sql, dbt, charts",
      created: "2026-09-06",
    });
    expect(templateFilePath("data-analyst")).toBe("agents/templates/data-analyst.md");
    expect(md).toContain("name: data-analyst");
    expect(md).toContain("kind: template");
    expect(md).toContain("owner_agent: chief-product-officer");
    expect(md).toContain("default_model: claude-sonnet-5");
    expect(md).toContain("skills: sql, dbt, charts");
    expect(md).toContain("# Employee template — Data Analyst");
  });

  it("accepts skills as an array and defaults the model", () => {
    const md = renderTemplateManifest({
      name: "sre",
      description: "Keeps the lights on.",
      ownerAgent: "cto",
      skills: ["oncall", "observability"],
      created: "2026-09-06",
    });
    expect(md).toContain("skills: oncall, observability");
    expect(md).toContain("default_model: claude-sonnet-5");
  });

  it("uses the provided operating manual verbatim when given", () => {
    const md = renderTemplateManifest({
      name: "sre",
      description: "Keeps the lights on.",
      ownerAgent: "cto",
      manual: "## Mandate\n- Page when it burns.",
      created: "2026-09-06",
    });
    expect(md).toContain("## Mandate\n- Page when it burns.");
  });
});
