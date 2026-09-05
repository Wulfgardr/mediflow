/* @Codex */
-- P0 normalizes the fresh Drizzle baseline only. Live database upgrades remain
-- owned by applySchemaGuards() until O1b changes that operational boundary.
ALTER TABLE `attachments` ADD COLUMN `summary_snapshot` TEXT;
--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `parse_evidence_artifact_snapshot` TEXT;
--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `ocr_queue_state` TEXT;
--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `ocr_queue_reason` TEXT;
--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `ocr_queue_updated_at` INTEGER;
--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `ocr_replay_artifact_snapshot` TEXT;
