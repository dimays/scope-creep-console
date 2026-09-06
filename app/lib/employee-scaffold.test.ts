import { describe, expect, it } from "vitest";
import {
  addAssignee,
  displayName,
  employeeFilePath,
  isValidSlug,
  renderEmployeeManifest,
  slugify,
} from "./employee-scaffold";

describe("slugify / isValidSlug / displayName", () => {
  it("slugifies free text", () => {
    expect(slugify("Ada Lovelace")).toBe("ada-lovelace");
    expect(slugify("  Data  Analyst! ")).toBe("data-analyst");
  });
  it("validates slugs", () => {
    expect(isValidSlug("ada")).toBe(true);
    expect(isValidSlug("data-analyst")).toBe(true);
    expect(isValidSlug("1bad")).toBe(false);
    expect(isValidSlug("Bad")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
  it("title-cases display names", () => {
    expect(displayName("ada")).toBe("Ada");
    expect(displayName("tech-writer")).toBe("Tech Writer");
  });
});

describe("renderEmployeeManifest", () => {
  const md = renderEmployeeManifest({
    name: "ada",
    template: "frontend-engineer",
    reportsTo: "chief-designer",
    description: "Frontend engineer for the Console.",
    tickets: ["work-045", "work-048"],
    created: "2026-09-06",
  });

  it("writes the employee frontmatter and file path", () => {
    expect(employeeFilePath("ada")).toBe("agents/employees/ada.md");
    expect(md).toContain("name: ada");
    expect(md).toContain("kind: employee");
    expect(md).toContain("reports_to: chief-designer");
    expect(md).toContain("template: frontend-engineer");
    expect(md).toContain("created: 2026-09-06");
  });

  it("links staffed tickets as wikilinks", () => {
    expect(md).toContain("[[work-045]]");
    expect(md).toContain("[[work-048]]");
  });

  it("shows an available state when unstaffed", () => {
    const idle = renderEmployeeManifest({
      name: "quill",
      template: "technical-writer",
      reportsTo: "chief-knowledge-manager",
      description: "On-call writer.",
      created: "2026-09-06",
    });
    expect(idle).toContain("not yet staffed");
  });
});

describe("addAssignee", () => {
  const base = `---
id: work-045
title: A ticket
owner: chief-designer
spec: prd-x
---
Body.`;

  it("inserts an assignees line after owner when none exists", () => {
    const out = addAssignee(base, "ada");
    expect(out).toContain("owner: chief-designer\nassignees: ada\nspec: prd-x");
  });

  it("appends to an existing assignees line", () => {
    const withOne = addAssignee(base, "ada");
    const withTwo = addAssignee(withOne, "vera");
    expect(withTwo).toContain("assignees: ada, vera");
  });

  it("is idempotent for an already-staffed slug", () => {
    const once = addAssignee(base, "ada");
    expect(addAssignee(once, "ada")).toBe(once);
  });

  it("leaves the body untouched", () => {
    expect(addAssignee(base, "ada").endsWith("\nBody.")).toBe(true);
  });
});
