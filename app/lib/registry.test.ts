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
    expect(registry.templates).toEqual([]);
  });
});

describe("readRegistry — employees & templates (ADR-017)", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "scope-creep-org-"));
    mkdirSync(join(home, "registry"));
    writeFileSync(
      join(home, "registry", "agents.json"),
      JSON.stringify({
        agents: [
          { name: "cto", kind: "core", status: "active" },
          {
            name: "linus",
            kind: "employee",
            status: "active",
            reports_to: "cto",
            template: "backend-engineer",
          },
        ],
      }),
    );
    writeFileSync(
      join(home, "registry", "employee-templates.json"),
      JSON.stringify({
        templates: [
          {
            name: "backend-engineer",
            kind: "template",
            status: "active",
            default_model: "claude-sonnet-5",
            skills: ["typescript", "drizzle"],
          },
        ],
      }),
    );
    writeFileSync(join(home, "registry", "apps.json"), JSON.stringify({ apps: [] }));
    writeFileSync(join(home, "registry", "extensions.json"), JSON.stringify({ extensions: [] }));
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("parses employee fields and the template catalog", async () => {
    process.env.SCOPE_CREEP_HOME = home;
    const registry = await readRegistry();
    const linus = registry.agents.find((a) => a.name === "linus");
    expect(linus?.kind).toBe("employee");
    expect(linus?.reports_to).toBe("cto");
    expect(linus?.template).toBe("backend-engineer");
    expect(registry.templates.map((t) => t.name)).toEqual(["backend-engineer"]);
    expect(registry.templates[0].skills).toEqual(["typescript", "drizzle"]);
  });

  it("tolerates a control plane without employee-templates.json", async () => {
    rmSync(join(home, "registry", "employee-templates.json"));
    process.env.SCOPE_CREEP_HOME = home;
    const registry = await readRegistry();
    expect(registry.available).toBe(true);
    expect(registry.templates).toEqual([]);
  });
});
