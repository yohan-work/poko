-- Phase 07: a conversation is titled from its first user message.
UPDATE `conversations` SET `title` = substr(trim((SELECT `content` FROM `messages` WHERE `messages`.`conversation_id` = `conversations`.`id` AND `messages`.`role` = 'user' ORDER BY `messages`.`created_at` LIMIT 1)), 1, 40) WHERE EXISTS (SELECT 1 FROM `messages` WHERE `messages`.`conversation_id` = `conversations`.`id` AND `messages`.`role` = 'user');--> statement-breakpoint
-- Conversations are created only with their first message; drop the auto-created empty ones.
DELETE FROM `conversations` WHERE NOT EXISTS (SELECT 1 FROM `messages` WHERE `messages`.`conversation_id` = `conversations`.`id`);
