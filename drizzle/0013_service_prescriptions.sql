/* @Codex */
CREATE TABLE `service_prescriptions` (
    `id` text PRIMARY KEY NOT NULL,
    `patient_id` text NOT NULL,
    `prescribed_at` integer NOT NULL,
    `status` text NOT NULL DEFAULT 'prescribed',
    `category` text NOT NULL DEFAULT 'other',
    `priority` text,
    `code_system` text,
    `service_code` text,
    `service_name` text NOT NULL,
    `clinical_question` text,
    `provider` text,
    `scheduled_at` integer,
    `performed_at` integer,
    `report_received_at` integer,
    `outcome_note` text,
    `request_reference` text,
    `source` text NOT NULL DEFAULT 'manual',
    `document_refs` text,
    `notes` text,
    `created_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch()),
    FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`)
);

CREATE INDEX `service_prescriptions_patient_idx` ON `service_prescriptions` (`patient_id`);
CREATE INDEX `service_prescriptions_prescribed_idx` ON `service_prescriptions` (`prescribed_at` DESC);
CREATE INDEX `service_prescriptions_status_idx` ON `service_prescriptions` (`status`);
CREATE INDEX `service_prescriptions_category_idx` ON `service_prescriptions` (`category`);
