CREATE TABLE `approvals` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`request_id` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`cwd` text,
	`reason` text,
	`decision` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	CONSTRAINT `fk_approvals_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `approvals_task_created_idx` ON `approvals` (`task_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_task_request_unique_idx` ON `approvals` (`task_id`,`request_id`);