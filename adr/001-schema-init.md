---
name: console-adr-001
description: v0.1 uses an idempotent ensureSchema() instead of drizzle-kit migrations while the schema is a single seed table.
metadata:
  type: reference
  status: active
  version: 1.0.0
  owner_agent: cto
  last_verified: 2026-09-04
---

# ADR-001 (Console): Schema init via `ensureSchema()` for v0.1

- **Status:** accepted
- **Date:** 2026-09-04

## Context
The Golden Path uses drizzle-kit migrations. At v0.1 the schema is a single seed
table (`page_visits`), and wiring drizzle-kit's local-SQLite driver added setup
friction disproportionate to one table.

## Decision
Ship an idempotent `ensureSchema()` (a `CREATE TABLE IF NOT EXISTS`) called by the
loaders, so the app is runnable from a clean clone with zero migration step. Keep
`drizzle.config.ts` and the `db:generate` / `db:migrate` scripts in place.

## Consequences
- `bootstrap` is just `bun install`; no migration to run for the seed.
- **Superseded when the schema grows:** the second table triggers a move to real
  drizzle-kit migrations, and `ensureSchema()` is removed. Recorded here so a future
  agent doesn't treat the shortcut as the intended long-term pattern.
