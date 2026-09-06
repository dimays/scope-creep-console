/**
 * The org model (ADR-017 / prd-org-and-staffing): who reports to whom, and who is
 * staffed to what. Pure builders (unit-tested) join the generated agent registry to
 * the control plane's work items; `readOrg` wires them to live data.
 *
 * Source of truth stays split by design: an employee's manifest declares its existence
 * and reporting line (`reports_to`); work items declare staffing (`owner` = accountable
 * exec, `assignees` = staffed employees). This module derives the join — it never
 * duplicates staffing onto the employee.
 */

import { type EmployeeTemplate, type RegistryAgent, readRegistry } from "./registry.server";
import { listWork, type WorkItem, type WorkStatus } from "./work.server";

/** The single human at the top — the glossary sentinel used across manifests. */
export const OWNER_SENTINEL = "human-owner";

export type TicketRef = {
  id: string;
  title: string;
  status: WorkStatus;
  role: "owner" | "assignee";
};

export type OrgEmployee = {
  name: string;
  description?: string;
  /** Lifecycle status (ADR-020 §C): active | idle | retired. */
  status?: string;
  template?: string;
  reportsTo?: string;
  /** Per-employee model override (ADR-020 §D), if the instance escalates off its template. */
  defaultModel?: string;
  tickets: TicketRef[];
};

/**
 * A template in an executive's summon catalog (ADR-020 §D) — the "types of employees I
 * can summon", each carrying its `default_model` preset.
 */
export type OrgTemplate = {
  name: string;
  description?: string;
  defaultModel?: string;
  skills?: string[];
  status?: string;
};

export type OrgExec = {
  name: string;
  kind?: string;
  status?: string;
  description?: string;
  employees: OrgEmployee[];
  /** The template catalog this exec can summon from (grouped by `owner_agent`). */
  templates: OrgTemplate[];
  ownedTicketCount: number;
  /** Distinct tickets staffed to any of this exec's employees. */
  staffedTicketCount: number;
};

/**
 * A standing function agent (ADR-020 tier `function`): qa-tester, git-manager —
 * permanent, cross-org execution, not an executive and not an employee.
 */
export type OrgFunction = {
  name: string;
  kind?: string;
  status?: string;
  description?: string;
  /** Tickets this function currently owns or is staffed to (cross-org). */
  tickets: TicketRef[];
};

export type OrgTree = {
  owner: string;
  execs: OrgExec[];
  /** The standing-function tier (permanent cross-org functions). */
  functions: OrgFunction[];
  /** Employees whose `reports_to` matches no known exec (should be empty in a healthy org). */
  orphans: OrgEmployee[];
};

/** Tickets an agent is on: owner (accountable) or assignee (staffed). */
export function ticketsFor(slug: string, work: WorkItem[]): TicketRef[] {
  const out: TicketRef[] = [];
  for (const w of work) {
    if (w.owner === slug) {
      out.push({ id: w.id, title: w.title, status: w.status, role: "owner" });
    } else if (w.assignees.includes(slug)) {
      out.push({ id: w.id, title: w.title, status: w.status, role: "assignee" });
    }
  }
  return out;
}

function toEmployee(agent: RegistryAgent, work: WorkItem[]): OrgEmployee {
  return {
    name: agent.name,
    description: agent.description,
    status: agent.status,
    template: agent.template,
    reportsTo: agent.reports_to,
    defaultModel: agent.default_model,
    tickets: ticketsFor(agent.name, work),
  };
}

function toTemplate(t: EmployeeTemplate): OrgTemplate {
  return {
    name: t.name,
    description: t.description,
    defaultModel: t.default_model,
    skills: t.skills,
    status: t.status,
  };
}

/**
 * Build the four-tier org (ADR-020): Owner → executives (`kind: core`) → their
 * employees, each executive carrying the template catalog it can summon from (grouped by
 * `owner_agent`); plus the standing-function tier (`kind: function`) rendered apart from
 * both. Pure: takes the registry agents, the template catalog, and work items, and returns
 * the shape the org view renders. Executives are ordered by headcount (most reports first),
 * then name, so a populated org reads top-down.
 */
export function buildOrg(
  agents: RegistryAgent[],
  templates: EmployeeTemplate[],
  work: WorkItem[],
): OrgTree {
  const execs = agents.filter((a) => a.kind === "core");
  const functions = agents.filter((a) => a.kind === "function");
  const employees = agents.filter((a) => a.kind === "employee");
  const execNames = new Set(execs.map((e) => e.name));

  const byExec = new Map<string, OrgEmployee[]>();
  const orphans: OrgEmployee[] = [];
  for (const emp of employees) {
    const e = toEmployee(emp, work);
    if (e.reportsTo && execNames.has(e.reportsTo)) {
      const list = byExec.get(e.reportsTo) ?? [];
      list.push(e);
      byExec.set(e.reportsTo, list);
    } else {
      orphans.push(e);
    }
  }

  // The summon catalog: templates grouped by the executive they hang under (ADR-020 §D).
  const tplByOwner = new Map<string, OrgTemplate[]>();
  for (const t of templates) {
    if (!t.owner_agent) continue;
    const list = tplByOwner.get(t.owner_agent) ?? [];
    list.push(toTemplate(t));
    tplByOwner.set(t.owner_agent, list);
  }

  const orgExecs: OrgExec[] = execs.map((exec) => {
    const reports = (byExec.get(exec.name) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const catalog = (tplByOwner.get(exec.name) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const ownedTicketCount = work.filter((w) => w.owner === exec.name).length;
    const staffed = new Set<string>();
    for (const emp of reports) {
      for (const t of emp.tickets) staffed.add(t.id);
    }
    return {
      name: exec.name,
      kind: exec.kind,
      status: exec.status,
      description: exec.description,
      employees: reports,
      templates: catalog,
      ownedTicketCount,
      staffedTicketCount: staffed.size,
    };
  });

  orgExecs.sort((a, b) => b.employees.length - a.employees.length || a.name.localeCompare(b.name));

  const orgFunctions: OrgFunction[] = functions
    .map((fn) => ({
      name: fn.name,
      kind: fn.kind,
      status: fn.status,
      description: fn.description,
      tickets: ticketsFor(fn.name, work),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { owner: OWNER_SENTINEL, execs: orgExecs, functions: orgFunctions, orphans };
}

export type OrgData = {
  available: boolean;
  home: string;
  tree: OrgTree;
  templates: EmployeeTemplate[];
  employeeCount: number;
};

/** Live org data for the org view: reads the generated registries + work items. */
export async function readOrg(): Promise<OrgData> {
  const registry = await readRegistry();
  const work = registry.available ? await listWork() : [];
  const tree = buildOrg(registry.agents, registry.templates, work);
  const employeeCount = registry.agents.filter((a) => a.kind === "employee").length;
  return {
    available: registry.available,
    home: registry.home,
    tree,
    templates: registry.templates,
    employeeCount,
  };
}

/** Roster instantiated from a given template (for the template catalog). */
export function employeesOfTemplate(agents: RegistryAgent[], template: string): RegistryAgent[] {
  return agents.filter((a) => a.kind === "employee" && a.template === template);
}
