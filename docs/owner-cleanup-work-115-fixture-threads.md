# Owner-gated cleanup — work-115 fixture-thread contamination

**Status:** proposed (Owner-gated). **Do not run the destructive steps autonomously.**
**Author:** CTO, via work-115. **Repo:** scope-creep-console.

## What this is

The request-triage sweep was returning ~200 threads that are verbatim **console test
fixtures** (e.g. `Add a dark mode toggle` / `Please add dark mode.`). Root cause: a test run
resolved the DB to the **remote Turso store** instead of `:memory:` (an ambient
`SCOPE_CREEP_DB_URL`/token out-precedenced the `DATABASE_URL=:memory:` pin), so
`createThread(...)` and friends wrote their fixtures into the **shared** store the routine
reads. The leak is closed in code (this PR: `vitest.config.ts` env pins + `test/guard-local-db.ts`
belt). **This document covers removing the rows already in the store.**

Per INVARIANTS §III ("propose, never dispose") and §10 ("every change is reversible"), a
delete against the shared store is **Owner-gated**. The routine only ever *flags*; it never
deletes. This spec gives you an identify → preview → **archive (reversible)** path, with a
hard-delete offered only as an optional, backed-up, explicitly-confirmed follow-up.

## Recommendation: ARCHIVE, don't delete

**Archive the fixture threads** (`UPDATE ... SET archived_at = <now>`), do not hard-delete.

- Archiving is **fully reversible** — `restoreThread()` (or `SET archived_at = NULL`) brings a
  thread back exactly as it was. Hard-delete is not reversible (INVARIANTS §10).
- Archived threads are **already excluded from the sweep** (`listNewRequestThreads` filters
  `isNull(conversations.archivedAt)`) **and** from the main Threads UI and unread/notification
  counts. So archiving fully stops the budget burn and the noise **without destroying data**.
- The only cost is ~200 junk rows sitting in the Archive view. If that bothers you, a
  hard-delete can follow later (§ "Optional hard-delete"), once you've confirmed the archived
  set is exactly the fixtures and nothing real.

This is belt-and-suspenders with the runtime `FIXTURE_DENYLIST` in `app/lib/triage.server.ts`:
even an un-archived leftover would be skipped by the sweep, but archiving removes it from every
surface, reversibly.

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

Fixtures are `kind='request'` conversations whose opener (`role='owner'`, `type='message'`)
matches an **exact `title` + `body` pair** from the known-fixture set (the same set the
`FIXTURE_DENYLIST` uses — matching the full pair, never title alone, is what guarantees no
genuine Owner request is caught). This preview is safe to run repeatedly.

```sql
-- Known console test-fixture (title, body) pairs — from
-- app/lib/{triage,threads,human-input}.server.test.ts. Single quotes are doubled for SQL.
WITH fixture(title, body) AS (
  VALUES
    ('Add a dark mode toggle', 'Please add dark mode.'),
    ('Wire the badge', 'Build the unread badge.'),
    ('Old ask', 'please do X'),
    ('First', '1'),
    ('Second', '2'),
    ('Dry one', 'test'),
    ('FYI path', 'test'),
    ('Judgment path', 'test'),
    ('Close it', 'test'),
    ('Ship the queue', 'Please build the needs-you queue.'),
    ('A question', 'What should we prioritize?'),
    ('Done thing', 'Thanks!'),
    ('Roadmap', 'Let''s talk Q4 priorities.'),
    ('Keep working', 'Please keep building.'),
    ('P', '…'),
    ('Solo', 'No branches here.'),
    ('New idea', 'Could we branch tangents into threads?'),
    ('Idea 2', 'Another one.'),
    ('Launch me', 'Give me a State of the Product.'),
    ('Edit at launch', 'First draft of the ask.'),
    ('Correlate me', 'Do a thing.'),
    ('Fresh', 'Nothing launched yet.'),
    ('Wrap it up', 'This one is done — tuck it away.'),
    ('Closed then archived', 'Done and away.'),
    ('Stay visible', 'Keep me on the board.'),
    ('Hide me', 'Off the board, please.'),
    ('Round trip', 'Archive then restore me.'),
    ('Build the loop', 'Please build the request loop.'),
    ('Scope call', 'Kick this off.'),
    ('Sessionless', 'No Claude session launched here.'),
    ('Override', '…'),
    ('Read me', 'Owner opens this.'),
    ('Re-raise', '…'),
    ('Notif A', '…'),
    ('Notif B', '…'),
    ('Clear flag', '…'),
    ('Archive from notif', '…'),
    ('Theme 2 as its own effort', 'Theme 2 deserves its own thread — let''s scope it.'),
    ('Tangent', 'A side thought.'),
    ('Child', 'Scope this.'),
    ('a work request', 'a work request')
),
-- The opener message for each conversation (first owner text message by timestamp).
opener AS (
  SELECT m.conversation_id AS cid, m.body AS body,
         ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.at ASC, m.id ASC) AS rn
  FROM conversation_messages m
  WHERE m.role = 'owner' AND m.type = 'message'
),
fixture_convos AS (
  SELECT c.id, c.kind, c.title, c.status, c.archived_at, o.body AS opener_body
  FROM conversations c
  JOIN opener o ON o.cid = c.id AND o.rn = 1
  JOIN fixture f ON f.title = c.title AND f.body = o.body
  WHERE c.kind = 'request'
)
-- (a) the count you expect to be ~200:
SELECT count(*) AS fixture_thread_count,
       sum(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS not_yet_archived
FROM fixture_convos;
-- (b) eyeball them before doing anything:
--   SELECT id, title, opener_body, status, archived_at FROM fixture_convos ORDER BY id;
```

