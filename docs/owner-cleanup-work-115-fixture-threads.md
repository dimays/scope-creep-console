# Owner-gated cleanup — work-115 fixture-thread contamination

**Status:** proposed (Owner-gated). **Do not run the destructive steps autonomously.**
**Author:** CTO, via work-115 (reworked after the CoS live-store re-audit). **Repo:** scope-creep-console.

## What this is

The request-triage sweep was returning ~200+ threads that are verbatim **console test
fixtures** (e.g. `Add a dark mode toggle` / `Please add dark mode.`). Root cause: a test run
resolved the DB to the **remote Turso store** instead of `:memory:` (an ambient
`SCOPE_CREEP_DB_URL`/token out-precedenced the `DATABASE_URL=:memory:` pin), so
`createThread(...)` and friends wrote their fixtures into the **shared** store the routine
reads. The leak is closed in code (this PR: `vitest.config.ts` env pins + `test/guard-local-db.ts`
belt). **This document covers removing the rows already in the store.**

### What the live store actually contains (CoS read-only audit, 2026-09-21)

- **319 active (non-archived) `kind='request'` threads.** Grouped by exact
  `(title, opener-body)`: **51 distinct groups.**
- **50 of the 51 groups are test fixtures** — each duplicated **exactly 6× or 9×** (one copy
  per test run, across several runs against the shared store).
- **Exactly 1 group is genuine:** `"Request: Planned Work Routine"` — a **singleton** (one row).
- Plus **18 already-archived fixtures**.

This audit is why this doc was reworked. The earlier **exact `(title, body)` pair list** only
matched 246 rows (228 active) and **missed ~9 fixture shapes** from test files the original
3-file scan never covered (`app/routes/route-entrypoints.test.ts`,
`app/lib/work-sweep.server.test.ts`, and the org-initiated fixtures). An ever-growing hand-kept
pair list is the wrong tool. **The data has a clean, self-describing signature instead:**

> **A fixture is a `kind='request'` thread whose exact `(title, opener-body)` appears ≥ 2 times.
> The one genuine request is a singleton.** So: *dedup, don't enumerate.*

Per INVARIANTS §III ("propose, never dispose") and §10 ("every change is reversible"), a
delete against the shared store is **Owner-gated**. The routine only ever *flags*; it never
deletes. This spec gives you identify → preview → **archive (reversible)**, with a hard-delete
offered only as an optional, backed-up, explicitly-confirmed follow-up.

## Recommendation: ARCHIVE, don't delete

**Archive the fixture threads** (`UPDATE ... SET archived_at = <now>`), do not hard-delete.

- Archiving is **fully reversible** — `restoreThread()` (or `SET archived_at = NULL`) brings a
  thread back exactly as it was. Hard-delete is not (INVARIANTS §10).
- Archived threads are **already excluded from the sweep** (`listNewRequestThreads` filters
  `isNull(conversations.archivedAt)`) **and** from the main Threads UI and unread/notification
  counts. So archiving fully stops the budget burn and the noise **without destroying data**.
