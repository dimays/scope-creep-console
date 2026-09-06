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
  status?: string;
  template?: string;
  reportsTo?: string;
  tickets: TicketRef[];
};

export type OrgExec = {
  name: string;
  kind?: string;
  status?: string;
  description?: string;
  employees: OrgEmployee[];
  ownedTicketCount: number;
  /** Distinct tickets staffed to any of this exec's employees. */
  staffedTicketCount: number;
};

export type OrgTree = {
  owner: string;
  execs: OrgExec[];
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
    tickets: ticketsFor(agent.name, work),
  };
}

/**
 * Build the Owner → C-suite → employees tree, with per-exec ticket counts. Pure:
 * takes the registry agents and work items, returns the shape the org view renders.
 * Execs are ordered by headcount (most reports first), then name, so a populated org
 * reads top-down.
 */
export function buildOrg(agents: RegistryAgent[], work: WorkItem[]): OrgTree {
  const execs = agents.filter((a) => a.kind !== "employee");
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

  const orgExecs: OrgExec[] = execs.map((exec) => {
    const reports = (byExec.get(exec.name) ?? []).sort((a, b) => a.name.localeCompare(b.name));
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
      ownedTicketCount,
      staffedTicketCount: staffed.size,
    };
  });

  orgExecs.sort((a, b) => b.employees.length - a.employees.length || a.name.localeCompare(b.name));

  return { owner: OWNER_SENTINEL, execs: orgExecs, orphans };
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
  const tree = buildOrg(registry.agents, work);
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
