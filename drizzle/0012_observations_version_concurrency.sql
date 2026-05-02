/* @Codex */
ALTER TABLE `observations` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `observations` ADD COLUMN `updated_at` integer;
--> statement-breakpoint
ALTER TABLE `observations` ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `observations` ADD COLUMN `deletion_reason` text;
