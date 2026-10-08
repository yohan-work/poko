ALTER TABLE `conversations` ADD `workspace_path` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `workspace_path` text;--> statement-breakpoint
UPDATE `conversations` SET `workspace_path` = (
	SELECT `t`.`workspace` FROM `tasks` `t`
	WHERE `t`.`conversation_id` = `conversations`.`id` AND `t`.`workspace` LIKE '/%'
	ORDER BY `t`.`created_at` DESC, `t`.`rowid` DESC LIMIT 1
);
--> statement-breakpoint
UPDATE `conversations` SET `workspace_path` = (
	SELECT `r`.`workspace_path` FROM `routines` `r` WHERE `r`.`conversation_id` = `conversations`.`id` LIMIT 1
) WHERE `workspace_path` IS NULL AND EXISTS (
	SELECT 1 FROM `routines` `r` WHERE `r`.`conversation_id` = `conversations`.`id`
);
