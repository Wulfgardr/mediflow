/* @Codex */
ALTER TABLE `observations` ADD COLUMN `service_prescription_item_id` text REFERENCES `service_prescription_items`(`id`) ON DELETE SET NULL;
CREATE INDEX `observations_service_prescription_item_idx` ON `observations` (`service_prescription_item_id`);
