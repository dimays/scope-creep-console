import { describe, expect, it } from "vitest";
import { extractWikilinks, parseFrontmatter } from "./explore.server";

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
