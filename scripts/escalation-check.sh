#!/usr/bin/env bash
# escalation-check.sh — the FLOOR mechanical rail for ADR-022 trigger (d), ported to
# the scope-creep-CONSOLE repo (Part 1c of the GitHub-write-access activation;
# work-088). The source lives in `dimays/scope-creep` (the control plane).
#
# Classifies a PR's changed paths and, if the diff touches an ESCALATION-CLASS path
# WITHOUT the Owner-approval marker, exits non-zero to HOLD the PR for the Owner. This
# makes ADR-022 trigger (d) — and much of (a)/(b) — mechanical rather than reviewer
# judgment. See ADR-022 (autonomous-merge-with-escalation) in the control-plane repo.
#
# Usage:
#   escalation-check.sh <base-ref> <head-ref> [--marker-present]
#     base-ref / head-ref  any git revisions (e.g. a base sha and a head sha).
#                          The changed set is the three-dot diff base...head
#                          (i.e. changes introduced on head since the merge-base).
#     --marker-present     the CALLER verified the Owner-approval marker is present
#                          (the CI workflow checks the `owner-approved` PR label).
#                          When present, escalation-class touches are ALLOWED — the
#                          Owner has approved — and the script reports them, exit 0.
#
# Exit codes:
#   0  no escalation-class path touched, OR the marker is present -> may proceed.
#   1  escalation-class path touched and NO marker -> HOLD for the Owner.
#   2  usage / internal error.
#
# ---------------------------------------------------------------------------
# THE CONSOLE ESCALATION-CLASS PATH-SET (and how it differs from the control plane)
# ---------------------------------------------------------------------------
# The control-plane rail keys on control-plane surfaces (charter/INVARIANTS.md,
# standards/**, agents/**, loops/**, registry/**, ledger/**, .claude/**,
# .github/workflows/**, + dependency/infra manifests). The console is a PERIPHERY
# TypeScript app (React Router + Drizzle/libSQL on Turso/libSQL, containerized), so
# almost none of those control-plane paths exist here. This set is designed from
# first principles — "what change here should HOLD for the Owner rather than merge
# autonomously?" — mapped to the ADR-022 triggers:
#
#   (d) safety rails / gate surface / core:
#     - .github/workflows/**   CI runs with repo secrets; a workflow edit can weaken
#                              or delete the very gate that guards merges.
#     - .github/CODEOWNERS     the required-review gate surface. With branch protection
#                              require_code_owner_reviews=true, changing CODEOWNERS
#                              changes WHO can approve — i.e. it can weaken the gate.
#                              (DIFFERS from the control plane, which excluded CODEOWNERS
#                              ONLY so the bootstrap PR that first added it could land.
#                              On the console it already exists, so there is no bootstrap
#                              concern and it is a live gate surface — fail closed.)
#     - .claude/**             local harness hook + permission config (this repo ships
#                              .claude/settings.json + .claude/hooks/*).
#     - this script itself is under scripts/ but is NOT globbed by a broad scripts/*
#                              rule (the console keeps scripts/ for ordinary app tooling
#                              like triage.ts); it is guarded by the .github/workflows
#                              rail + CODEOWNERS review, matching the source's posture.
#
#   (a)/(d) financial burden / paid infra / dependency + deploy manifests:
#     - package.json           adds/changes dependencies (supply-chain + potential
#                              paid/native deps) and the App-Contract lifecycle scripts.
#     - bun.lock (+ other lockfiles as defensive guards) the resolved dependency set.
#     - Dockerfile / .dockerignore   the shipped production image; .dockerignore governs
#                              build context (loosening it can bundle secrets into the image).
#     - fly.toml / Procfile / app.json / heroku.yml / *.tf / *.tfvars   deploy / infra
#                              manifests. Most do NOT exist yet — package.json's release
#                              script targets Fly — so these are FORWARD guards: the moment
#                              a deploy/infra manifest lands (paid infra, a deploy topology
#                              change) it escalates rather than slips in.
#
#   (b) security / secrets / DB-credential surface:
#     - drizzle.config.ts      DB config (dialect, migration target, credential wiring).
#     - app/db/config.ts       the DB connection + auth-token RESOLUTION + remote-gating
#                              logic (INVARIANTS §9 "default datastore is never production"
#                              guard; DATABASE_AUTH_TOKEN handling). A change here can
#                              re-point the store or weaken the token requirement — the one
#                              app-source file security-critical enough to gate by path.
#     - .env / .env.*          secret files. They are gitignored and must never be
#                              committed; a PR that adds one is a secret-exposure event.
#
# DELIBERATELY NOT escalation-class (so the org self-merges routine periphery, ADR-022):
#   app/routes/**, app/components/**, app/lib/** (app logic), drizzle/** migrations,
#   app/db/schema.ts (routine schema evolution), *.test.ts, docs (*.md), styles/CSS,
#   and build tooling (tsconfig.json, vite.config.ts, vitest.config.ts, biome.json,
#   react-router.config.ts, .node-version). These are covered by the test gate + the
#   independent review's judgment (triggers b/c), not by this path floor. There is no
#   ledger/** in the console, so the source's ledger carve-out is dropped entirely.
#
# ---------------------------------------------------------------------------
# LOAD-BEARING HONESTY — the marker is FORGEABLE under today's shared identity.
# ---------------------------------------------------------------------------
# The Owner-approval marker enforced today is the `owner-approved` GitHub label
# (checked by .github/workflows/escalation-check.yml, not by this script). Under the
# current setup interactive agents act through the Owner's ONE `dimays` GitHub identity,
# so such an agent with `gh` can add that label itself and clear this hold. That is a
# real residual gap: this rail stops the *accidental / unreviewed* escalation merge and
# forces the decision to be an explicit, auditable label event, but it is NOT
# un-spoofable against a deliberate interactive agent. The real backstop for the
# UNATTENDED cloud routine is identity separation — it acts as the `scope-creep-routine`
# GitHub App, which cannot be a code owner or approve, and CODEOWNERS + a required
# code-owner review (branch protection) means a bot-authored escalation PR cannot merge
# without a genuine Owner approval. See docs/owner-apply-github-write-access.md and
# ADR-022 / ADR-023 in the control-plane repo. Do not represent this marker as
# un-spoofable on its own.
# ---------------------------------------------------------------------------

