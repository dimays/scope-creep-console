ALTER TABLE `conversations` ADD `parent_id` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `branched_from_message_id` integer;