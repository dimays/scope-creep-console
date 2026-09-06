import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_MODEL_SETTING,
  effectiveChatModel,
  readModelCatalog,
  resolveChatModel,
  selectModelForTask,
} from "./models.server";
import { setSetting } from "./settings.server";

// A hermetic control-plane home with a models.json fixture.
const FIXTURE = {
  defaults: {
    chat: "claude-sonnet-5",
    agentic: "claude-opus-4-8",
    routine: "claude-haiku-4-5-20251001",
  },
  models: [
    { id: "claude-opus-4-8", tier: "flagship", input: 5, output: 25, context: 1000000 },
    { id: "claude-sonnet-5", tier: "balanced", input: 2, output: 10, context: 1000000 },
    { id: "claude-haiku-4-5-20251001", tier: "fast", input: 1, output: 5, context: 200000 },
  ],
};

let home: string;
const priorHome = process.env.SCOPE_CREEP_HOME;
const priorChatModel = process.env.CHAT_MODEL;

function writeCatalog(dir: string, body: string) {
  mkdirSync(join(dir, "reference"), { recursive: true });
  writeFileSync(join(dir, "reference", "models.json"), body);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sc-models-"));
  writeCatalog(home, JSON.stringify(FIXTURE));
  process.env.SCOPE_CREEP_HOME = home;
  delete process.env.CHAT_MODEL;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (priorHome === undefined) delete process.env.SCOPE_CREEP_HOME;
  else process.env.SCOPE_CREEP_HOME = priorHome;
  if (priorChatModel === undefined) delete process.env.CHAT_MODEL;
  else process.env.CHAT_MODEL = priorChatModel;
});

describe("readModelCatalog", () => {
  it("reads the live catalog from SCOPE_CREEP_HOME", async () => {
    const cat = await readModelCatalog();
    expect(cat.available).toBe(true);
    expect(cat.models.map((m) => m.id)).toContain("claude-opus-4-8");
    expect(cat.defaults.chat).toBe("claude-sonnet-5");
  });

  it("falls back cleanly when the catalog is missing", async () => {
    process.env.SCOPE_CREEP_HOME = join(home, "does-not-exist");
    const cat = await readModelCatalog();
    expect(cat.available).toBe(false);
    expect(cat.models.length).toBeGreaterThan(0); // the committed fallback
  });

  it("falls back when the catalog has no models array", async () => {
    writeCatalog(home, JSON.stringify({ defaults: {} }));
    const cat = await readModelCatalog();
    expect(cat.models.length).toBeGreaterThan(0);
  });
});

describe("resolveChatModel", () => {
  it("uses the catalog default with no persisted pick and no env", async () => {
    const r = await resolveChatModel();
    expect(r.id).toBe("claude-sonnet-5");
    expect(r.source).toBe("catalog-default");
  });

  it("honors a valid persisted pick over the default", async () => {
    await setSetting(CHAT_MODEL_SETTING, "claude-opus-4-8");
    const r = await resolveChatModel();
    expect(r.id).toBe("claude-opus-4-8");
    expect(r.source).toBe("persisted");
  });

  it("ignores a retired persisted id and falls through to the env default", async () => {
    await setSetting(CHAT_MODEL_SETTING, "claude-retired-9");
    process.env.CHAT_MODEL = "claude-sonnet-5";
    const r = await resolveChatModel();
    expect(r.id).toBe("claude-sonnet-5");
    expect(r.source).toBe("env");
  });

  it("effectiveChatModel returns just the id", async () => {
    expect(await effectiveChatModel()).toBe("claude-sonnet-5");
  });
});

describe("selectModelForTask (agent policy)", () => {
  it("resolves each task tier to a valid catalog id", async () => {
    expect(await selectModelForTask("routine")).toBe("claude-haiku-4-5-20251001");
    expect(await selectModelForTask("chat")).toBe("claude-sonnet-5");
    expect(await selectModelForTask("agentic")).toBe("claude-opus-4-8");
  });
});
