/* @Codex */
ALTER TABLE `drugs` ADD COLUMN `aic_search` text;
--> statement-breakpoint
ALTER TABLE `drugs` ADD COLUMN `name_search` text;
--> statement-breakpoint
ALTER TABLE `drugs` ADD COLUMN `active_principle_search` text;
--> statement-breakpoint
CREATE INDEX `drugs_aic_search_idx` ON `drugs` (`aic_search`);
--> statement-breakpoint
CREATE INDEX `drugs_name_search_idx` ON `drugs` (`name_search`);
--> statement-breakpoint
CREATE INDEX `drugs_active_principle_search_idx` ON `drugs` (`active_principle_search`);
