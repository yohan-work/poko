ALTER TABLE `conversations` ADD `workspace_path` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `workspace_path` text;--> statement-breakpoint
UPDATE `conversations` SET `workspace_path` = (
	SELECT `t`.`workspace` FROM `tasks` `t`
	WHERE `t`.`conversation_id` = `conversations`.`id` AND `t`.`workspace` LIKE '/%'
	ORDER BY `t`.`created_at` DESC, `t`.`rowid` DESC LIMIT 1
);
