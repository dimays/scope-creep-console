import { describe, expect, it } from "vitest";
import {
  FALLBACK_CATALOG,
  HARDCODED_CHAT_MODEL,
  isValidModelId,
  type ModelCatalog,
  modelPreset,
  resolveChatModelId,
  selectTaskModelId,
} from "./models";

const CATALOG: ModelCatalog = {
  defaults: { chat: "claude-sonnet-5", agentic: "claude-opus-4-8", routine: "claude-haiku-4-5" },
  models: [
    { id: "claude-opus-4-8", tier: "flagship" },
    { id: "claude-sonnet-5", tier: "balanced" },
    { id: "claude-haiku-4-5", tier: "fast" },
  ],
};

describe("isValidModelId", () => {
  it("accepts ids in the catalog and rejects everything else", () => {
    expect(isValidModelId("claude-sonnet-5", CATALOG)).toBe(true);
    expect(isValidModelId("claude-retired-1", CATALOG)).toBe(false);
    expect(isValidModelId("", CATALOG)).toBe(false);
    expect(isValidModelId(null, CATALOG)).toBe(false);
    expect(isValidModelId(undefined, CATALOG)).toBe(false);
  });
});

describe("resolveChatModelId", () => {
  it("prefers a valid persisted pick", () => {
    const r = resolveChatModelId({
      persisted: "claude-opus-4-8",
      env: "claude-sonnet-5",
      catalog: CATALOG,
    });
    expect(r).toEqual({ id: "claude-opus-4-8", source: "persisted" });
  });

  it("falls through a retired persisted id to the env default", () => {
    const r = resolveChatModelId({
      persisted: "claude-retired-1",
      env: "claude-sonnet-5",
      catalog: CATALOG,
    });
    expect(r).toEqual({ id: "claude-sonnet-5", source: "env" });
  });

  it("falls through to the catalog default when persisted+env are invalid", () => {
    const r = resolveChatModelId({ persisted: "", env: "nope", catalog: CATALOG });
    expect(r).toEqual({ id: "claude-sonnet-5", source: "catalog-default" });
  });

  it("falls back to the hardcoded floor when the catalog is degenerate", () => {
    const empty: ModelCatalog = { defaults: { chat: "x", agentic: "y", routine: "z" }, models: [] };
    const r = resolveChatModelId({ persisted: null, env: null, catalog: empty });
    expect(r).toEqual({ id: HARDCODED_CHAT_MODEL, source: "hardcoded" });
  });
});

describe("selectTaskModelId (agent policy)", () => {
  it("maps each task tier to the catalog default", () => {
    expect(selectTaskModelId("routine", CATALOG)).toBe("claude-haiku-4-5");
    expect(selectTaskModelId("chat", CATALOG)).toBe("claude-sonnet-5");
    expect(selectTaskModelId("agentic", CATALOG)).toBe("claude-opus-4-8");
  });

  it("falls back to the chat default when a task default is retired", () => {
    const c: ModelCatalog = {
      defaults: { chat: "claude-sonnet-5", agentic: "retired", routine: "retired" },
      models: [{ id: "claude-sonnet-5", tier: "balanced" }],
    };
    expect(selectTaskModelId("agentic", c)).toBe("claude-sonnet-5");
  });
});

describe("FALLBACK_CATALOG", () => {
  it("is internally consistent — its chat default is a real model", () => {
    expect(isValidModelId(FALLBACK_CATALOG.defaults.chat, FALLBACK_CATALOG)).toBe(true);
    expect(isValidModelId(HARDCODED_CHAT_MODEL, FALLBACK_CATALOG)).toBe(true);
  });
});

describe("modelPreset", () => {
  it("returns null for a missing id", () => {
    expect(modelPreset(undefined)).toBeNull();
    expect(modelPreset(null)).toBeNull();
    expect(modelPreset("")).toBeNull();
  });

  it("labels the known catalog ids with a short name and tier", () => {
    expect(modelPreset("claude-sonnet-5")).toEqual({
      id: "claude-sonnet-5",
      short: "Sonnet",
      tier: "balanced",
    });
    expect(modelPreset("claude-haiku-4-5-20251001")).toEqual({
      id: "claude-haiku-4-5-20251001",
      short: "Haiku",
      tier: "fast",
    });
    expect(modelPreset("claude-opus-4-8")).toEqual({
      id: "claude-opus-4-8",
      short: "Opus",
      tier: "flagship",
    });
  });

  it("derives a short name even for an id not in the catalog, marking the tier custom", () => {
    expect(modelPreset("claude-sonnet-9-future")).toEqual({
      id: "claude-sonnet-9-future",
      short: "Sonnet",
      tier: "custom",
    });
    // A wholly unknown id falls back to the raw id as its short label.
    expect(modelPreset("some-other-model")).toEqual({
      id: "some-other-model",
      short: "some-other-model",
      tier: "custom",
    });
  });
});
