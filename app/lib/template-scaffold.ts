/**
 * Deterministic employee-template generation (ADR-017). "Create / modify a template" is
 * form-driven: the exec supplies the role name, description, skills, default model, and
 * the operating manual (their creative latitude), and this renders the exact
 * `agents/templates/<slug>.md` to propose through the gated preview → PR path. Pure +
 * unit-tested; no API key required.
 */

import { displayName, isValidSlug, slugify } from "./employee-scaffold";

export type TemplateSpec = {
  /** kebab-case slug; also the manifest filename. */
  name: string;
  /** one-line description for the manifest + registry. */
  description: string;
  /** the exec (agent slug) that owns this archetype. */
  ownerAgent: string;
  /** default model id for instances, e.g. "claude-sonnet-5". */
  defaultModel?: string;
  /** comma-separated or array of skill tags. */
  skills?: string | string[];
  /** the role's operating manual (markdown body the exec writes). */
  manual?: string;
  /** ISO date (YYYY-MM-DD). */
  created?: string;
};

export { displayName, isValidSlug, slugify };

export function templateFilePath(slug: string): string {
  return `agents/templates/${slug}.md`;
}

function skillsLine(skills: TemplateSpec["skills"]): string {
  const list = Array.isArray(skills)
    ? skills
    : (skills ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return list.join(", ");
}

/** The template `.md` manifest — matches the seed templates' shape and passes docs-lint. */
export function renderTemplateManifest(spec: TemplateSpec): string {
  const created = spec.created ?? new Date().toISOString().slice(0, 10);
  const name = displayName(spec.name);
  const skills = skillsLine(spec.skills);
  const model = spec.defaultModel?.trim() || "claude-sonnet-5";
  const manual = spec.manual?.trim();

  const body = manual
    ? `${manual}\n`
    : `A reusable role archetype an executive can instantiate into an employee agent and
staff to work. Instances inherit this operating manual and specialize in their own
instance body.

## Read first
[[glossary]] · the spec or ticket the work traces to.

## Mandate
- (Describe what this role does and the standards it follows.)

## Default grants
Read the repo; propose edits into an isolated worktree; open a gated PR. No deploy,
spend, publish, or destroy.
`;

  return `---
name: ${spec.name}
description: ${spec.description}
metadata:
  type: reference
  status: active
  version: 1.0.0
  owner_agent: ${spec.ownerAgent}
  last_verified: ${created}
kind: template
default_model: ${model}
skills: ${skills}
---

# Employee template — ${name}

${body}`;
}
