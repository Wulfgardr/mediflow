/* @Codex */
CREATE TABLE `siss_handoff_events` (
    `id` text PRIMARY KEY NOT NULL,
    `patient_id` text NOT NULL,
    `action` text NOT NULL,
    `module_label` text NOT NULL,
    `reason` text,
    `started_at` integer NOT NULL,
    `completed_at` integer,
    `outcome` text NOT NULL DEFAULT 'started',
    `next_action` text,
    `notes` text,
    `correlation_id` text,
    `created_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch()),
    FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`)
);

CREATE INDEX `siss_handoff_events_patient_idx` ON `siss_handoff_events` (`patient_id`);
CREATE INDEX `siss_handoff_events_started_idx` ON `siss_handoff_events` (`started_at` DESC);
CREATE INDEX `siss_handoff_events_outcome_idx` ON `siss_handoff_events` (`outcome`);
