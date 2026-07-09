ALTER TABLE `service_prescriptions` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `service_prescription_items` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `prosthetic_prescriptions` ADD `version` integer DEFAULT 1 NOT NULL;
