CREATE TABLE `edits` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`request_id` text NOT NULL,
	`conversation_id` text,
	`workspace` text NOT NULL,
	`files` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_edits_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_edits_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `edits_conversation_created_idx` ON `edits` (`conversation_id`,`created_at`);