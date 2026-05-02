/* @Codex */
ALTER TABLE `therapies` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `therapies` ADD COLUMN `updated_at` integer;
--> statement-breakpoint
ALTER TABLE `therapies` ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `therapies` ADD COLUMN `deletion_reason` text;
