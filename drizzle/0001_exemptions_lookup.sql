/* @Codex */
ALTER TABLE `patients` ADD COLUMN `exemptions` text;
--> statement-breakpoint
/* @Codex */
CREATE TABLE `exemptions` (
	`code` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`type` text,
	`source` text,
	`start_date` integer,
	`end_date` integer,
	`is_pharma` integer,
	`is_specialist` integer,
	`is_national` integer,
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
/* @Codex */
CREATE INDEX `exemptions_code_idx` ON `exemptions` (`code`);
--> statement-breakpoint
/* @Codex */
CREATE INDEX `exemptions_type_idx` ON `exemptions` (`type`);
