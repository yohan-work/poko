CREATE TABLE `routines` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
	`workspace_path` text NOT NULL,
	`conversation_id` text,
	`enabled` integer NOT NULL,
	`schedule_changed_at` text NOT NULL,
	`last_slot_at` text,
	`last_run_at` text,
	`last_result` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_routines_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL
);
