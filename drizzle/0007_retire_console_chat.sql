-- ADR-019: retire the legacy `kind:"chat"` "Console chat" seed conversation.
-- It was created by getOrCreateConversation("chat","Console chat") (removed with the chat
-- routes). CoS-Threads (ADR-012) projects every non-archived conversation as a thread, so
-- the seed kept re-appearing in /threads. Archive it (reversible, non-destructive: the row
-- and its messages are preserved and restorable via /threads/archive) so it leaves the main
-- Threads UI, its groupings, and the home "waiting on you" badge. Idempotent — a no-op when
-- the row is absent or already archived.
UPDATE `conversations`
SET `archived_at` = (unixepoch() * 1000), `updated_at` = (unixepoch() * 1000)
WHERE `kind` = 'chat' AND `title` = 'Console chat' AND `archived_at` IS NULL;
