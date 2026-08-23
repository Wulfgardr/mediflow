/* @Codex */
CREATE TABLE `physician_review_attestations` (
    `actor_ref` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`),
    `schema_version` text NOT NULL,
    `capability` text NOT NULL,
    `status` text NOT NULL,
    `attestation_version` integer NOT NULL,
    `policy_version` text NOT NULL,
    `revoked_at` integer,
    `created_at` integer NOT NULL DEFAULT (unixepoch()),
    `updated_at` integer NOT NULL DEFAULT (unixepoch())
);
