---
name: console-userguide
description: How you (the Owner) run and use the Scope Creep Console.
metadata:
  type: user
  status: active
  version: 0.1.0
  owner_agent: chief-knowledge-manager
  last_verified: 2026-09-04
---

# Console — User Guide

## Run it locally
```bash
bun install
SCOPE_CREEP_HOME=/Users/davidmays/code/scope-creep bun run dev
```
Open http://localhost:5173. You'll see three panels — **Agents**, **Apps**,
**Extensions** — populated from your control plane, plus a visit counter.

## What each panel means
- **Agents** — your C-suite (and any employee agents) from `registry/agents.json`.
- **Apps** — apps registered by the `new-app` loop (this Console is the first).
- **Extensions** — installed extensions (none yet).

If you see "control plane not found," set `SCOPE_CREEP_HOME` to your `scope-creep`
repo path.

## Health
Visit http://localhost:5173/healthz for a machine-readable status
(`{status, version, db}`).

## Deploying
Not yet. When it's time, deploy to a host you own behind an edge perimeter
(Tailscale / Cloudflare Access) — never public without one. `deploy` and `destroy`
are human-gated on purpose.