- The only cost is junk rows in the Archive view. A hard-delete can follow later (§ "Optional
  hard-delete"), once you've confirmed the archived set is exactly the fixtures and nothing real.

This is belt-and-suspenders with the runtime `FIXTURE_DENYLIST` in `app/lib/triage.server.ts`:
even an un-archived leftover would be skipped by the sweep, but archiving removes it from every
surface, reversibly.

## How the fixtures are identified — the dedup + KEEP-allowlist criterion (primary)

**Fixture** = a `kind='request'` conversation whose opener (the **first message by timestamp**,
regardless of `role` — so this catches both Owner-opened *and* org-opened fixtures) shares its
exact `(title, opener-body)` with **at least one other** `request` thread — **unless** it is on
the **KEEP allowlist** below.

- **Why "count ≥ 2"?** Every fixture is created once per test run and the tests ran 6–9 times
  against the store, so every fixture shape is duplicated. The single genuine request
  (`"Request: Planned Work Routine"`) is a **singleton** and is therefore *never* flagged by this
  rule at all. Grouping is by the full `(title, opener-body)` pair, so a real thread that merely
  *shares a title* with a fixture but has its own body is a distinct group of one — also spared.
- **Why the KEEP allowlist too?** The count-rule already spares singletons, but the allowlist is
  the explicit safety pin for the case where a genuine request was legitimately filed **twice**
  (which the count-rule would otherwise flag). It is a hard override: anything whose title is on
  the allowlist is **never** archived.

```sql
-- The KEEP allowlist — genuine request threads that must NEVER be archived, even if duplicated.
-- Pinned by TITLE (keeping is the safe direction; a title match is deliberately generous).
-- >>> OWNER: before running, add any OTHER real request titles you recognize in the Step-1 list. <<<
--   'Request: Planned Work Routine'   -- the one genuine singleton the audit found
```

**Validation (scratch SQLite mirroring the schema, run 2026-09-21).** Seeded: an Owner-opened
fixture ×6, an **org-opened** fixture ×6 (opener `role='agent'`), the genuine singleton ×1, a
genuine thread that **shares a fixture title but has a unique body** ×1, an allowlisted genuine
title **duplicated** ×2, and a duplicated **`chat`-kind** thread. Results — all as required:
flagged exactly the two fixture groups (6 + 6 = 12 rows); **spared** the genuine singleton, the
shared-title/unique-body thread, the duplicated-but-allowlisted genuine thread, and every
`chat`-kind row (the criterion is scoped to `kind='request'`).

> A **fallback exact-pair list** is preserved in the Appendix for auditors who want to eyeball a
> hand-enumerated set. The dedup criterion above is the recommended, complete one; the exact-pair
> list is known-incomplete (that is what this rework fixes) and is kept only as a cross-check.

## How to connect (read the env; do not paste secrets into chat)

The store is the remote libSQL/Turso endpoint the console's deploy + the routine use, via
`SCOPE_CREEP_DB_URL`/`SCOPE_CREEP_DB_AUTH_TOKEN` (or the `DATABASE_*` fallbacks). Use the
Turso shell **you** are authenticated for, e.g.:

```sh
# Owner runs this locally; the token stays in your shell/keychain, never in the repo or chat.
turso db shell "$SCOPE_CREEP_DB_URL"     # or: turso db shell <db-name>
```

All steps below are plain SQL you run in that shell. **Take a backup first** (see below).

## Step 0 — Back up (do this before any write)

```sh
turso db shell <db-name> ".dump" > work-115-preclean-backup-$(date +%Y%m%d-%H%M%S).sql
```

Keep this file until you're certain the cleanup was correct. It is the reversal path even for a
hard-delete.

## Step 1 — Identify + COUNT the fixture rows (READ-ONLY; run this first)

Self-contained. Materializes the KEEP allowlist, computes the per-conversation opener, groups to
find the duplicated `(title, opener-body)` shapes, and reports (a) the totals and (b) the full
group breakdown so you can **eyeball all 51 groups** before touching anything. Safe to re-run.

```sql
-- (Step 1) READ-ONLY preview. No writes.
DROP TABLE IF EXISTS temp.keep_allowlist;
CREATE TEMP TABLE keep_allowlist(title TEXT NOT NULL);
INSERT INTO keep_allowlist(title) VALUES
  ('Request: Planned Work Routine');           -- OWNER: add any other real request titles here.

WITH opener AS (   -- first message per conversation, by timestamp then id (role-agnostic)
  SELECT m.conversation_id AS cid, m.body AS body,
         ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.at ASC, m.id ASC) AS rn
  FROM conversation_messages m
),
req AS (
  SELECT c.id, c.title, c.status, c.archived_at, c.initiator, o.body AS opener_body
  FROM conversations c
  JOIN opener o ON o.cid = c.id AND o.rn = 1
  WHERE c.kind = 'request'
),
grp AS (   -- the duplicated (title, opener-body) shapes = the fixture signature
  SELECT title, opener_body, count(*) AS n
  FROM req
  GROUP BY title, opener_body
  HAVING count(*) >= 2
),
fixture_convos AS (
  SELECT r.*
  FROM req r
  JOIN grp g ON g.title = r.title AND g.opener_body = r.opener_body
  WHERE r.title NOT IN (SELECT title FROM keep_allowlist)
)
-- (a) the headline counts:
SELECT
  (SELECT count(*) FROM req)                                              AS all_request_threads,
  (SELECT count(*) FROM req WHERE archived_at IS NULL)                    AS active_request_threads,
  (SELECT count(DISTINCT title || char(31) || opener_body) FROM req)      AS distinct_groups,
  (SELECT count(*) FROM fixture_convos)                                   AS fixtures_total,
  (SELECT count(*) FROM fixture_convos WHERE archived_at IS NULL)         AS fixtures_not_yet_archived;

-- (b) EYEBALL: every distinct group, how many copies, and whether it was flagged as a fixture.
--     Expect ~51 groups: ~50 flagged (dup'd 6x/9x) + the genuine singleton(s) NOT flagged.
--     >>> Scan this. If ANY flagged row is something you actually filed, STOP and allowlist it. <<<
WITH opener AS (
  SELECT m.conversation_id AS cid, m.body AS body,
         ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.at ASC, m.id ASC) AS rn
  FROM conversation_messages m
),
req AS (
  SELECT c.id, c.title, o.body AS opener_body
  FROM conversations c JOIN opener o ON o.cid = c.id AND o.rn = 1
  WHERE c.kind = 'request'
)
SELECT
  r.title,
  substr(r.opener_body, 1, 60) AS opener_body_60,
  count(*)                     AS copies,
  CASE
    WHEN r.title IN (SELECT title FROM keep_allowlist) THEN 'KEEP (allowlist)'
    WHEN count(*) >= 2 THEN 'FIXTURE -> archive'
    ELSE 'keep (singleton)'
  END AS verdict
FROM req r
GROUP BY r.title, r.opener_body
ORDER BY verdict DESC, copies DESC, r.title;
```

**Stop and read the output.** Confirm `distinct_groups` ≈ 51 and that every `FIXTURE -> archive`
row is genuinely a fixture (nothing you actually filed). Confirm the genuine singleton shows
`keep (singleton)` or `KEEP (allowlist)`. If anything looks real, add its title to the allowlist
and re-run — do not proceed until the verdict column is clean.

## Step 2 — Archive them (reversible; recommended)

Self-contained and copy-paste runnable. Re-stages the allowlist, materializes the fixture ids
into a temp table (identical criterion to Step 1 — a CTE attaches to only one statement, so we
stage the ids so this and every later step can reuse them), then archives inside a transaction
you can `ROLLBACK`.

```sql
-- (Step 2) Archive the fixtures (reversible). Standalone.
DROP TABLE IF EXISTS temp.keep_allowlist;
CREATE TEMP TABLE keep_allowlist(title TEXT NOT NULL);
INSERT INTO keep_allowlist(title) VALUES
  ('Request: Planned Work Routine');           -- OWNER: keep in sync with Step 1.

DROP TABLE IF EXISTS temp.fixture_ids;
CREATE TEMP TABLE fixture_ids AS
WITH opener AS (
  SELECT m.conversation_id AS cid, m.body AS body,
         ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.at ASC, m.id ASC) AS rn
  FROM conversation_messages m
),
req AS (
  SELECT c.id, c.title, o.body AS opener_body
  FROM conversations c JOIN opener o ON o.cid = c.id AND o.rn = 1
  WHERE c.kind = 'request'
),
grp AS (
  SELECT title, opener_body FROM req
  GROUP BY title, opener_body HAVING count(*) >= 2
)
SELECT r.id AS id
FROM req r
JOIN grp g ON g.title = r.title AND g.opener_body = r.opener_body
WHERE r.title NOT IN (SELECT title FROM keep_allowlist);

-- Sanity: this should match Step 1's fixtures_total.
SELECT count(*) AS staged_fixture_ids FROM fixture_ids;

-- Archive (reversible) inside a transaction.
BEGIN;
UPDATE conversations
SET archived_at = CAST(strftime('%s','now') AS INTEGER) * 1000,   -- ms epoch, matches app writes
    updated_at  = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id IN (SELECT id FROM fixture_ids) AND archived_at IS NULL;
-- Verify the changed-row count matches `fixtures_not_yet_archived` from Step 1, then:
COMMIT;   -- or ROLLBACK; if it doesn't match
```

After COMMIT, re-run Step 1(a): `fixtures_not_yet_archived` should be `0`. The sweep is now clean.

## Step 3 — Confirm the sweep is clean

From the routine's environment (or locally pointed at the store, read-only), the sweep should
return only genuine requests:

```sh
# In scope-creep-console, with the store env set (node@22):
PATH=/opt/homebrew/opt/node@22/bin:$PATH bun run triage -- --dry-run   # inspect the swept set
```

Expect zero fixture titles in the output — ideally only `"Request: Planned Work Routine"` (and
any other genuine requests you have filed).

## Optional hard-delete (irreversible — only after you're satisfied)

Only if you want the rows physically gone and you have the Step 0 backup. Self-contained: it
rebuilds `fixture_ids` (same criterion), then deletes children first (no FK cascade in this
schema — `conversation_messages.conversation_id` is a plain column).

```sql
-- (Optional hard-delete) IRREVERSIBLE. Standalone.
DROP TABLE IF EXISTS temp.keep_allowlist;
CREATE TEMP TABLE keep_allowlist(title TEXT NOT NULL);
INSERT INTO keep_allowlist(title) VALUES
  ('Request: Planned Work Routine');           -- OWNER: keep in sync with Step 1.

DROP TABLE IF EXISTS temp.fixture_ids;
CREATE TEMP TABLE fixture_ids AS
WITH opener AS (
  SELECT m.conversation_id AS cid, m.body AS body,
         ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.at ASC, m.id ASC) AS rn
  FROM conversation_messages m
),
req AS (
  SELECT c.id, c.title, o.body AS opener_body
  FROM conversations c JOIN opener o ON o.cid = c.id AND o.rn = 1
  WHERE c.kind = 'request'
),
grp AS (
  SELECT title, opener_body FROM req
  GROUP BY title, opener_body HAVING count(*) >= 2
)
SELECT r.id AS id
FROM req r
JOIN grp g ON g.title = r.title AND g.opener_body = r.opener_body
WHERE r.title NOT IN (SELECT title FROM keep_allowlist);

-- Sanity before deleting: confirm the id count is what you expect.
SELECT count(*) AS staged_fixture_ids FROM fixture_ids;

BEGIN;
DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM fixture_ids);
DELETE FROM thread_reads          WHERE conversation_id IN (SELECT id FROM fixture_ids);
DELETE FROM conversations         WHERE id            IN (SELECT id FROM fixture_ids);
COMMIT;   -- or ROLLBACK;
```

This is INVARIANTS §III/§10 territory: irreversible + destructive → your call, your keystroke,
backed up.

## Reversal

- Archived (Step 2): re-stage `fixture_ids` (the temp-table block from Step 2), then
  `UPDATE conversations SET archived_at = NULL WHERE id IN (SELECT id FROM fixture_ids);` — or
  just use the app's Restore action per thread.
- Hard-deleted (optional): restore from the Step 0 `.dump`.

---

## Appendix — fallback exact-pair list (known-incomplete; cross-check only)

Kept for auditors who prefer a hand-enumerated set. **This list is deliberately NOT the primary
criterion** — the CoS re-audit proved it incomplete (it missed the route-entrypoints,
work-sweep, and org-initiated fixture shapes). Prefer the dedup criterion above. To use it,
replace the `grp`/`fixture_ids` derivation in Steps 1/2 with a join to this `VALUES` set on the
opener body (`role='owner', type='message'`). Note it will still miss org-initiated fixtures
(opener `role='agent'`), which is exactly why the dedup criterion supersedes it.

```sql
WITH fixture(title, body) AS (
  VALUES
    -- app/lib/triage.server.test.ts
    ('Old ask', 'please do X'), ('FYI path', 'test'), ('Judgment path', 'test'), ('Close it', 'test'),
    ('Add a dark mode toggle', 'Please add dark mode.'),
    -- app/lib/threads.server.test.ts
    ('Ship the queue', 'Please build the needs-you queue.'), ('A question', 'What should we prioritize?'),
    ('Done thing', 'Thanks!'), ('Roadmap', 'Let''s talk Q4 priorities.'), ('Keep working', 'Please keep building.'),
    ('P', '…'), ('Solo', 'No branches here.'), ('New idea', 'Could we branch tangents into threads?'),
    ('Idea 2', 'Another one.'), ('Launch me', 'Give me a State of the Product.'),
    ('Edit at launch', 'First draft of the ask.'), ('Correlate me', 'Do a thing.'), ('Fresh', 'Nothing launched yet.'),
    ('Wrap it up', 'This one is done — tuck it away.'), ('Closed then archived', 'Done and away.'),
    ('Stay visible', 'Keep me on the board.'), ('Hide me', 'Off the board, please.'),
    ('Round trip', 'Archive then restore me.'), ('Build the loop', 'Please build the request loop.'),
    ('Scope call', 'Kick this off.'), ('Sessionless', 'No Claude session launched here.'), ('Override', '…'),
    ('Read me', 'Owner opens this.'), ('Re-raise', '…'), ('Notif A', '…'), ('Notif B', '…'),
    ('Clear flag', '…'), ('Archive from notif', '…'),
    ('Theme 2 as its own effort', 'Theme 2 deserves its own thread — let''s scope it.'),
    ('Tangent', 'A side thought.'), ('Child', 'Scope this.'),
    -- app/lib/human-input.server.test.ts
    ('a work request', 'a work request'),
    -- app/routes/route-entrypoints.test.ts (previously-missed)
    ('A test thread', 'Please do the thing.'), ('Parent', 'Let''s discuss.'),
    ('A tangent', 'This deserves its own thread.'), ('Parent 2', '…'),
    ('Launch flow', 'Give me a State of the Product.'), ('Archive me via route', 'Please tuck this away.'),
    ('Round-trip via route', 'Archive then restore.'),
    -- app/lib/work-sweep.server.test.ts (previously-missed)
    ('Loop milestone', 'please review')
    -- NB: org-initiated fixtures (opener role='agent') are NOT here and CANNOT be matched by an
    --     owner-opener join — e.g. ('Org opener','The org needs your call.'),
    --     ('FYI','Heads up on the design pin.'), ('Need input','Please decide.'),
    --     ('Parked A','…'), ('Need your call on model spend','The nightly crank is nearing the token budget…').
    --     The dedup criterion (role-agnostic opener) is the only thing that catches these.
)
SELECT * FROM fixture;
```
