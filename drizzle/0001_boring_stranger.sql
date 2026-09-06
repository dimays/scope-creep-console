-- work-029 / ADR-012: unify Chat + Requests on the conversation primitive.
-- Data-preserving migration: add the new thread columns, copy the legacy
-- requests/request_messages into conversations/conversation_messages, then retire the
-- old tables. The temp `legacy_request_id` column is added and dropped inside this
-- migration, so the final shape matches schema.ts (the drizzle snapshot).

-- 1) New columns (additive) -------------------------------------------------------
ALTER TABLE `conversation_messages` ADD `type` text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversation_messages` ADD `meta` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `legacy_request_id` integer;--> statement-breakpoint

-- 2) requests -> conversations (kind='request'; map intake status -> thread lifecycle)
INSERT INTO `conversations` (`kind`, `title`, `status`, `created_at`, `updated_at`, `legacy_request_id`)
  SELECT 'request', `title`,
    CASE `status`
      WHEN 'done' THEN 'closed'
      WHEN 'declined' THEN 'closed'
      WHEN 'needs-info' THEN 'needs-you'
      WHEN 'accepted' THEN 'working'
      ELSE 'working'
    END,
    `created_at`, `updated_at`, `id`
  FROM `requests`;--> statement-breakpoint

-- 3) request_messages -> conversation_messages (author 'owner' -> role 'owner'; any
--    other author -> role 'agent', preserving the original label in meta JSON).
INSERT INTO `conversation_messages` (`conversation_id`, `role`, `type`, `body`, `meta`, `at`)
  SELECT c.`id`,
    CASE WHEN rm.`author` = 'owner' THEN 'owner' ELSE 'agent' END,
    'message',
    rm.`body`,
    CASE WHEN rm.`author` = 'owner' THEN NULL
         ELSE '{"author":"' || replace(rm.`author`, '"', '') || '"}' END,
    rm.`at`
  FROM `request_messages` rm
  JOIN `conversations` c ON c.`legacy_request_id` = rm.`request_id`;--> statement-breakpoint

-- 4) Retire the legacy surface ----------------------------------------------------
ALTER TABLE `conversations` DROP COLUMN `legacy_request_id`;--> statement-breakpoint
DROP TABLE `request_messages`;--> statement-breakpoint
DROP TABLE `requests`;
