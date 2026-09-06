import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CatalogModel,
  type ChatModelResolution,
  FALLBACK_CATALOG,
  type ModelCatalog,
  type ModelDefaults,
  type ModelTask,
  resolveChatModelId,
  selectTaskModelId,
} from "./models";
import { getSetting } from "./settings.server";

/**
 * Model selection (work-018) — server side. Reads the Owner-curated catalog
 * `reference/models.json` from the control plane (via SCOPE_CREEP_HOME, the same
 * resolution the registry uses) and resolves the effective chat model from the
 * persisted pick + `CHAT_MODEL` env + catalog defaults. Missing/unreadable/malformed
 * catalog → the committed FALLBACK_CATALOG, so the picker and defaults always work.
 */

/** The DB settings key that holds the Owner's persisted chat-model pick. */
export const CHAT_MODEL_SETTING = "chat_model";

function controlPlaneHome(): string {
  return process.env.SCOPE_CREEP_HOME ?? join(process.cwd(), "..", "scope-creep");
}

type RawCatalog = {
  defaults?: Partial<ModelDefaults>;
  models?: CatalogModel[];
};

/** Coerce a parsed models.json into a well-shaped catalog, filling gaps from the fallback. */
function normalizeCatalog(raw: RawCatalog): ModelCatalog {
  const models = Array.isArray(raw.models)
    ? raw.models.filter((m): m is CatalogModel => typeof m?.id === "string" && m.id.length > 0)
    : [];
  if (models.length === 0) return FALLBACK_CATALOG;
  return {
    defaults: {
      chat: raw.defaults?.chat ?? FALLBACK_CATALOG.defaults.chat,
      agentic: raw.defaults?.agentic ?? FALLBACK_CATALOG.defaults.agentic,
      routine: raw.defaults?.routine ?? FALLBACK_CATALOG.defaults.routine,
    },
    models,
  };
}

export type CatalogResult = ModelCatalog & {
  /** True when the live control-plane catalog was read; false when the fallback is in use. */
  available: boolean;
  /** Absolute path we tried to read (for surfacing a "not found" hint). */
  source: string;
};

/** Read and normalize the live model catalog; fall back cleanly if it can't be read. */
export async function readModelCatalog(): Promise<CatalogResult> {
  const path = join(controlPlaneHome(), "reference", "models.json");
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as RawCatalog;
    const catalog = normalizeCatalog(raw);
    return { ...catalog, available: true, source: path };
  } catch {
    return { ...FALLBACK_CATALOG, available: false, source: path };
  }
}

/**
 * The effective chat model: persisted Owner pick → `CHAT_MODEL` env → catalog default →
 * hardcoded floor, keeping only ids that validate against the catalog. Returns the
 * resolution (id + source) plus the catalog it was resolved against.
 */
export async function resolveChatModel(): Promise<
  ChatModelResolution & { catalog: CatalogResult }
> {
  const catalog = await readModelCatalog();
  const persisted = await getSetting(CHAT_MODEL_SETTING);
  const resolution = resolveChatModelId({
    persisted,
    env: process.env.CHAT_MODEL,
    catalog,
  });
  return { ...resolution, catalog };
}

/** Just the effective chat-model id — the hot path for the agent runtime. */
export async function effectiveChatModel(): Promise<string> {
  return (await resolveChatModel()).id;
}

/**
 * The agent model-selection policy (work-018): resolve a validated model id for a task
 * tier from the live catalog's defaults. Agents/subagents call this per task instead of
 * hardcoding an id. Always returns a valid id (falls through to the catalog chat default,
 * then the hardcoded floor).
 */
export async function selectModelForTask(task: ModelTask): Promise<string> {
  const catalog = await readModelCatalog();
  return selectTaskModelId(task, catalog);
}
