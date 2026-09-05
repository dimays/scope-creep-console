import { describe, expect, it } from "vitest";
import { extractWikilinks, parseFrontmatter, versionSkew } from "./explore.server";

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
