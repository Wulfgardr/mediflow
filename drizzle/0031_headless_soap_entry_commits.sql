/* @Codex */
CREATE TABLE `headless_soap_entry_commits` (
    `idempotency_key` text PRIMARY KEY NOT NULL,
    `approval_ref` text NOT NULL,
    `authorization_proof_digest` text NOT NULL,
    `command_id` text NOT NULL,
    `entry_id` text NOT NULL REFERENCES `entries`(`id`) ON DELETE CASCADE,
    `audit_event_id` text NOT NULL REFERENCES `audit_events`(`event_id`) ON DELETE RESTRICT,
    `receipt_ref` text NOT NULL,
    `binding_snapshot` text NOT NULL,
    `binding_digest` text NOT NULL,
    `entry_digest` text NOT NULL,
    `audit_snapshot` text NOT NULL,
    `audit_digest` text NOT NULL,
    `receipt_snapshot` text NOT NULL,
    `receipt_digest` text NOT NULL,
    `committed_at` integer NOT NULL
);
CREATE UNIQUE INDEX `headless_soap_entry_commits_command_id_unique`
    ON `headless_soap_entry_commits` (`command_id`);
CREATE UNIQUE INDEX `headless_soap_entry_commits_entry_id_unique`
    ON `headless_soap_entry_commits` (`entry_id`);
CREATE UNIQUE INDEX `headless_soap_entry_commits_audit_event_id_unique`
    ON `headless_soap_entry_commits` (`audit_event_id`);
CREATE UNIQUE INDEX `headless_soap_entry_commits_receipt_ref_unique`
    ON `headless_soap_entry_commits` (`receipt_ref`);
