/* @Codex */
ALTER TABLE `checkups` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `checkups` ADD COLUMN `updated_at` integer;
--> statement-breakpoint
ALTER TABLE `checkups` ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `checkups` ADD COLUMN `deletion_reason` text;
