/* @Codex */
CREATE TABLE `physician_review_attestations` (
    `actor_ref` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`) CHECK (length(`actor_ref`) BETWEEN 1 AND 256 AND trim(`actor_ref`) = `actor_ref`),
    `schema_version` text NOT NULL CHECK (`schema_version` = 'mediflow.physician-review-attestation.v1'),
    `capability` text NOT NULL CHECK (`capability` = 'physician_terminal_review'),
    `status` text NOT NULL CHECK (`status` IN ('inactive', 'revoked')),
    `attestation_version` integer NOT NULL CHECK (`attestation_version` = 1),
    `policy_version` text NOT NULL CHECK (`policy_version` = 'physician_terminal_review.v1'),
    `revoked_at` integer,
    `created_at` integer NOT NULL DEFAULT (unixepoch()),
    `updated_at` integer NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT `physician_review_attestations_lifecycle_check` CHECK ((`status` = 'inactive' AND `revoked_at` IS NULL) OR (`status` = 'revoked' AND `revoked_at` IS NOT NULL)),
    CONSTRAINT `physician_review_attestations_timestamp_check` CHECK (
        typeof(`created_at`) = 'integer' AND `created_at` BETWEEN 0 AND 8640000000000
        AND typeof(`updated_at`) = 'integer' AND `updated_at` BETWEEN `created_at` AND 8640000000000
        AND (`revoked_at` IS NULL OR (typeof(`revoked_at`) = 'integer' AND `revoked_at` BETWEEN `created_at` AND 8640000000000))
    )
);
