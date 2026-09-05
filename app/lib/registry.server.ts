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
  kind?: string;
  status?: string;
  path?: string;
};

export type RegistryApp = {
  name?: string;
  status?: string;
  repo?: string;
};

export type Registry = {
  home: string;
  available: boolean;
  agents: RegistryAgent[];
  apps: RegistryApp[];
  extensions: unknown[];
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
    const [agents, apps, extensions] = await Promise.all([
      readJson<{ agents?: RegistryAgent[] }>(join(home, "registry", "agents.json")),
      readJson<{ apps?: RegistryApp[] }>(join(home, "registry", "apps.json")),
      readJson<{ extensions?: unknown[] }>(join(home, "registry", "extensions.json")),
    ]);
    return {
      home,
      available: true,
      agents: agents.agents ?? [],
      apps: apps.apps ?? [],
      extensions: extensions.extensions ?? [],
    };
  } catch {
    return { home, available: false, agents: [], apps: [], extensions: [] };
  }
}
