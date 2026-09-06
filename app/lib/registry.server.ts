import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reads the Scope Creep control plane's generated registries so the Console can
 * show the factory: the agent org and the registered apps/extensions. The
 * control-plane repo is located via SCOPE_CREEP_HOME (default: a sibling
 * `../scope-creep`). Missing/unreadable → a graceful "unavailable" result.
 */

export type RegistryAgent = {
  name: string;
  kind?: string; // "core" | "employee" (functional agents are also "core")
  status?: string;
  description?: string;
  path?: string;
  // Employee-only (ADR-017): the exec that spun it up + the template it came from.
  reports_to?: string;
  template?: string;
};

export type EmployeeTemplate = {
  name: string;
  kind?: string; // "template"
  status?: string;
  description?: string;
  default_model?: string;
  skills?: string[];
  path?: string;
};

export type RegistryApp = {
  name?: string;
  status?: string;
  repo?: string;
};

export type RegistryExtension = {
  name?: string;
  kind?: string;
  status?: string;
  repo?: string;
};

export type Registry = {
  home: string;
  available: boolean;
  agents: RegistryAgent[];
  templates: EmployeeTemplate[];
  apps: RegistryApp[];
  extensions: RegistryExtension[];
};

function controlPlaneHome(): string {
  return process.env.SCOPE_CREEP_HOME ?? join(process.cwd(), "..", "scope-creep");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function readRegistry(): Promise<Registry> {
  const home = controlPlaneHome();
  try {
    const [agents, templates, apps, extensions] = await Promise.all([
      readJson<{ agents?: RegistryAgent[] }>(join(home, "registry", "agents.json")),
      // employee-templates.json is newer than the other registries; tolerate its absence
      // (older control planes) so the Console degrades to "no templates" rather than
      // reporting the whole control plane unavailable.
      readJson<{ templates?: EmployeeTemplate[] }>(
        join(home, "registry", "employee-templates.json"),
      ).catch(() => ({ templates: [] as EmployeeTemplate[] })),
      readJson<{ apps?: RegistryApp[] }>(join(home, "registry", "apps.json")),
      readJson<{ extensions?: RegistryExtension[] }>(join(home, "registry", "extensions.json")),
    ]);
    return {
      home,
      available: true,
      agents: agents.agents ?? [],
      templates: templates.templates ?? [],
      apps: apps.apps ?? [],
      extensions: extensions.extensions ?? [],
    };
  } catch {
    return { home, available: false, agents: [], templates: [], apps: [], extensions: [] };
  }
}
