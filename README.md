# Scope Creep Console

The end-user surface of [Scope Creep](../scope-creep) — the web console you use to
see and operate your software factory. It is the **first Golden-Path app**, built
to dogfood the whole system ([ADR-003](../scope-creep/standards/adr/003-console-architecture.md)).

## Stack (Golden Path)

End-to-end TypeScript: **React Router 7 (framework mode)** on Vite · **Drizzle +
libSQL/SQLite** · **Bun** (dev/test) + **Node LTS** (prod runtime) · **Vitest** ·
**Biome** · Tailwind v4.

## Quickstart

```bash
bun install            # bootstrap
bun run dev            # http://localhost:5173  (dev)
bun run test           # the gate: typegen + tsc + biome + vitest
bun run build && bun run start   # production build + serve on :3000
```

Requires Node ≥ 22 and Bun. To see your factory, point the Console at the control
plane:

```bash
SCOPE_CREEP_HOME=/path/to/scope-creep bun run dev
```

If unset, it defaults to a sibling `../scope-creep`; if not found, the Console
still runs and shows a "control plane not found" notice.

## The six App-Contract targets

`bootstrap` · `test` · `run` · `deploy` (gated) · `healthcheck` (`GET /healthz`) ·
`destroy` (gated). See [ARCHITECTURE.md](ARCHITECTURE.md) and the
[App Contract](../scope-creep/standards/app-contract.md).

## Docs

[PRD](PRD.md) · [ARCHITECTURE](ARCHITECTURE.md) · [USERGUIDE](USERGUIDE.md) ·
[AGENTS](AGENTS.md) · [CHANGELOG](CHANGELOG.md) · [MANIFEST](MANIFEST.yaml)
