# Changelog

## 0.3.0 — 2026-09-04
- **Work** board (per ADR-005): reads the control plane's `work/*.md` records and
  renders a read-only kanban grouped by status (Proposed / Active / Blocked / Done),
  with priority accents, type tags, and per-item detail pages. Global nav entry.

## 0.2.0 — 2026-09-04
- **Explore** (per the CPO's PRD): understand the platform from inside the Console.
  - Docs browser with `[[wikilink]]` resolution; per-doc rendered markdown.
  - Agent profiles: charter + a contributions view derived from the ledger.
  - Timeline of every recorded decision/event.
  - Consistency view — surfaces drift (hand-seeded registries, proposed docs,
    dangling wikilinks, stale docs). Wikilink scanner ignores code spans.
- Global top-nav (Console / Explore); dashboard agent names link to profiles.
- Added `marked` for markdown rendering.

## 0.1.0 — 2026-09-04 (genesis)
- First Golden-Path app, manufactured via the `new-app` loop.
- SSR dashboard reading the control plane's registries (agents / apps / extensions).
- `/healthz` resource route; Drizzle + libSQL data layer (`page_visits`).
- Runtime CSS-variable design-token seed (light + dark).
- Six App-Contract targets wired; green test gate (tsc + biome + vitest).
- Dockerfile: Bun build, Node LTS runtime.
