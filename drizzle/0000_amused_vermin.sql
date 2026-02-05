CREATE TABLE `ambulatories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`parent_id` text,
	`type` text DEFAULT 'live',
	`description` text,
	`is_default` integer DEFAULT false,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `checkups` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`date` integer NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'pending',
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()),
	`is_archived` integer DEFAULT false,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `drugs` (
	`aic` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active_principle` text,
	`company` text,
	`packaging` text,
	`class` text,
	`price` integer,
	`atc` text
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`type` text NOT NULL,
	`date` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`attachment_type` text,
	`attachment_base64` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`tax_code` text NOT NULL,
	`birth_date` integer,
	`address` text,
	`phone` text,
	`caregiver` text,
	`notes` text,
	`ai_summary` text,
	`document_insights` text,
	`is_adi` integer DEFAULT false,
	`is_archived` integer DEFAULT false,
	`ambulatory_id` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`ambulatory_id`) REFERENCES `ambulatories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `patients_to_ambulatories` (
	`patient_id` text NOT NULL,
	`ambulatory_id` text NOT NULL,
	`assigned_at` integer DEFAULT (unixepoch()),
	PRIMARY KEY(`patient_id`, `ambulatory_id`),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ambulatory_id`) REFERENCES `ambulatories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `therapies` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`drug_name` text NOT NULL,
	`dosage` text NOT NULL,
	`status` text NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`ambulatory_name` text,
	`role` text DEFAULT 'user',
	`password_hash` text NOT NULL,
	`encrypted_master_key` text NOT NULL,
	`salt` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);