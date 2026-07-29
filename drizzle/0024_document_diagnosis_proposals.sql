/* @Codex */
CREATE TABLE `document_diagnosis_proposals` (
    `id` text PRIMARY KEY NOT NULL,
    `patient_id` text NOT NULL,
    `source_document_key` text NOT NULL,
    `attachment_id` text,
    `document_insight_id` text,
    `candidate_key` text NOT NULL,
    `payload` text NOT NULL,
    `status` text NOT NULL DEFAULT 'pending',
    `confidence` text NOT NULL,
    `decided_at` integer,
    `decision_actor_type` text,
    `decision_actor_ref` text,
    `decision_payload` text,
    `version` integer NOT NULL DEFAULT 1,
    `created_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch()),
    FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`)
);
--> statement-breakpoint
CREATE INDEX `document_diagnosis_proposals_patient_idx` ON `document_diagnosis_proposals` (`patient_id`);
--> statement-breakpoint
CREATE INDEX `document_diagnosis_proposals_patient_status_idx` ON `document_diagnosis_proposals` (`patient_id`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_diagnosis_proposals_source_candidate_unique` ON `document_diagnosis_proposals` (`patient_id`, `source_document_key`, `candidate_key`);
