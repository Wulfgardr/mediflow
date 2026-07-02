/* @Codex */
ALTER TABLE `patients` ADD COLUMN `ai_summary_generated_at` integer;
ALTER TABLE `patients` ADD COLUMN `ai_summary_context_hash` text;

ALTER TABLE `observations` ADD COLUMN `ref_low` text;
ALTER TABLE `observations` ADD COLUMN `ref_high` text;
ALTER TABLE `observations` ADD COLUMN `ref_text` text;