set -u

usage() {
  echo "usage: escalation-check.sh <base-ref> <head-ref> [--marker-present]" >&2
  exit 2
}

base="${1:-}"
head="${2:-}"
marker="${3:-}"
[ -z "$base" ] || [ -z "$head" ] && usage
if [ -n "$marker" ] && [ "$marker" != "--marker-present" ]; then usage; fi

# is_escalation <path> -> return 0 if the path is escalation-class, else 1.
# A straight path match against the console escalation-class set documented above.
is_escalation() {
  f="$1"
  case "$f" in
    # --- the gate / safety-rail surface (ADR-022 trigger (d)) ---
    .github/workflows/*)                         return 0 ;;
    .github/CODEOWNERS)                          return 0 ;;
    .claude/*)                                   return 0 ;;
    # --- dependency manifests (trigger (a): supply chain / paid deps) ---
    package.json|*/package.json)                 return 0 ;;
    package-lock.json|*/package-lock.json)       return 0 ;;
    npm-shrinkwrap.json|*/npm-shrinkwrap.json)   return 0 ;;
    yarn.lock|*/yarn.lock)                       return 0 ;;
    pnpm-lock.yaml|*/pnpm-lock.yaml)             return 0 ;;
    bun.lock|*/bun.lock)                         return 0 ;;
    bun.lockb|*/bun.lockb)                       return 0 ;;
    # --- image / infra / deploy manifests (trigger (d), overlaps (a)) ---
    Dockerfile|*/Dockerfile|Dockerfile.*|*/Dockerfile.*) return 0 ;;
    .dockerignore|*/.dockerignore)               return 0 ;;
    fly.toml|*/fly.toml)                         return 0 ;;
    Procfile|*/Procfile)                         return 0 ;;
    app.json|*/app.json)                         return 0 ;;   # Heroku app manifest
    heroku.yml|*/heroku.yml)                     return 0 ;;
    *.tf|*.tfvars)                               return 0 ;;
    # --- DB / credential config + secrets (trigger (b): security) ---
    drizzle.config.ts|*/drizzle.config.ts)       return 0 ;;
    app/db/config.ts)                            return 0 ;;
    .env|.env.*|*/.env|*/.env.*)                 return 0 ;;
  esac
  return 1
}

changed="$(git diff --name-only "$base...$head" 2>/dev/null)"
if [ -z "$changed" ]; then
  echo "escalation-check: empty diff for $base...$head — nothing to classify."
  exit 0
fi

esc=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if is_escalation "$f"; then
    esc="${esc}  - ${f}"$'\n'
  fi
done <<EOF
$changed
EOF

if [ -z "$esc" ]; then
  echo "escalation-check: PASS — no escalation-class paths touched (routine PR)."
  exit 0
fi

echo "escalation-check: escalation-class paths touched (ADR-022 trigger (d)):"
printf '%s' "$esc"

if [ "$marker" = "--marker-present" ]; then
  echo "escalation-check: Owner-approval marker present (owner-approved label) — ALLOW."
  echo "  (Reminder: under the shared identity this label is agent-forgeable; the real"
  echo "   backstop is the App identity + CODEOWNERS review — see ADR-023.)"
  exit 0
fi

echo "escalation-check: HOLD — escalation-class change with NO Owner-approval marker."
echo "  This PR edits the console's gate surface / infra / DB-credential config and must"
echo "  be approved by the Owner."
echo "  The Owner clears the hold by adding the 'owner-approved' label to this PR."
echo "  (Residual gap: that label is agent-forgeable under the shared GitHub identity for"
echo "   interactive agents; the unattended routine is backstopped by the App identity +"
echo "   CODEOWNERS review — ADR-023.)"
exit 1
