---
name: console-prd
description: Living PRD for the Scope Creep Console — the end-user surface of the factory.
metadata:
  type: project
  status: active
  version: 0.1.0
  owner_agent: chief-designer
  last_verified: 2026-09-04
---

# Scope Creep Console — Living PRD

## Vision `active`
The single place the Owner goes to *see and operate* their software factory: the
agent org, the manufactured apps, the loops, and — later — a live chat that edits
an app in a preview and merges the change. It is the first Golden-Path app and the
proving ground for the whole system.

## v0.1 — what exists `active`
A server-rendered dashboard that reads the control plane's generated registries
(`SCOPE_CREEP_HOME`) and shows the agent org, registered apps, and extensions,
plus a `/healthz` endpoint and a Drizzle/libSQL data layer (a page-visit table)
proving the Golden Path stack end to end. Green test gate; runs locally.

## Roadmap `proposed`
1. **Live loop runner** — invoke `new-app` / `heal` from the UI and stream progress.
2. **Agent chat** — talk to a C-suite agent in-app.
3. **The chatbot extension** — edit an app in a live preview and merge (the flagship;
   honors the Designer's Shadow-DOM style-isolation standard).
4. **Adopt `@scope-creep/design`** — replace the v0.1 token seed with the shared,
   semver-pinned design package.
5. **Deploy** — to a persistent host the Owner owns, behind an edge perimeter (ADR-003).

## Non-goals `active`
No authentication or multi-user anything (INVARIANTS §II). Public exposure, when it
comes, is solved at the network edge, not in the app.
