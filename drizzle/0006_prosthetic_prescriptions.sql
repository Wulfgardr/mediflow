/* @Codex */
CREATE TABLE `prosthetic_prescriptions` (
    `id` text PRIMARY KEY NOT NULL,
    `patient_id` text NOT NULL,
    `prescribed_at` integer NOT NULL,
    `status` text NOT NULL DEFAULT 'prescribed',
    `category` text NOT NULL DEFAULT 'standard',
    `iso_code` text,
    `description` text NOT NULL,
    `measures` text,
    `clinical_reason` text,
    `regional_prescription_id` text,
    `supplier` text,
    `collaudo_at` integer,
    `collaudo_outcome` text,
    `source` text NOT NULL DEFAULT 'manual',
    `document_refs` text,
    `notes` text,
    `created_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch()),
    FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`)
);

CREATE INDEX `prosthetic_prescriptions_patient_idx` ON `prosthetic_prescriptions` (`patient_id`);
CREATE INDEX `prosthetic_prescriptions_prescribed_idx` ON `prosthetic_prescriptions` (`prescribed_at` DESC);
CREATE INDEX `prosthetic_prescriptions_status_idx` ON `prosthetic_prescriptions` (`status`);
