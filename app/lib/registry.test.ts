import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRegistry } from "./registry.server";

describe("readRegistry", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "scope-creep-"));
    mkdirSync(join(home, "registry"));
    writeFileSync(
      join(home, "registry", "agents.json"),
      JSON.stringify({ agents: [{ name: "cto", kind: "core", status: "active" }] }),
    );
    writeFileSync(join(home, "registry", "apps.json"), JSON.stringify({ apps: [] }));
    writeFileSync(join(home, "registry", "extensions.json"), JSON.stringify({ extensions: [] }));
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("reads a present control-plane registry", async () => {
    process.env.SCOPE_CREEP_HOME = home;
    const registry = await readRegistry();
    expect(registry.available).toBe(true);
    expect(registry.agents.map((a) => a.name)).toContain("cto");
  });

  it("degrades gracefully when the control plane is missing", async () => {
    process.env.SCOPE_CREEP_HOME = join(home, "does-not-exist");
    const registry = await readRegistry();
    expect(registry.available).toBe(false);
    expect(registry.agents).toEqual([]);
    expect(registry.apps).toEqual([]);
  });
});
