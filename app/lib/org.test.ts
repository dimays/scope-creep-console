import { describe, expect, it } from "vitest";
import { buildOrg, employeesOfTemplate, ticketsFor } from "./org.server";
import type { RegistryAgent } from "./registry.server";
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
  },
  {
    name: "ghost",
    kind: "employee",
    status: "active",
    reports_to: "nobody",
    template: "researcher",
  },
];

const items: WorkItem[] = [
  work({ id: "work-1", owner: "chief-designer", assignees: ["ada"] }),
  work({ id: "work-2", owner: "cto", assignees: ["linus", "ada"] }),
  work({ id: "work-3", owner: "cto" }),
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
  const tree = buildOrg(agents, items);

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
});

describe("employeesOfTemplate", () => {
  it("lists only employees instantiated from the given template", () => {
    expect(employeesOfTemplate(agents, "frontend-engineer").map((a) => a.name)).toEqual(["ada"]);
    expect(employeesOfTemplate(agents, "backend-engineer").map((a) => a.name)).toEqual(["linus"]);
    expect(employeesOfTemplate(agents, "none")).toEqual([]);
  });
});
