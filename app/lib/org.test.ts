import { describe, expect, it } from "vitest";
import { buildOrg, employeesOfTemplate, ticketsFor } from "./org.server";
import type { EmployeeTemplate, RegistryAgent } from "./registry.server";
import type { WorkItem } from "./work.server";

function work(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    type: "feature",
    status: partial.status ?? "proposed",
    priority: "medium",
    owner: partial.owner ?? "",
    assignees: partial.assignees ?? [],
    created: "2026-09-06",
    updated: "2026-09-06",
    file: `${partial.id}.md`,
  };
}

const agents: RegistryAgent[] = [
  { name: "cto", kind: "core", status: "active" },
  { name: "chief-designer", kind: "core", status: "active" },
  // Standing functions (ADR-020 §B): permanent, cross-org — not execs, not employees.
  { name: "qa-tester", kind: "function", status: "active" },
  { name: "git-manager", kind: "function", status: "active" },
  {
    name: "ada",
    kind: "employee",
    status: "active",
    reports_to: "chief-designer",
    template: "frontend-engineer",
  },
  {
    name: "linus",
    kind: "employee",
    status: "active",
    reports_to: "cto",
    template: "backend-engineer",
    default_model: "claude-opus-4-8", // a per-employee escalation off the template default
  },
  {
    name: "ghost",
    kind: "employee",
    status: "retired",
    reports_to: "nobody",
    template: "researcher",
  },
];

const templates: EmployeeTemplate[] = [
  {
    name: "frontend-engineer",
    kind: "template",
    owner_agent: "chief-designer",
    default_model: "claude-sonnet-5",
  },
  {
    name: "design-systems-engineer",
    kind: "template",
    owner_agent: "chief-designer",
    default_model: "claude-sonnet-5",
  },
  {
    name: "backend-engineer",
    kind: "template",
    owner_agent: "cto",
    default_model: "claude-sonnet-5",
  },
  // A template hanging under a standing function should NOT land in any exec's catalog.
  {
    name: "orphan-template",
    kind: "template",
    owner_agent: "qa-tester",
    default_model: "claude-haiku-4-5-20251001",
  },
];

const items: WorkItem[] = [
  work({ id: "work-1", owner: "chief-designer", assignees: ["ada"] }),
  work({ id: "work-2", owner: "cto", assignees: ["linus", "ada"] }),
  work({ id: "work-3", owner: "cto" }),
  work({ id: "work-4", owner: "chief-reality-officer", assignees: ["qa-tester"] }),
];

describe("ticketsFor", () => {
  it("returns owned and staffed tickets with the right role", () => {
    const cto = ticketsFor("cto", items);
    expect(cto.map((t) => t.id)).toEqual(["work-2", "work-3"]);
    expect(cto.every((t) => t.role === "owner")).toBe(true);

    const ada = ticketsFor("ada", items);
    expect(ada.map((t) => `${t.id}:${t.role}`)).toEqual(["work-1:assignee", "work-2:assignee"]);
  });

  it("returns nothing for an unstaffed agent", () => {
    expect(ticketsFor("quill", items)).toEqual([]);
  });
});

describe("buildOrg", () => {
  const tree = buildOrg(agents, templates, items);

  it("groups employees under their reporting exec", () => {
    const designer = tree.execs.find((e) => e.name === "chief-designer");
    const cto = tree.execs.find((e) => e.name === "cto");
    expect(designer?.employees.map((e) => e.name)).toEqual(["ada"]);
    expect(cto?.employees.map((e) => e.name)).toEqual(["linus"]);
  });

  it("puts employees with an unknown reports_to in orphans", () => {
    expect(tree.orphans.map((e) => e.name)).toEqual(["ghost"]);
  });

  it("counts owned and distinct staffed tickets per exec", () => {
    const cto = tree.execs.find((e) => e.name === "cto");
    // cto owns work-2 and work-3; linus is staffed to work-2 → 1 distinct staffed.
    expect(cto?.ownedTicketCount).toBe(2);
    expect(cto?.staffedTicketCount).toBe(1);
  });

  it("orders execs by headcount then name", () => {
    // Both execs have 1 report → alphabetical: chief-designer before cto.
    expect(tree.execs.map((e) => e.name)).toEqual(["chief-designer", "cto"]);
  });

  it("carries the owner sentinel at the top", () => {
    expect(tree.owner).toBe("human-owner");
  });

  // --- ADR-020: the four tiers -------------------------------------------------

  it("separates the standing-function tier from executives", () => {
    // Executives are core only — the functions must not be counted as execs.
    expect(tree.execs.map((e) => e.name)).not.toContain("qa-tester");
    expect(tree.execs.map((e) => e.name)).not.toContain("git-manager");
    expect(tree.functions.map((f) => f.name)).toEqual(["git-manager", "qa-tester"]);
  });

  it("carries cross-org tickets on a standing function", () => {
    const qa = tree.functions.find((f) => f.name === "qa-tester");
    expect(qa?.tickets.map((t) => `${t.id}:${t.role}`)).toEqual(["work-4:assignee"]);
  });

  it("groups the template catalog under each exec by owner_agent", () => {
    const designer = tree.execs.find((e) => e.name === "chief-designer");
    const cto = tree.execs.find((e) => e.name === "cto");
    // Alphabetized, and only templates whose owner_agent is this exec.
    expect(designer?.templates.map((t) => t.name)).toEqual([
      "design-systems-engineer",
      "frontend-engineer",
    ]);
    expect(cto?.templates.map((t) => t.name)).toEqual(["backend-engineer"]);
  });

  it("surfaces each template's default_model preset in the catalog", () => {
    const designer = tree.execs.find((e) => e.name === "chief-designer");
    const fe = designer?.templates.find((t) => t.name === "frontend-engineer");
    expect(fe?.defaultModel).toBe("claude-sonnet-5");
  });

  it("does not hang a function's templates under any executive", () => {
    // orphan-template.owner_agent === "qa-tester" (a function) → belongs to no exec catalog.
    const allExecTemplates = tree.execs.flatMap((e) => e.templates.map((t) => t.name));
    expect(allExecTemplates).not.toContain("orphan-template");
  });

  it("preserves employee lifecycle status and per-employee model overrides", () => {
    const cto = tree.execs.find((e) => e.name === "cto");
    const linus = cto?.employees.find((e) => e.name === "linus");
    expect(linus?.status).toBe("active");
    expect(linus?.defaultModel).toBe("claude-opus-4-8"); // escalated off the sonnet template
    // A retired employee keeps its status so the view can render it as dissolved.
    expect(tree.orphans.find((e) => e.name === "ghost")?.status).toBe("retired");
  });
});

describe("employeesOfTemplate", () => {
  it("lists only employees instantiated from the given template", () => {
    expect(employeesOfTemplate(agents, "frontend-engineer").map((a) => a.name)).toEqual(["ada"]);
    expect(employeesOfTemplate(agents, "backend-engineer").map((a) => a.name)).toEqual(["linus"]);
    expect(employeesOfTemplate(agents, "none")).toEqual([]);
  });
});
