ALTER TABLE `entries` ADD COLUMN `title` text NOT NULL DEFAULT 'Voce clinica';
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `setting` text;
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `metadata` text;
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `attachments` text;
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `deletion_reason` text;
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `updated_at` integer;
