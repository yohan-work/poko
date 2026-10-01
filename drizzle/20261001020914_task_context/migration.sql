ALTER TABLE `tasks` ADD `conversation_id` text REFERENCES conversations(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `result` text;--> statement-breakpoint
CREATE INDEX `tasks_conversation_created_idx` ON `tasks` (`conversation_id`,`created_at`);--> statement-breakpoint
-- Backfill: before this migration there was only one conversation.
UPDATE `tasks` SET `conversation_id` = (SELECT `id` FROM `conversations` ORDER BY `created_at` LIMIT 1) WHERE `conversation_id` IS NULL;--> statement-breakpoint
-- Backfill: a completed task's answer was written in the same transaction, with the same timestamp.
UPDATE `tasks` SET `result` = (SELECT `content` FROM `messages` WHERE `messages`.`role` = 'assistant' AND `messages`.`created_at` = `tasks`.`completed_at` LIMIT 1) WHERE `status` = 'completed' AND `result` IS NULL;
