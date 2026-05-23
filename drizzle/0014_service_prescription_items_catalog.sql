/* @Codex */
CREATE TABLE `service_prescription_items` (
    `id` text PRIMARY KEY NOT NULL,
    `patient_id` text NOT NULL,
    `prescription_id` text NOT NULL,
    `ordinal` integer NOT NULL DEFAULT 0,
    `status` text NOT NULL DEFAULT 'prescribed',
    `category` text,
    `code_system` text,
    `service_code` text,
    `service_name` text NOT NULL,
    `catalog_entry_id` text,
    `catalog_display_name` text,
    `match_status` text NOT NULL DEFAULT 'unmatched',
    `confidence` text,
    `evidence` text,
    `notes` text,
    `scheduled_at` integer,
    `performed_at` integer,
    `report_received_at` integer,
    `outcome_note` text,
    `created_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch()),
    FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`),
    FOREIGN KEY (`prescription_id`) REFERENCES `service_prescriptions`(`id`)
);

CREATE INDEX `service_prescription_items_patient_idx` ON `service_prescription_items` (`patient_id`);
CREATE INDEX `service_prescription_items_prescription_idx` ON `service_prescription_items` (`prescription_id`);
CREATE INDEX `service_prescription_items_order_idx` ON `service_prescription_items` (`prescription_id`, `ordinal`);
CREATE INDEX `service_prescription_items_status_idx` ON `service_prescription_items` (`status`);
CREATE INDEX `service_prescription_items_code_idx` ON `service_prescription_items` (`code_system`, `service_code`);

INSERT INTO `service_prescription_items` (
    `id`,
    `patient_id`,
    `prescription_id`,
    `ordinal`,
    `status`,
    `category`,
    `code_system`,
    `service_code`,
    `service_name`,
    `match_status`,
    `scheduled_at`,
    `performed_at`,
    `report_received_at`,
    `outcome_note`,
    `notes`,
    `created_at`,
    `updated_at`
)
SELECT
    `id` || ':item:0`,
    `patient_id`,
    `id`,
    0,
    `status`,
    `category`,
    `code_system`,
    `service_code`,
    `service_name`,
    CASE
        WHEN `service_code` IS NOT NULL AND trim(`service_code`) <> '' THEN 'manual'
        ELSE 'unmatched'
    END,
    `scheduled_at`,
    `performed_at`,
    `report_received_at`,
    `outcome_note`,
    `notes`,
    COALESCE(`created_at`, unixepoch()),
    COALESCE(`updated_at`, unixepoch())
FROM `service_prescriptions`
WHERE NOT EXISTS (
    SELECT 1 FROM `service_prescription_items`
    WHERE `service_prescription_items`.`prescription_id` = `service_prescriptions`.`id`
);

CREATE TABLE `service_catalog_entries` (
    `id` text PRIMARY KEY NOT NULL,
    `code_system` text NOT NULL,
    `service_code` text NOT NULL,
    `display_name` text NOT NULL,
    `category` text NOT NULL DEFAULT 'other',
    `branch_code` text,
    `synonyms` text,
    `source` text NOT NULL DEFAULT 'manual',
    `version` text,
    `active` integer NOT NULL DEFAULT 1,
    `imported_at` integer DEFAULT (unixepoch()),
    `updated_at` integer DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX `service_catalog_entries_code_idx` ON `service_catalog_entries` (`code_system`, `service_code`);
CREATE INDEX `service_catalog_entries_display_idx` ON `service_catalog_entries` (`display_name`);
CREATE INDEX `service_catalog_entries_category_idx` ON `service_catalog_entries` (`category`);
