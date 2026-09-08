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

## Datastore env (ADR-024)

The thread store is remote-capable (work-065). Two env vars pick the datastore, per
environment — the switch is a connection string, never a code change:

| Var | Local dev (default) | Deploy / cloud routine |
|---|---|---|
| `DATABASE_URL` | `file:./data/app.db` | `libsql://<db>.turso.io` (hosted libSQL) |
| `DATABASE_AUTH_TOKEN` | *(unset)* | the **scoped** libSQL token for that db only |

Local dev stays on a file db — nothing points local at a remote by default
(INVARIANTS §9, "the default datastore is never production"). A remote `DATABASE_URL`
**must** carry its own `DATABASE_AUTH_TOKEN` (an infra credential, not a user identity —
INVARIANTS §II); the app refuses to boot tokenless rather than silently connect or fall
back to an empty local db. Provisioning the hosted instance is **Owner-gated** (account +
spend) — see the control plane's `docs/owner-apply-request-loop.md`.

## The six App-Contract targets

`bootstrap` · `test` · `run` · `deploy` (gated) · `healthcheck` (`GET /healthz`) ·
`destroy` (gated). See [ARCHITECTURE.md](ARCHITECTURE.md) and the
[App Contract](../scope-creep/standards/app-contract.md).

## Docs

[PRD](PRD.md) · [ARCHITECTURE](ARCHITECTURE.md) · [USERGUIDE](USERGUIDE.md) ·
[AGENTS](AGENTS.md) · [CHANGELOG](CHANGELOG.md) · [MANIFEST](MANIFEST.yaml)
