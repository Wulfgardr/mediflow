/* @Codex */
CREATE TABLE `audit_events` (
    `event_id` text PRIMARY KEY NOT NULL,
    `schema_version` integer NOT NULL DEFAULT 1,
    `event_type` text NOT NULL,
    `occurred_at` integer NOT NULL,
    `outcome` text NOT NULL,
    `actor_type` text NOT NULL,
    `actor_ref` text NOT NULL,
    `subject_type` text NOT NULL,
    `subject_ref` text,
    `source_surface` text NOT NULL,
    `request_id` text,
    `redacted_metadata` text,
    `created_at` integer DEFAULT (unixepoch())
);

CREATE INDEX `audit_events_occurred_idx` ON `audit_events` (`occurred_at` DESC);
CREATE INDEX `audit_events_type_idx` ON `audit_events` (`event_type`);
CREATE INDEX `audit_events_subject_idx` ON `audit_events` (`subject_type`, `subject_ref`);
CREATE INDEX `audit_events_actor_idx` ON `audit_events` (`actor_ref`);

CREATE TRIGGER `audit_events_no_update`
BEFORE UPDATE ON `audit_events`
BEGIN
    SELECT RAISE(ABORT, 'audit_events is append-only');
END;

CREATE TRIGGER `audit_events_no_delete`
BEFORE DELETE ON `audit_events`
BEGIN
    SELECT RAISE(ABORT, 'audit_events is append-only');
END;
