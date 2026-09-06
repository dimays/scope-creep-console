---
name: console-adr-002
description: The chat model is a validated choice (Owner picker + agent per-task policy), seeded from the control plane's reference/models.json, with layered fallback.
metadata:
  type: reference
  status: active
  version: 1.0.0
  owner_agent: cto
  last_verified: 2026-09-06
---

# ADR-002 (Console): Model selection — user- and agent-pickable

- **Status:** accepted
- **Date:** 2026-09-06
- **Ticket:** work-018 · **Spec:** prd-chatbot-extension · **Seeds from:** [[reference]]
  `models.json`, [[adr-008]] (the runtime already reads `CHAT_MODEL`)

## Context

The chat model was a hardcode (`process.env.CHAT_MODEL ?? "claude-sonnet-5"`) read deep
in the agent runtime. work-018 asks for two axes of choice: an **Owner-pickable** model
(a persisted Console picker) and an **agent-pickable** policy (subagents choose a model
per task as the system grows). Both must draw from one Owner-curated source of truth and
must never send an id that isn't a real, current model.

## Decision

**One catalog, one validator, layered fallback — resolved at the call site, not in the
runtime.**

1. **Catalog** — the Owner-curated `reference/models.json` in the control plane is the
   authority, read via `SCOPE_CREEP_HOME` (the same resolution the registry uses). A
   committed `FALLBACK_CATALOG` mirrors it as the floor when the control plane is
   unreachable, so the picker and defaults always work from a clean clone.

2. **Validation** — every candidate id is checked against the catalog's model list
   (`isValidModelId`). An id that isn't in the catalog (a retired/typo'd id) is **never
   persisted and never sent to the API**; resolution falls through to the next candidate.
   "Retired IDs fail hard" means the *caller* fails over cleanly, not that the app throws.

3. **Owner pick** — persisted in a new `settings` key/value table (`chat_model`), edited
   on a new **/settings** route. Resolution order for the effective chat model:
   **persisted pick → `CHAT_MODEL` env → catalog `defaults.chat` → hardcoded floor.**

4. **Agent policy** — `selectModelForTask(task)` maps the three tiers to the catalog
   defaults: `routine` (cheap/high-volume), `chat` (interactive), `agentic` (hard
   reasoning / coding / tool-use). Executable, so it can't drift from documentation.

5. **Plumbing** — the runtime (`agentRespond` / `agentRespondStream`) takes the resolved
   `model` per turn; the call sites (`conversation.server`, `threads.server`) resolve it.
   The runtime keeps the env fallback for legacy callers, but never invents an id.

## Alternatives considered

- **Keep model resolution inside the runtime.** Rejected: the runtime would need db +
  catalog access, coupling the mutator to the periphery. Resolving at the call site keeps
  `agent.server.ts` a thin, pure API adapter (the small stable mutator).
- **Persist the pick in `.env` / a file.** Rejected: the DB is the app's persistence
  idiom, survives redeploys, and needs no env reload. `CHAT_MODEL` stays a valid default
  layer for headless/first-run.
- **A free-text model field.** Rejected: it invites unknown ids. A picker over the
  validated catalog is the safe, discoverable surface.

## Consequences

- The Owner changes models without editing env or redeploying; the Console shows which
  layer the effective model came from.
- Agents share one policy; as the catalog changes, all callers follow with no code edits.
- **Follow-up (ledger):** the *agent* half of the policy is system-wide, but its canonical
  home is a control-plane **standard**, which is core and changes only via `core-upgrade`
  with Owner approval. This ADR + `selectModelForTask` are the Console's binding of that
  policy; ratifying a `standards/model-policy` doc into the core is a separate, Owner-gated
  step, noted for the ledger and **not** done in this PR.
