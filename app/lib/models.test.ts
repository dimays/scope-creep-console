import { describe, expect, it } from "vitest";
import {
  FALLBACK_CATALOG,
  HARDCODED_CHAT_MODEL,
  isValidModelId,
  type ModelCatalog,
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
