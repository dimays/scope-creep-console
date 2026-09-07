import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loader as loopLoader } from "../routes/explore-loop";
import { loader as loopsLoader } from "../routes/explore-loops";
import {
  buildLinkIndex,
  consistency,
  extractWikilinks,
  listLedger,
  listLoops,
  loopsOwnedBy,
  parseFrontmatter,
  parseLoops,
  readAgent,
  readLoop,
  versionSkew,
} from "./explore.server";

describe("parseFrontmatter", () => {
  it("reads top-level and metadata fields", () => {
    const src = [
      "---",
      "name: invariants",
      "description: The locked rules.",
      "metadata:",
      "  type: reference",
      "  status: active",
      "  last_verified: 2026-09-04",
      "---",
      "",
      "# Body",
      "hello",
    ].join("\n");
    const { fm, body } = parseFrontmatter(src);
    expect(fm.name).toBe("invariants");
    expect(fm.description).toBe("The locked rules.");
    expect(fm.type).toBe("reference");
    expect(fm.status).toBe("active");
    expect(fm.lastVerified).toBe("2026-09-04");
    expect(body).toContain("# Body");
  });

  it("returns the whole string as body when there is no frontmatter", () => {
    const { fm, body } = parseFrontmatter("# Just markdown");
    expect(fm.name).toBeUndefined();
    expect(body).toBe("# Just markdown");
  });
});

describe("extractWikilinks", () => {
  it("collects targets and strips aliases", () => {
    const links = extractWikilinks("See [[invariants]] and [[prd-console-explore|the PRD]].");
    expect(links).toEqual(["invariants", "prd-console-explore"]);
  });

  it("returns nothing when there are no links", () => {
    expect(extractWikilinks("no links here")).toEqual([]);
  });

  it("ignores wikilink syntax inside code spans", () => {
    expect(extractWikilinks("Cross-link with `[[name]]`. Real: [[invariants]].")).toEqual([
      "invariants",
    ]);
  });
});

describe("versionSkew", () => {
  it("returns [] when all present versions agree", () => {
    expect(versionSkew({ app: "0.15.0", pkg: "0.15.0", changelog: "0.15.0" })).toEqual([]);
  });

  it("reports every source when they disagree", () => {
    const skew = versionSkew({ app: "0.13.0", pkg: "0.15.0", changelog: "0.15.0" });
    expect(skew).toEqual([
      { source: "version.ts", version: "0.13.0" },
      { source: "package.json", version: "0.15.0" },
      { source: "CHANGELOG.md", version: "0.15.0" },
    ]);
  });

  it("ignores a source that couldn't be read (null)", () => {
    expect(versionSkew({ app: "0.15.0", pkg: null, changelog: "0.15.0" })).toEqual([]);
  });
});

describe("parseLoops", () => {
  it("maps registry entries and camel-cases owner_agent; mode is optional", () => {
    const json = JSON.stringify({
      loops: [
        {
          name: "decision",
          kind: "loop",
          status: "active",
          description: "the decision loop",
          owner_agent: "chief-of-staff",
          path: "loops/decision.md",
          mode: "partially-autonomous",
        },
        { name: "heal", kind: "loop", status: "active", owner_agent: "cto", path: "loops/heal.md" },
      ],
    });
    const loops = parseLoops(json);
    expect(loops).toHaveLength(2);
    expect(loops[0]).toEqual({
      name: "decision",
      kind: "loop",
      status: "active",
      description: "the decision loop",
      ownerAgent: "chief-of-staff",
      path: "loops/decision.md",
      mode: "partially-autonomous",
    });
    // mode absent on the second entry stays undefined, not a crash.
    expect(loops[1].mode).toBeUndefined();
    expect(loops[1].ownerAgent).toBe("cto");
  });

  it("defaults kind to 'loop' and drops entries without a name", () => {
    const loops = parseLoops(JSON.stringify({ loops: [{ status: "active" }, { name: "x" }] }));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ name: "x", kind: "loop" });
  });

  it("is empty-honest: malformed JSON, missing array, or empty array all yield []", () => {
    expect(parseLoops("not json")).toEqual([]);
    expect(parseLoops(JSON.stringify({}))).toEqual([]);
    expect(parseLoops(JSON.stringify({ loops: [] }))).toEqual([]);
  });
});

