/* @Codex */
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`code_system` text NOT NULL,
	`code` text NOT NULL,
	`display` text NOT NULL,
	`unit_system` text NOT NULL,
	`unit_code` text NOT NULL,
	`value` text NOT NULL,
	`notes` text,
	`observed_at` integer NOT NULL,
	`source` text DEFAULT 'manual',
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
/* @Codex */
CREATE INDEX `observations_patient_idx` ON `observations` (`patient_id`);
--> statement-breakpoint
/* @Codex */
CREATE INDEX `observations_code_idx` ON `observations` (`code_system`, `code`);
