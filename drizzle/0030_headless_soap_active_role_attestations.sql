/* @Codex */
CREATE TABLE `headless_soap_active_role_attestations` (
    `attestation_ref` text PRIMARY KEY NOT NULL CHECK (length(`attestation_ref`) BETWEEN 1 AND 256 AND trim(`attestation_ref`) = `attestation_ref`),
    `actor_ref` text NOT NULL UNIQUE REFERENCES `users`(`id`) ON DELETE RESTRICT CHECK (length(`actor_ref`) BETWEEN 1 AND 256 AND trim(`actor_ref`) = `actor_ref`),
    `schema_version` text NOT NULL CHECK (`schema_version` = 'mediflow.headless-soap-active-role-attestation.v1'),
    `role` text NOT NULL CHECK (`role` = 'physician'),
    `operation_id` text NOT NULL CHECK (`operation_id` = 'mediflow.clinical_diary.append_soap.v1'),
    `policy_version` text NOT NULL CHECK (`policy_version` = 'clinician_confirmed_single_use.v1'),
    `status` text NOT NULL CHECK (`status` IN ('inactive', 'active', 'revoked')),
    `attestation_version` integer NOT NULL CHECK (`attestation_version` = 1),
    `issuer_ref` text,
    `expires_at` integer,
    `activated_at` integer,
    `revocation_generation` integer NOT NULL DEFAULT 0 CHECK (typeof(`revocation_generation`) = 'integer' AND `revocation_generation` BETWEEN 0 AND 9007199254740991),
    `revoked_at` integer,
    `created_at` integer NOT NULL DEFAULT (unixepoch()),
    `updated_at` integer NOT NULL DEFAULT (unixepoch()),
    CONSTRAINT `headless_soap_active_role_attestations_lifecycle_check` CHECK (
        (`status` = 'inactive' AND `issuer_ref` IS NULL AND `expires_at` IS NULL AND `activated_at` IS NULL AND `revoked_at` IS NULL AND `revocation_generation` = 0)
        OR (`status` = 'active' AND `issuer_ref` IS NOT NULL AND length(`issuer_ref`) BETWEEN 1 AND 256 AND trim(`issuer_ref`) = `issuer_ref` AND `expires_at` IS NOT NULL AND `activated_at` IS NOT NULL AND `revoked_at` IS NULL AND `revocation_generation` = 0)
        OR (
            `status` = 'revoked' AND `revoked_at` IS NOT NULL AND `revocation_generation` BETWEEN 1 AND 9007199254740991
            AND (
                (`issuer_ref` IS NULL AND `expires_at` IS NULL AND `activated_at` IS NULL)
                OR (`issuer_ref` IS NOT NULL AND length(`issuer_ref`) BETWEEN 1 AND 256 AND trim(`issuer_ref`) = `issuer_ref` AND `expires_at` IS NOT NULL AND `activated_at` IS NOT NULL)
            )
        )
    ),
    CONSTRAINT `headless_soap_active_role_attestations_timestamp_check` CHECK (
        typeof(`created_at`) = 'integer' AND `created_at` BETWEEN 0 AND 8640000000000
        AND typeof(`updated_at`) = 'integer' AND `updated_at` BETWEEN `created_at` AND 8640000000000
        AND (`expires_at` IS NULL OR (typeof(`expires_at`) = 'integer' AND `expires_at` BETWEEN `created_at` AND 8640000000000))
        AND (`activated_at` IS NULL OR (typeof(`activated_at`) = 'integer' AND `activated_at` BETWEEN `created_at` AND 8640000000000 AND (`expires_at` IS NULL OR `activated_at` <= `expires_at`)))
        AND (`revoked_at` IS NULL OR (typeof(`revoked_at`) = 'integer' AND `revoked_at` BETWEEN `created_at` AND 8640000000000 AND (`activated_at` IS NULL OR `revoked_at` >= `activated_at`)))
    )
);