**Stop and read the output.** Confirm the count is in the expected ~200 range and that every
row is a fixture (nothing you actually filed). If anything looks like a real request, do not
proceed — adjust the pair list or narrow the query and re-preview.

> Note: I did **not** run this count against the live store from the work-115 session — I have
> no remote credentials in-session and connecting to the shared store is Owner territory. The
> "~200" figure is from the ticket / the routine's two prior runs (closed PRs #100, #104). Run
> Step 1 to get the exact current number.

## Step 2 — Archive them (reversible; recommended)

Run inside a transaction so you can `ROLLBACK` if the count surprises you.

```sql
BEGIN;
-- Reuse the same CTEs as Step 1 (fixture / opener / fixture_convos), then:
UPDATE conversations
SET archived_at = CAST(strftime('%s','now') AS INTEGER) * 1000,   -- ms epoch, matches app writes
    updated_at  = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id IN (SELECT id FROM fixture_convos WHERE archived_at IS NULL);
-- Verify the number of changed rows matches `not_yet_archived` from Step 1, then:
COMMIT;   -- or ROLLBACK; if it doesn't match
```

After COMMIT, re-run Step 1(a): `not_yet_archived` should be `0`. The sweep is now clean.

## Step 3 — Confirm the sweep is clean

From the routine's environment (or locally pointed at the store, read-only), the sweep should
return only genuine requests:

```sh
# In scope-creep-console, with the store env set (node@22):
PATH=/opt/homebrew/opt/node@22/bin:$PATH bun run triage -- --dry-run   # inspect the swept set
```

Expect zero fixture titles in the output.

## Optional hard-delete (irreversible — only after you're satisfied)

Only if you want the rows physically gone and you have the Step 0 backup. Delete children first
(no FK cascade in this schema — `conversation_messages.conversation_id` is a plain column).

```sql
BEGIN;
-- messages belonging to fixture conversations
DELETE FROM conversation_messages
WHERE conversation_id IN (SELECT id FROM fixture_convos);
-- thread read-state rows, if any
DELETE FROM thread_reads
WHERE conversation_id IN (SELECT id FROM fixture_convos);
-- the conversations themselves
DELETE FROM conversations
WHERE id IN (SELECT id FROM fixture_convos);
COMMIT;   -- or ROLLBACK;
```

(Re-declare the CTEs from Step 1 above each statement, or materialize the id list into a temp
table first.) This is INVARIANTS §III/§10 territory: irreversible + destructive → your call,
your keystroke, backed up.

## Reversal

- Archived (Step 2): `UPDATE conversations SET archived_at = NULL WHERE id IN (...);` or the
  app's Restore action.
- Hard-deleted (optional): restore from the Step 0 `.dump`.
