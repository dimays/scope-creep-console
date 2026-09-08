import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loader as loopLoader } from "../routes/explore-loop";
import { loader as loopsLoader } from "../routes/explore-loops";
import {
  activityForActor,
  activityForThread,
  activityHref,
  activityVerb,
  buildLinkIndex,
  cadenceHistoryFor,
  consistency,
  describeCron,
  extractReferences,
  extractWikilinks,
  listActivity,
  listDocs,
  listLedger,
  listLoops,
  listReleases,
  listRoadmap,
  loopsOwnedBy,
  parseActivityLine,
  parseCadenceDecisions,
  parseFrontmatter,
  parseLoops,
  readAgent,
  readLoop,
  readRoutines,
  releasePackage,
  releaseTier,
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

describe("releaseTier (semver → major/minor/patch)", () => {
  it("classifies X.0.0 as major", () => {
    expect(releaseTier("v1.0.0")).toBe("major");
    expect(releaseTier("2.0.0")).toBe("major");
  });
  it("classifies X.Y.0 as minor", () => {
    expect(releaseTier("v0.1.0")).toBe("minor");
    expect(releaseTier("v0.2.0")).toBe("minor");
  });
  it("classifies X.Y.Z (Z>0) as patch", () => {
    expect(releaseTier("v0.2.1")).toBe("patch");
  });
  it("returns undefined for a missing/unparseable version", () => {
    expect(releaseTier(undefined)).toBeUndefined();
    expect(releaseTier("dev")).toBeUndefined();
  });
});

describe("releasePackage (scope → package group)", () => {
  it("maps the control-plane / core scope to Scope Creep core", () => {
    expect(releasePackage("control-plane (scope-creep)")).toEqual({
      key: "scope-creep",
      label: "Scope Creep core",
    });
  });
  it("prefers an explicit package slug in parentheses", () => {
    expect(releasePackage("companion polish in (scope-creep-console)").key).toBe("console");
  });
  it("recognizes console, design, and extensions", () => {
    expect(releasePackage("the Console app").label).toBe("Console");
    expect(releasePackage("the design system").label).toBe("Design system");
    expect(releasePackage("scope-creep-ext-feedback").label).toBe("Extensions");
  });
  it("falls back to the leading clause of unknown scope text", () => {
    expect(releasePackage("Widgets — some area").label).toBe("Widgets");
  });
  it("returns an Other bucket for empty scope", () => {
    expect(releasePackage(undefined).key).toBe("other");
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

// Eval Phase-1 (work-007 / adr-015): the agent profile's contribution history is
// attribution-grounded — authored (owner_agent) is kept apart from mere mention, and
// ADRs led come from the manifest, never inferred.
describe("readAgent eval history (adr-015 attribution)", () => {
  let home: string;
  let prev: string | undefined;

  beforeAll(() => {
    prev = process.env.SCOPE_CREEP_HOME;
    home = mkdtempSync(join(tmpdir(), "scope-creep-eval-"));
    mkdirSync(join(home, "agents"));
    mkdirSync(join(home, "standards", "adr"), { recursive: true });
    mkdirSync(join(home, "ledger"));
    writeFileSync(
      join(home, "agents", "chief-of-staff.md"),
      "---\nname: chief-of-staff\ndescription: orchestrator\nmetadata:\n  status: active\n---\n\n# Chief of Staff\n",
    );
    writeFileSync(
      join(home, "agents", "cto.md"),
      "---\nname: cto\ndescription: architecture\nmetadata:\n  status: active\n---\n\n# CTO\n",
    );
    // Two ADRs: one led by the CoS, one by the CTO — only the CoS's is "led by" here.
    writeFileSync(
      join(home, "standards", "adr", "010-a.md"),
      "---\nname: adr-010\nmetadata:\n  owner_agent: chief-of-staff\n---\n\n# ADR-010\n",
    );
    writeFileSync(
      join(home, "standards", "adr", "011-b.md"),
      "---\nname: adr-011\nmetadata:\n  owner_agent: cto\n---\n\n# ADR-011\n",
    );
    // One ledger entry authored by the CoS; one authored by the CTO that merely mentions
    // "chief-of-staff" in prose — a mention is not authorship.
    writeFileSync(
      join(home, "ledger", "001-authored.md"),
      "---\nname: ledger-001-authored\nmetadata:\n  owner_agent: chief-of-staff\n---\n\n# Authored by CoS\n",
    );
    writeFileSync(
      join(home, "ledger", "002-mentions.md"),
      "---\nname: ledger-002-mentions\nmetadata:\n  owner_agent: cto\n---\n\n# CTO entry\nHanded to chief-of-staff for ratification.\n",
    );
    process.env.SCOPE_CREEP_HOME = home;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SCOPE_CREEP_HOME;
    else process.env.SCOPE_CREEP_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it("separates authored from mentioned and lists ADRs led — all grounded, all linked", async () => {
    const agent = await readAgent("chief-of-staff");
    const e = agent?.evalHistory;
    expect(e?.adrsLed).toEqual([{ title: "adr-010", href: "/explore/docs/adr-010" }]);
    expect(e?.ledgerAuthored).toEqual([
      { title: "Authored by CoS", href: "/explore/docs/ledger-001-authored" },
    ]);
    expect(e?.ledgerMentioned).toEqual([
      { title: "CTO entry", href: "/explore/docs/ledger-002-mentions" },
    ]);
    // The uncaptured signals are named, never rendered as an earned zero.
    expect(e?.notYetCaptured.length).toBeGreaterThan(0);
  });

  it("is empty-honest for an agent with no authored artifacts", async () => {
    const agent = await readAgent("cto"); // no agents/cto.md → falls back, no artifacts authored here
    // cto authored adr-011 + ledger-002, so it's not fully empty — assert its own attribution.
    expect(agent?.evalHistory.adrsLed).toEqual([
      { title: "adr-011", href: "/explore/docs/adr-011" },
    ]);
    expect(agent?.evalHistory.ledgerMentioned).toEqual([]); // cto isn't mentioned in others here
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

// Releases + Roadmap surfaces (work-054 / work-056): newest-first projections that
// skip templates/READMEs, never invent an entry, and slug to the doc viewer.
describe("listReleases / listRoadmap: newest-first, template-excluded projections", () => {
  let home: string;
  let prev: string | undefined;

  beforeAll(() => {
    prev = process.env.SCOPE_CREEP_HOME;
    home = mkdtempSync(join(tmpdir(), "scope-creep-artifacts-"));
    mkdirSync(join(home, "releases"));
    mkdirSync(join(home, "roadmap"));
    // A template (must be excluded), a README (excluded), and two real releases.
    writeFileSync(
      join(home, "releases", "000-template.md"),
      "---\nname: release-000-template\n---\n\n# Template\n[[roadmap-NNN]]\n",
    );
    writeFileSync(join(home, "releases", "README.md"), "# readme\n");
    writeFileSync(
      join(home, "releases", "001-v0.1.0.md"),
      "---\nname: release-001\ndescription: first\n---\n\n# Release 001 — v0.1.0\n- **Date range:** 2026-09-04 – 2026-09-06\n",
    );
    writeFileSync(
      join(home, "releases", "002-v0.2.0.md"),
      "---\nname: release-002\ndescription: second\n---\n\n# Release 002 — v0.2.0\n- **Date:** 2026-09-07\n",
    );
    writeFileSync(
      join(home, "roadmap", "000-template.md"),
      "---\nname: roadmap-000-template\n---\n\n# Template\n[[roadmap-NNN]]\n",
    );
    writeFileSync(
      join(home, "roadmap", "001-2026-09-07-founding.md"),
      "---\nname: roadmap-001\ndescription: founding\n---\n\n# Roadmap 001\n- **Date:** 2026-09-07\n",
    );
    process.env.SCOPE_CREEP_HOME = home;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SCOPE_CREEP_HOME;
    else process.env.SCOPE_CREEP_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it("lists releases newest-first, excluding template + README, with date + doc slug", async () => {
    const releases = await listReleases();
    expect(releases.map((r) => r.slug)).toEqual(["release-002", "release-001"]);
    expect(releases[0]).toMatchObject({
      title: "Release 002 — v0.2.0",
      description: "second",
      date: "2026-09-07",
      order: 2,
    });
    expect(releases[1].date).toBe("2026-09-04 – 2026-09-06");
  });

  it("lists roadmap presentations newest-first, template excluded", async () => {
    const roadmap = await listRoadmap();
    expect(roadmap.map((r) => r.slug)).toEqual(["roadmap-001"]);
  });

  it("excludes 000-template.md from the doc browser + link index", async () => {
    const docs = await listDocs();
    expect(docs.some((d) => d.slug === "release-000-template")).toBe(false);
    // real releases still browse as docs (so /explore/docs/:slug renders them)
    expect(docs.some((d) => d.slug === "release-002")).toBe(true);
    const index = await buildLinkIndex();
    expect(index.docs.has("release-002")).toBe(true);
    expect(index.docs.has("release-000-template")).toBe(false);
  });
});

// Schedules surface (work-052): the cron describer, cadence-decision parser, and
// routines reader — pure/tolerant so "empty is empty" holds before any loop has run.
// Thread link-out cards (work-048): extract the artifacts a thread references from
// its text, resolving against the namespace; drop what points at nothing.
// Org activity feed (work-037): parse the work-036 log, honest-empty until it lands.
describe("activity: parseActivityLine / activityHref / activityVerb", () => {
  it("parses a well-formed event and drops malformed/incomplete lines", () => {
    const ev = parseActivityLine(
      '{"ts":"2026-09-07T05:00:00Z","id":"e1","actor":"chief-of-staff","type":"delegate","summary":"handed work-052 to ada","threadId":7}',
    );
    expect(ev).toEqual({
      ts: "2026-09-07T05:00:00Z",
      id: "e1",
      actor: "chief-of-staff",
      type: "delegate",
      summary: "handed work-052 to ada",
      threadId: 7,
      refUrl: undefined,
      sessionId: undefined,
    });
    expect(parseActivityLine("")).toBeNull();
    expect(parseActivityLine("not json")).toBeNull();
    expect(parseActivityLine('{"type":"spawn"}')).toBeNull(); // no actor
    expect(parseActivityLine('{"actor":"cto"}')).toBeNull(); // no type
  });

  it("prefers refUrl, falls back to the thread, else null", () => {
    expect(
      activityHref({ actor: "a", type: "confer", summary: "", refUrl: "/explore/docs/adr-013" }),
    ).toBe("/explore/docs/adr-013");
    expect(activityHref({ actor: "a", type: "confer", summary: "", threadId: 3 })).toBe(
      "/threads/3",
    );
    expect(activityHref({ actor: "a", type: "confer", summary: "" })).toBeNull();
  });

  it("maps event types to verbs, passing unknowns through", () => {
    expect(activityVerb("spawn")).toBe("spun up");
    expect(activityVerb("delegate")).toBe("delegated");
    expect(activityVerb("staff")).toBe("staffed");
    expect(activityVerb("confer")).toBe("conferred");
    expect(activityVerb("reviewed")).toBe("reviewed");
  });
});

describe("listActivity / activityForActor (hermetic)", () => {
  let home: string;
  let prev: string | undefined;

  beforeAll(() => {
    prev = process.env.SCOPE_CREEP_HOME;
    home = mkdtempSync(join(tmpdir(), "scope-creep-activity-"));
    mkdirSync(join(home, "activity"));
    writeFileSync(
      join(home, "activity", "2026-09.ndjson"),
      [
        '{"ts":"2026-09-07T05:00:00Z","actor":"chief-of-staff","type":"delegate","summary":"to ada","threadId":7}',
        "", // blank line tolerated
        "garbage-not-json",
        '{"ts":"2026-09-07T06:00:00Z","actor":"cto","type":"spawn","summary":"linus"}',
      ].join("\n"),
    );
    process.env.SCOPE_CREEP_HOME = home;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SCOPE_CREEP_HOME;
    else process.env.SCOPE_CREEP_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it("reads the log newest-first, dropping malformed lines", async () => {
    const events = await listActivity();
    expect(events.map((e) => e.actor)).toEqual(["cto", "chief-of-staff"]);
  });

  it("filters to one actor", async () => {
    expect((await activityForActor("cto")).map((e) => e.summary)).toEqual(["linus"]);
    expect(await activityForActor("nobody")).toEqual([]);
  });

  it("filters to one thread (work-031)", async () => {
    expect((await activityForThread(7)).map((e) => e.summary)).toEqual(["to ada"]);
    expect(await activityForThread(999)).toEqual([]);
  });
});

describe("extractReferences (thread link-out cards)", () => {
  const index = {
    docs: new Set(["adr-016", "prd-cos-threads"]),
    work: new Set(["work-048"]),
    agents: new Set(["chief-of-staff"]),
    templates: new Set<string>(),
    loops: new Set(["dev-cycle"]),
  };

  it("pulls PR URLs, wikilinks, and bare work-NNN, resolved + de-duped", () => {
    const texts = [
      "Landed https://github.com/dimays/scope-creep-console/pull/48 for [[work-048]].",
      "See [[adr-016]] and [[prd-cos-threads]]; ran the dev-cycle. Also work-048 again.",
      "Handed to [[chief-of-staff]].",
    ];
    const refs = extractReferences(texts, index);
    expect(refs).toEqual([
      {
        kind: "pr",
        label: "dimays/scope-creep-console#48",
        href: "https://github.com/dimays/scope-creep-console/pull/48",
        external: true,
      },
      { kind: "ticket", label: "work-048", href: "/work/work-048", external: false },
      { kind: "doc", label: "adr-016", href: "/explore/docs/adr-016", external: false },
      {
        kind: "doc",
        label: "prd-cos-threads",
        href: "/explore/docs/prd-cos-threads",
        external: false,
      },
      {
        kind: "agent",
        label: "chief-of-staff",
        href: "/explore/agents/chief-of-staff",
        external: false,
      },
    ]);
  });

  it("drops references that resolve to nothing (never invents)", () => {
    expect(extractReferences(["[[adr-999]] and [[ghost]] and work-777"], index)).toEqual([]);
  });

  it("is empty for empty text", () => {
    expect(extractReferences(["", ""], index)).toEqual([]);
  });
});

describe("schedules: describeCron / parseCadenceDecisions", () => {
  it("describes the routines' crons in human terms", () => {
    expect(describeCron("0 14 * * 1")).toBe("Mondays at 14:00 UTC");
    expect(describeCron("0 14 1,15 * *")).toBe("the 1st & 15th of each month at 14:00 UTC");
    expect(describeCron("0 14 1 * *")).toBe("the 1st of each month at 14:00 UTC");
    expect(describeCron("0 0 * * *")).toBe("daily at 00:00 UTC");
  });

  it("returns the raw expression for shapes it can't read", () => {
    expect(describeCron("*/30 * * * *")).toBe("*/30 * * * *");
    expect(describeCron("nonsense")).toBe("nonsense");
  });

  it("parses cadence-decision YAML blocks, tolerant of none", () => {
    expect(parseCadenceDecisions("# just prose, no block\n")).toEqual([]);
    const md = [
      "# Ledger entry",
      "```yaml",
      "cadence-decision:",
      "  loop: staffing-review",
      "  ran_at: 2026-09-07",
      "  trigger: scheduled",
      "  decision: hold",
      "  next_cadence_days: 14",
      '  reason: "first run; nominal cadence"',
      "```",
    ].join("\n");
    expect(parseCadenceDecisions(md)).toEqual([
      {
        loop: "staffing-review",
        ranAt: "2026-09-07",
        trigger: "scheduled",
        decision: "hold",
        nextCadenceDays: 14,
        reason: "first run; nominal cadence",
      },
    ]);
  });
});

describe("readRoutines / cadenceHistoryFor: tolerant reads", () => {
  let home: string;
  let prev: string | undefined;

  beforeAll(() => {
    prev = process.env.SCOPE_CREEP_HOME;
    home = mkdtempSync(join(tmpdir(), "scope-creep-routines-"));
    mkdirSync(join(home, "registry"));
    mkdirSync(join(home, "ledger"));
    writeFileSync(
      join(home, "registry", "routines.json"),
      JSON.stringify({
        manage_all_url: "https://claude.ai/code/routines",
        routines: [
          {
            name: "Staffing review",
            loop: "staffing-review",
            trigger_id: "trig_abc",
            cron: "0 14 * * 1",
            cadence_bounds_days: [7, 42],
            model: "claude-sonnet-5",
            manage_url: "https://claude.ai/code/routines/trig_abc",
            status: "active",
          },
        ],
      }),
    );
    writeFileSync(
      join(home, "ledger", "010-staffing.md"),
      [
        "# staffing run",
        "```yaml",
        "cadence-decision:",
        "  loop: staffing-review",
        "  ran_at: 2026-09-14",
        "  decision: lengthen",
        "  next_cadence_days: 21",
        "```",
      ].join("\n"),
    );
    process.env.SCOPE_CREEP_HOME = home;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SCOPE_CREEP_HOME;
    else process.env.SCOPE_CREEP_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it("reads routines with bounds + manage url", async () => {
    const { routines, manageAllUrl } = await readRoutines();
    expect(manageAllUrl).toBe("https://claude.ai/code/routines");
    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({
      loop: "staffing-review",
      triggerId: "trig_abc",
      cadenceBoundsDays: [7, 42],
      manageUrl: "https://claude.ai/code/routines/trig_abc",
    });
  });

  it("collects a loop's cadence history from the ledger", async () => {
    const history = await cadenceHistoryFor("staffing-review");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      ranAt: "2026-09-14",
      decision: "lengthen",
      nextCadenceDays: 21,
    });
    expect(await cadenceHistoryFor("evolve")).toEqual([]);
  });
});
