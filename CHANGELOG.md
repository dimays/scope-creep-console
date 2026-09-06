# Changelog

## 0.18.0 — 2026-09-06
- **Thread branching + generated-request cards** (work-032, ADR-012 — Phase 4 of
  prd-cos-threads): the richest thread interactions, additive on the work-029 conversation
  primitive with no reshape. A thread can now **branch a tangent into a linked child thread**
  from a point in a parent — the child carries a new nullable `parentId` + `branchedFromMessageId`
  (migration `0004`) as the reverse link and split point, and a typed **`branch`** card is dropped
  in the parent at that point, so the two are **linked both ways** (a "↳ branched from" backlink on
  the child, an inline branch card plus a derived **Branches** list on the parent). Followups thread
  cleanly on the child. **Generated feature requests** render as first-class inline **cards** (a new
  `generated-request` type on the same `conversation_messages.type` discriminator) that deep-link to
  the ticket/PRD they created; they're org-authored (`agent` role), so they never enter the
  Human-Input Log. Both new card types reuse the existing outcome-card styling with their own accent.

## 0.17.0 — 2026-09-06
- **Model selection — user- and agent-pickable** (work-018, ADR-002): the chat model is
  a choice, not a hardcode. A new **Settings** tab exposes a persisted **model picker**
  that drives the Console assistant (chat + threads); the pick is stored in a new
  `settings` key/value table (migration `0002`) and validated against the Owner-curated
  catalog `reference/models.json` (read via `SCOPE_CREEP_HOME`) — an id not in the catalog
  is never saved or sent. Resolution order is **persisted pick → `CHAT_MODEL` env →
  catalog default → hardcoded floor**, so a retired id in any slot falls through cleanly
  and the app always has a sane default (a committed fallback catalog covers a missing
  control plane). The **agent model-selection policy** ships as executable code
  (`selectModelForTask` → routine/chat/agentic tiers from the catalog defaults), so
  agents/subagents pick per task instead of hardcoding an id. The agent runtime
  (`agentRespond`/`agentRespondStream`) now takes the resolved model per turn.

## 0.16.0 — 2026-09-06
- **CoS-Threads MVP** (work-029, ADR-012): Chat + Work Requests are unified into one
  top-level **Threads** surface on the conversation primitive. The legacy
  `requests`/`request_messages` tables are migrated into `conversations`/
  `conversation_messages` and retired (data-preserving migration `0001`). A thread now
  carries an explicit **lifecycle/turn** (`open → needs-you | working → closed`) — the
  native fix for the work-011 "whose turn" bug, surfaced on the list as a single **status
  dot** (orange = waiting on you) — and renders intake **outcomes** inline as typed cards
  that deep-link to their artifact. The Console home gains a **Threads** card. The Human-
  Input Log now reads a single consolidated owner-message source. Old `/chat` and
  `/work/requests[/:id]` redirect to `/threads`. Every thread is a Chief-of-Staff
  conversation (the old pinned "Console chat" is gone); triage stays async in the operator
  session — live in-app replies land in a later phase on the flagship runtime.

## 0.15.0 — 2026-09-05
- **Human-Input Log — expand to full message** (work-021, PR #14): a truncated entry is
  now a native `<details>` disclosure; clicking reveals the full message inline
  (pre-wrapped). Entries with a source page link out to it from the expanded view.

## 0.14.0 — 2026-09-05
- **Human-Input Log — terminal capture reader** (work-020, PR #13): `listHumanInput()`
  unions the control-plane's local `human-input/*.ndjson` (via `SCOPE_CREEP_HOME`),
  surfacing `operator-session` (terminal) inputs in the Work → Inputs timeline.

## 0.13.0 — 2026-09-05
- **Human-Input Log v1a** (work-012, ADR-010): a Work → Inputs timeline — a projection
  (owns no data) over the three already-captured Owner-input sources (chat, requests,
  feedback), tagged by Source + Intent, interleaved with git-derived "work between
  inputs" interludes + a leverage readout. Terminal/gate capture is work-020.


## 0.12.0 — 2026-09-05
- **Dashboard fix** (work-019, from request #2): the Extensions panel now lists
  registered extensions (was hardcoded to "None installed yet" despite the count).
  Apps + Extensions entries are clickable, linking out to their repo.


## 0.11.0 — 2026-09-05
- **Approve → gated PR** (work-016, ADR-009): approving a proposal builds its edits on
  an isolated branch (worktree), pushes it, and opens a gated PR (`/chat/land`) — never
  auto-merged; the merge stays the Owner's gated action. Declining closes the PR and
  deletes the branch (`/chat/decline`). Closes the ADR-009 loop.


## 0.10.0 — 2026-09-05
- **Preview sandbox** (work-015, ADR-009): apply a proposed edit in an isolated git
  worktree and return the diff, with proof the running app is untouched
  (`/chat/preview`). Path-safety gate on proposals. Isolation engine only; the
  interactive live-serve preview + agent-generated proposals are work-017.


## 0.9.0 — 2026-09-05
- **In-app agent runtime** (work-014, ADR-008): the Chat tab is now backed by
  persisted conversations (`conversations` + `conversation_messages`) and an
  agent-turn endpoint that calls Claude server-side when `ANTHROPIC_API_KEY` is set,
  with a clear fallback otherwise. Text-only; code-editing arrives in work-015/016.


## 0.8.0 — 2026-09-05
- Graft the **@scope-creep/ext-chatbot** shell (work-013, pinned `#v0.1.0`) on a new
  **Chat** tab — a Shadow-DOM chat panel themed by host tokens. `onSend` is a stub;
  the agent backend arrives in work-014.


## 0.7.0 — 2026-09-04
- **Work Requests** v1 (prd-work-intake §2 / the request-intake loop): a Requests
  section on the Work tab — submit a request, and each becomes a conversation thread
  with a status. `requests` + `request_messages` tables; triage responses are written
  back to the thread (async, operator-side in v1).

## 0.6.0 — 2026-09-04
- **Work History** (per prd-work-intake §1): a Board/History sub-nav on the Work tab;
  History lists shipped work newest-first with links to each ticket and its GitHub PR.

## 0.5.0 — 2026-09-04
- Graft the **@scope-creep/ext-feedback** extension (pinned `#v0.1.0` via git) onto
  Explore — a non-nagging Shadow-DOM feedback prompt, themed by the host tokens.
- Add a `feedback` table + `/feedback` action route (host-side persistence); show a
  feedback count on Explore.

## 0.4.0 — 2026-09-04
- Consume the shared **@scope-creep/design** token layer (pinned `#v0.1.0` via git);
  removed the inline `--sc-*` token copy. Tokens are now centralized and versioned.

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