describe("loopsOwnedBy (cross-link resolution)", () => {
  const loops = parseLoops(
    JSON.stringify({
      loops: [
        { name: "decision", owner_agent: "chief-of-staff" },
        { name: "level-set", owner_agent: "chief-of-staff" },
        { name: "heal", owner_agent: "cto" },
      ],
    }),
  );

  it("returns only the loops an agent owns", () => {
    expect(loopsOwnedBy(loops, "chief-of-staff").map((l) => l.name)).toEqual([
      "decision",
      "level-set",
    ]);
    expect(loopsOwnedBy(loops, "cto").map((l) => l.name)).toEqual(["heal"]);
  });

  it("returns [] for an agent that owns nothing", () => {
    expect(loopsOwnedBy(loops, "chief-designer")).toEqual([]);
  });
});

// Hermetic control-plane: exercises the loops loaders + the agent↔loop↔doc
// cross-link resolution end to end against a throwaway SCOPE_CREEP_HOME.
describe("loops loaders + cross-link graph", () => {
  let home: string;
  let prev: string | undefined;

  beforeAll(() => {
    prev = process.env.SCOPE_CREEP_HOME;
    home = mkdtempSync(join(tmpdir(), "scope-creep-loops-"));
    mkdirSync(join(home, "registry"));
    mkdirSync(join(home, "loops"));
    mkdirSync(join(home, "agents"));
    mkdirSync(join(home, "ledger"));
    writeFileSync(
      join(home, "registry", "loops.json"),
      JSON.stringify({
        loops: [
          {
            name: "decision",
            kind: "loop",
            status: "active",
            description: "the decision loop",
            owner_agent: "chief-of-staff",
            path: "loops/decision.md",
            mode: "partially-autonomous",
          },
        ],
      }),
    );
    // The loop's doc lives in the graph under its own name, so the profile can
    // deep-link the definition.
    writeFileSync(
      join(home, "loops", "decision.md"),
      "---\nname: decision\ndescription: the decision loop\n---\n\n# Decision\n",
    );
    writeFileSync(
      join(home, "agents", "chief-of-staff.md"),
      "---\nname: chief-of-staff\ndescription: orchestrator\nmetadata:\n  status: active\n---\n\n# CoS\n",
    );
    process.env.SCOPE_CREEP_HOME = home;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SCOPE_CREEP_HOME;
    else process.env.SCOPE_CREEP_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it("listLoops / readLoop read the registry", async () => {
    const loops = await listLoops();
    expect(loops.map((l) => l.name)).toEqual(["decision"]);
    const loop = await readLoop("decision");
    expect(loop?.ownerAgent).toBe("chief-of-staff");
    expect(await readLoop("nope")).toBeNull();
  });

  it("the loops index loader resolves owner display names", async () => {
    const data = await loopsLoader({} as never);
    expect(data.loops).toHaveLength(1);
    expect(data.loops[0].ownerDisplay).toBe("Chief of Staff");
  });

  it("the loop profile loader resolves the owner + the definition doc", async () => {
    const data = await loopLoader({ params: { name: "decision" } } as never);
    expect(data.loop.name).toBe("decision");
    expect(data.ownerDisplay).toBe("Chief of Staff");
    expect(data.docSlug).toBe("decision"); // loop ↔ doc cross-link
  });

  it("the loop profile loader 404s for an unknown loop", async () => {
    await expect(loopLoader({ params: { name: "ghost" } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("an agent profile rolls up the loops it owns (agent ↔ loop)", async () => {
    const agent = await readAgent("chief-of-staff");
    expect(agent?.loopsOwned.map((l) => l.name)).toEqual(["decision"]);
  });

  it("empty is empty: absent loops.json yields no loops", async () => {
    const saved = process.env.SCOPE_CREEP_HOME;
    process.env.SCOPE_CREEP_HOME = join(home, "does-not-exist");
    expect(await listLoops()).toEqual([]);
    process.env.SCOPE_CREEP_HOME = saved;
  });
});

// The honest consistency check (issue: hundreds of false "dangling" links): a wikilink
// resolves against the WHOLE namespace, and repeats within a doc collapse to one issue.
describe("consistency: honest dangling-link resolution", () => {
  let home: string;
  let prev: string | undefined;

  beforeAll(() => {
    prev = process.env.SCOPE_CREEP_HOME;
    home = mkdtempSync(join(tmpdir(), "scope-creep-consistency-"));
    mkdirSync(join(home, "charter"));
    mkdirSync(join(home, "work"));
    mkdirSync(join(home, "registry"));
    mkdirSync(join(home, "loops"));
    mkdirSync(join(home, "ledger"));

    // A doc whose body cites a work item (twice), a template, a loop, and one target
    // nothing owns. Only the last is genuine drift; the repeat must not double-count.
    writeFileSync(
      join(home, "charter", "sample.md"),
      [
        "---",
        "name: sample",
        "description: sample doc",
        "---",
        "",
        "# Sample",
        "Cross-links: [[work-101]], [[work-101]] again, [[backend-engineer]],",
        "[[core-upgrade]], and [[ghost-target]] which points at nothing.",
      ].join("\n"),
    );
    writeFileSync(
      join(home, "work", "101-thing.md"),
      "---\nid: work-101\ntitle: A thing\nstatus: done\n---\nbody\n",
    );
    writeFileSync(
      join(home, "registry", "agents.json"),
      JSON.stringify({ agents: [{ name: "ada" }] }),
    );
    writeFileSync(join(home, "registry", "apps.json"), JSON.stringify({ apps: [] }));
    writeFileSync(join(home, "registry", "extensions.json"), JSON.stringify({ extensions: [] }));
    writeFileSync(
      join(home, "registry", "employee-templates.json"),
      JSON.stringify({ templates: [{ name: "backend-engineer" }] }),
    );
    writeFileSync(
      join(home, "registry", "loops.json"),
      JSON.stringify({ loops: [{ name: "core-upgrade", kind: "loop" }] }),
    );
    // Two ledger entries: one with a frontmatter name, one without (docSlug fallback).
    writeFileSync(
      join(home, "ledger", "000-genesis.md"),
      "---\nname: ledger-000-genesis\n---\n\n# Genesis\n",
    );
    writeFileSync(join(home, "ledger", "001-nameless.md"), "# Nameless entry\n");
    process.env.SCOPE_CREEP_HOME = home;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SCOPE_CREEP_HOME;
    else process.env.SCOPE_CREEP_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it("buildLinkIndex spans docs, work, agents, templates, and loops", async () => {
    const index = await buildLinkIndex();
    expect(index.docs.has("sample")).toBe(true);
    expect(index.work.has("work-101")).toBe(true);
    expect(index.agents.has("ada")).toBe(true);
    expect(index.templates.has("backend-engineer")).toBe(true);
    expect(index.loops.has("core-upgrade")).toBe(true);
  });

  it("flags only the genuinely-unresolvable target, de-duped per doc", async () => {
    const report = await consistency();
    const fromSample = report.danglingLinks.filter((l) => l.from === "sample");
    // work/template/loop links resolve; the repeated work link counts once; only the
    // ghost remains — one item, not five.
    expect(fromSample).toEqual([{ from: "sample", target: "ghost-target" }]);
  });

  it("listLedger computes a docSlug that matches the doc viewer's slug", async () => {
    const entries = await listLedger();
    const named = entries.find((e) => e.file === "000-genesis.md");
    const nameless = entries.find((e) => e.file === "001-nameless.md");
    // With a frontmatter name, docSlug is that name; without, it mirrors listDocs'
    // path-based slug so /explore/docs/:slug still resolves.
    expect(named?.docSlug).toBe("ledger-000-genesis");
    expect(nameless?.docSlug).toBe("ledger-001-nameless-md");
  });
});
