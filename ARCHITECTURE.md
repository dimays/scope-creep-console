---
name: console-architecture
description: How the Scope Creep Console is built and the decisions behind it.
metadata:
  type: reference
  status: active
  version: 0.1.0
  owner_agent: cto
  last_verified: 2026-09-04
---

# Architecture

## Shape
A React Router 7 (framework-mode) SSR app. Routes:
- `/` (`app/routes/home.tsx`) — the dashboard. Its `loader` records a page visit
  (Drizzle/libSQL) and reads the control plane's registries via
  `app/lib/registry.server.ts`, then renders the org.
- `/healthz` (`app/routes/healthz.tsx`) — a resource route (loader only) returning
  `{status, version, db}`; the App Contract's `healthcheck` target.

## Data layer
Drizzle ORM over libSQL (`app/db/`). One file per app (`DATABASE_URL`, default
`file:./data/app.db`) = Environment isolation. Schema is TypeScript, checked by
`tsc` — the self-heal oracle covers the DB too.

## Design tokens
`app/app.css` defines a runtime CSS-variable token layer (light + dark), honoring
the Chief Designer's constraint #1. This is a **seed**, to be superseded by the
shared `@scope-creep/design` package.

## Key decisions
- **Golden Path stack** — see [ADR-001](../scope-creep/standards/adr/001-blessed-stack.md).
- **Console is the first app; core stays headless** — [ADR-003](../scope-creep/standards/adr/003-console-architecture.md).
- **Schema init via `ensureSchema()` for v0.1** — see [adr/001-schema-init.md](adr/001-schema-init.md).

## Build & run
Bun for dev/test; Node LTS for the production runtime (`Dockerfile` builds with Bun,
runs on `node:22-slim`, installing prod deps in the Node image so native modules
match). Deploy target Fly.io — **gated**.
