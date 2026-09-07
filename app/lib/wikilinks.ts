// Pure wikilink resolution — no server/db imports, so it's unit-testable and safe
// to share with client code.
//
// The Console's addressable namespace is bigger than the doc set. A `[[target]]`
// in a control-plane doc may point at a doc, a work item, an agent, an employee
// template, or a loop — and every one of those has a real page in this app. The
// old resolver only knew doc slugs, so `[[work-017]]`, `[[backend-engineer]]`,
// `[[core-upgrade]]` rendered as inert code spans and were counted as "dangling"
// even though they resolve perfectly well. This resolver knows the whole namespace,
// so a link is only dangling when it truly points at nothing (genuine drift).

export type LinkIndex = {
  docs: Set<string>;
  work: Set<string>;
  agents: Set<string>;
  templates: Set<string>;
  loops: Set<string>;
};

export function emptyLinkIndex(): LinkIndex {
  return {
    docs: new Set(),
    work: new Set(),
    agents: new Set(),
    templates: new Set(),
    loops: new Set(),
  };
}

/**
 * The page a `[[target]]` resolves to, or null when nothing in the namespace owns
 * it (a genuinely dangling link). Resolution order is fixed for determinism; the
 * namespaces are effectively disjoint (doc slugs, `work-NNN`, agent/template/loop
 * names), so precedence rarely bites, but docs win if a name is ever reused.
 */
export function resolveWikilink(target: string, index: LinkIndex): string | null {
  const key = target.trim();
  if (!key) return null;
  if (index.docs.has(key)) return `/explore/docs/${key}`;
  if (index.work.has(key)) return `/work/${key}`;
  if (index.agents.has(key)) return `/explore/agents/${key}`;
  if (index.templates.has(key)) return `/explore/templates/${key}`;
  if (index.loops.has(key)) return `/explore/loops/${key}`;
  return null;
}

/**
 * Rewrite every `[[target]]` / `[[target|alias]]` in a markdown body into a real
 * markdown link when it resolves, leaving a genuinely-unresolvable one as an inert
 * code span (`[[target]]`) exactly as before — a visible "this points nowhere yet"
 * marker rather than a dead-looking link.
 */
export function linkifyWikilinks(body: string, index: LinkIndex): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (_full, ref: string) => {
    const [target, alias] = ref.split("|");
    const label = (alias ?? target).trim();
    const url = resolveWikilink(target, index);
    return url ? `[${label}](${url})` : `\`[[${ref}]]\``;
  });
}
