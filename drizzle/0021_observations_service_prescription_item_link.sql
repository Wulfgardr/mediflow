/* @Codex */
ALTER TABLE `observations` ADD COLUMN `service_prescription_item_id` text REFERENCES `service_prescription_items`(`id`);
