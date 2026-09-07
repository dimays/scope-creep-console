import { describe, expect, it } from "vitest";
import { emptyLinkIndex, type LinkIndex, linkifyWikilinks, resolveWikilink } from "./wikilinks";

const index: LinkIndex = {
  docs: new Set(["invariants", "adr-019", "reference"]),
  work: new Set(["work-017"]),
  agents: new Set(["chief-designer", "ada"]),
  templates: new Set(["backend-engineer"]),
  loops: new Set(["core-upgrade"]),
};

describe("resolveWikilink", () => {
  it("resolves each namespace to its own page", () => {
    expect(resolveWikilink("invariants", index)).toBe("/explore/docs/invariants");
    expect(resolveWikilink("work-017", index)).toBe("/work/work-017");
    expect(resolveWikilink("chief-designer", index)).toBe("/explore/agents/chief-designer");
    expect(resolveWikilink("backend-engineer", index)).toBe("/explore/templates/backend-engineer");
    expect(resolveWikilink("core-upgrade", index)).toBe("/explore/loops/core-upgrade");
  });

  it("trims whitespace around the target", () => {
    expect(resolveWikilink("  work-017 ", index)).toBe("/work/work-017");
  });

  it("returns null for a target nothing in the namespace owns (genuine drift)", () => {
    expect(resolveWikilink("adr-999", index)).toBeNull();
    expect(resolveWikilink("", index)).toBeNull();
    expect(resolveWikilink("does-not-exist", emptyLinkIndex())).toBeNull();
  });
});

describe("linkifyWikilinks", () => {
  it("turns resolvable links into markdown links, honoring the alias", () => {
    expect(linkifyWikilinks("see [[work-017]]", index)).toBe("see [work-017](/work/work-017)");
    expect(linkifyWikilinks("see [[work-017|the ticket]]", index)).toBe(
      "see [the ticket](/work/work-017)",
    );
  });

  it("resolves a template/agent/loop link, not just a doc link", () => {
    expect(linkifyWikilinks("[[backend-engineer]]", index)).toBe(
      "[backend-engineer](/explore/templates/backend-engineer)",
    );
    expect(linkifyWikilinks("[[core-upgrade]]", index)).toBe(
      "[core-upgrade](/explore/loops/core-upgrade)",
    );
  });

  it("leaves a genuinely-dangling link as an inert code span, not a dead link", () => {
    expect(linkifyWikilinks("[[adr-999]]", index)).toBe("`[[adr-999]]`");
  });
});
