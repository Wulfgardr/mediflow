CREATE TABLE `durable_review_patient_links` (
    `review_id` text PRIMARY KEY NOT NULL REFERENCES `durable_review_records`(`review_id`),
    `patient_id` text NOT NULL REFERENCES `patients`(`id`),
    `created_at` integer NOT NULL DEFAULT (unixepoch()),
    `updated_at` integer NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT `durable_review_patient_links_timestamp_check` CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000 AND typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 8640000000000)
);
