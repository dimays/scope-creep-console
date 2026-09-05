# AGENTS.md — working in the Console repo

This is a **Scope Creep app** (`kind: app`, Golden Path). It is periphery — freely
rewritten — but it must keep honoring the control-plane rules.

## Read first
1. The control plane's charter: `../scope-creep/charter/INVARIANTS.md`,
   `GLOSSARY.md`.
2. `../scope-creep/standards/app-contract.md` and `golden-path.md`.
3. This repo's [ARCHITECTURE.md](ARCHITECTURE.md) and [PRD.md](PRD.md).

## Non-negotiables
- **The six App-Contract targets stay green and honest.** `test` (typegen + tsc +
  biome + vitest) must pass before anything merges to `main`.
- **`deploy` / `destroy` are human-gated.** Never run them; propose them.
- **Single-user, no auth** (INVARIANTS §II). Never add accounts/roles/tenancy.
- **The default datastore is never production.** `DATABASE_URL` stays a local file
  in dev; secrets never land in the repo.

## Conventions
- Server-only code ends in `.server.ts`. Design decisions live as CSS variables in
  `app/app.css` (until `@scope-creep/design` lands), never hard-compiled.
- Run `bun run format` before committing.
