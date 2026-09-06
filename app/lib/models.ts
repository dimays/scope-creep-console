/**
 * Model selection (work-018) — client-safe core: types, a hardcoded fallback
 * catalog, and the pure resolution/validation logic. No `node:` or db imports, so
 * both the Settings UI (browser) and the server helpers (`models.server.ts`) share it.
 *
 * The live catalog is the Owner-curated `reference/models.json` in the control plane
 * (read via SCOPE_CREEP_HOME in `models.server.ts`). This fallback is the floor: if the
 * control plane is unreachable the Console still has a sane default and a valid picker.
 */

export type ModelTier = "flagship" | "balanced" | "fast" | string;

export type CatalogModel = {
  id: string;
  tier: ModelTier;
  input?: number;
  output?: number;
  context?: number;
  note?: string;
};

/** The three model-selection axes agents (and the chat) pick along. */
export type ModelTask = "chat" | "agentic" | "routine";

export type ModelDefaults = Record<ModelTask, string>;

export type ModelCatalog = {
  defaults: ModelDefaults;
  models: CatalogModel[];
};

/**
 * The last-resort chat model when neither a persisted pick, `CHAT_MODEL`, nor the
 * catalog yields a valid id. Must be an id that also appears in FALLBACK_CATALOG.
 */
export const HARDCODED_CHAT_MODEL = "claude-sonnet-5";

/**
 * A committed mirror of `reference/models.json` (Owner-curated 2026-09-05). Used only
 * when the control plane's catalog can't be read; the live file is authoritative.
 */
export const FALLBACK_CATALOG: ModelCatalog = {
  defaults: {
    chat: "claude-sonnet-5",
    agentic: "claude-opus-4-8",
    routine: "claude-haiku-4-5-20251001",
  },
  models: [
    { id: "claude-opus-4-8", tier: "flagship", input: 5.0, output: 25.0, context: 1_000_000 },
    { id: "claude-sonnet-5", tier: "balanced", input: 2.0, output: 10.0, context: 1_000_000 },
    {
      id: "claude-haiku-4-5-20251001",
      tier: "fast",
      input: 1.0,
      output: 5.0,
      context: 200_000,
    },
  ],
};

/** True iff `id` is a non-empty string present in the catalog's model list. */
export function isValidModelId(id: string | null | undefined, catalog: ModelCatalog): boolean {
  if (!id) return false;
  return catalog.models.some((m) => m.id === id);
}

export type ChatModelResolution = {
  id: string;
  /** Where the effective id came from — for surfacing to the Owner + debugging. */
  source: "persisted" | "env" | "catalog-default" | "hardcoded";
};

/**
 * Resolve the effective chat model from the candidates, in priority order, keeping only
 * ids that validate against the catalog. Never throws; always returns a valid-shaped id
 * (the hardcoded floor is used even if it isn't in a degenerate/empty catalog). A retired
 * id in any slot is skipped rather than honored — "retired IDs fail hard" for the caller
 * means we fall through to the next candidate, never send an unknown id to the API.
 */
export function resolveChatModelId(opts: {
  persisted?: string | null;
  env?: string | null;
  catalog: ModelCatalog;
}): ChatModelResolution {
  const { persisted, env, catalog } = opts;
  if (isValidModelId(persisted, catalog)) return { id: persisted as string, source: "persisted" };
  if (isValidModelId(env, catalog)) return { id: env as string, source: "env" };
  const def = catalog.defaults?.chat;
  if (isValidModelId(def, catalog)) return { id: def, source: "catalog-default" };
  return { id: HARDCODED_CHAT_MODEL, source: "hardcoded" };
}

/**
 * The agent model-selection policy (work-018), as executable code: pick the catalog's
 * default for the task tier, validated. Agents/subagents call this per task —
 * `routine` for cheap high-volume turns, `chat` for interactive turns, `agentic` for
 * hard reasoning / coding / tool-use work. Falls back to the chat default, then the
 * hardcoded floor, so a caller always gets a valid id.
 */
export function selectTaskModelId(task: ModelTask, catalog: ModelCatalog): string {
  const preferred = catalog.defaults?.[task];
  if (isValidModelId(preferred, catalog)) return preferred;
  const chatDefault = catalog.defaults?.chat;
  if (isValidModelId(chatDefault, catalog)) return chatDefault;
  return HARDCODED_CHAT_MODEL;
}

export type ModelPreset = {
  /** The raw catalog id, e.g. "claude-sonnet-5". */
  id: string;
  /** A short human label, e.g. "Sonnet" / "Haiku" / "Opus". */
  short: string;
  /** The catalog tier, e.g. "balanced" / "fast" / "flagship", or "custom" if unknown. */
  tier: string;
};

/**
 * Turn a template's `default_model` id into a compact preset badge for the org view —
 * the model each kind of employee runs (ADR-020 §D / staffing §4). Pure + client-safe:
 * the `short` name is derived from the id (so a new Claude id still labels sensibly) and
 * the `tier` is resolved from the catalog (FALLBACK by default). Returns null for a
 * missing id so callers can render "no preset".
 */
export function modelPreset(
  id: string | null | undefined,
  catalog: ModelCatalog = FALLBACK_CATALOG,
): ModelPreset | null {
  if (!id) return null;
  const short = /opus/i.test(id)
    ? "Opus"
    : /sonnet/i.test(id)
      ? "Sonnet"
      : /haiku/i.test(id)
        ? "Haiku"
        : id;
  const tier = catalog.models.find((m) => m.id === id)?.tier ?? "custom";
  return { id, short, tier };
}
