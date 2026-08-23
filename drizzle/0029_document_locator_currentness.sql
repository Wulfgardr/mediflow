/* @Codex */
-- O1a rebuilds only the P0-normalized fresh baseline. O1b owns the live guard.
BEGIN IMMEDIATE;

ALTER TABLE `attachments` RENAME TO `attachments_0029_legacy`;

CREATE TABLE `attachments` (
    `id` TEXT PRIMARY KEY NOT NULL,
    `patient_id` TEXT NOT NULL,
    `name` TEXT NOT NULL,
    `type` TEXT NOT NULL,
    `size` INTEGER NOT NULL,
    `path` TEXT NOT NULL,
    `data` TEXT,
    `summary_snapshot` TEXT,
    `parse_evidence_artifact_snapshot` TEXT,
    `ocr_queue_state` TEXT,
    `ocr_queue_reason` TEXT,
    `ocr_queue_updated_at` INTEGER,
    `ocr_replay_artifact_snapshot` TEXT,
    `created_at` INTEGER DEFAULT (unixepoch()),
    `document_source_ref` TEXT NOT NULL UNIQUE CHECK (
        length(`document_source_ref`) = 64
        AND `document_source_ref` NOT GLOB '*[^0-9a-f]*'
    ),
    `document_revision` INTEGER NOT NULL CHECK (
        typeof(`document_revision`) = 'integer' AND `document_revision` >= 1
    ),
    `document_freshness_epoch` INTEGER NOT NULL CHECK (
        typeof(`document_freshness_epoch`) = 'integer' AND `document_freshness_epoch` >= 1
    ),
    FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);

INSERT OR ROLLBACK INTO `attachments` (
    `id`, `patient_id`, `name`, `type`, `size`, `path`, `data`,
    `summary_snapshot`, `parse_evidence_artifact_snapshot`, `ocr_queue_state`,
    `ocr_queue_reason`, `ocr_queue_updated_at`, `ocr_replay_artifact_snapshot`, `created_at`,
    `document_source_ref`, `document_revision`, `document_freshness_epoch`
)
SELECT
    `id`, `patient_id`, `name`, `type`, `size`, `path`, `data`,
    `summary_snapshot`, `parse_evidence_artifact_snapshot`, `ocr_queue_state`,
    `ocr_queue_reason`, `ocr_queue_updated_at`, `ocr_replay_artifact_snapshot`, `created_at`,
    lower(hex(randomblob(32))), 1, 1
FROM `attachments_0029_legacy`;

DROP TABLE `attachments_0029_legacy`;
CREATE INDEX `attachments_patient_idx` ON `attachments` (`patient_id`);

COMMIT;
