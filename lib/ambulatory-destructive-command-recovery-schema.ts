import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot, schemaDifferences } from './sqlite-schema-shape';

const PREDECESSORS = new Map([
    [4, 'a998dad7b46c831f283032144f43cd690f68e962b199256ecd68c11736f867ed'],
    [5, '33ce371c41f4cb51033af18ef9a0f06bf8c81a248bca29f18b21d3db9f24ea46'],
    [6, '4becef1521ec507b3da31047e01ab3e25562197c8a518472bb4cdef93ed3867b'],
    [9, '85259ea3bdcbdfa286a0d8a206a04bfc5621c106a604488c0e17d8c7c37d3ba1'],
    [10, '459c212cd2d9a65e4df72df63923c64551ec530c3efe07459235af8b362d6452'],
]);
/* Every predecessor still carries the durable review and headless SOAP tables,
 * removed from the canonical schema in version 11: their exact historical DDL. */
export const RETIRED_FEATURE_TABLES_SQL: readonly string[] = [
    "CREATE TABLE durable_review_records (\n            id TEXT PRIMARY KEY NOT NULL, patient_ref TEXT NOT NULL, review_id TEXT NOT NULL UNIQUE, review_revision INTEGER NOT NULL,\n            receipt_ref TEXT NOT NULL, provenance_ref TEXT NOT NULL, receipt_binding TEXT NOT NULL, provenance_binding TEXT NOT NULL,\n            presentation_version TEXT NOT NULL, sealed_ciphertext TEXT NOT NULL, sealed_digest TEXT NOT NULL,\n            created_at INTEGER DEFAULT (unixepoch())\n        )",
    "CREATE TABLE durable_review_operations (\n            id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,\n            operation TEXT NOT NULL, expected_review_revision INTEGER NOT NULL, operation_digest TEXT NOT NULL,\n            record_snapshot TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch())\n        )",
    "CREATE TABLE durable_review_patient_links (\n        review_id TEXT PRIMARY KEY NOT NULL REFERENCES durable_review_records(review_id),\n        patient_id TEXT NOT NULL REFERENCES patients(id),\n        created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),\n        CONSTRAINT durable_review_patient_links_timestamp_check CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000 AND typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 8640000000000)\n    )",
    "CREATE TABLE durable_review_command_states (\n            review_id TEXT PRIMARY KEY NOT NULL, review_state TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL,\n            created_at INTEGER DEFAULT (unixepoch())\n        )",
    "CREATE TABLE durable_review_command_operations (\n            id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_digest TEXT NOT NULL,\n            result_snapshot TEXT NOT NULL, audit_event_id TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch())\n        )",
    "CREATE TABLE headless_soap_active_role_attestations (\n        attestation_ref TEXT PRIMARY KEY NOT NULL CHECK (length(attestation_ref) BETWEEN 1 AND 256 AND trim(attestation_ref) = attestation_ref),\n        actor_ref TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT CHECK (length(actor_ref) BETWEEN 1 AND 256 AND trim(actor_ref) = actor_ref),\n        schema_version TEXT NOT NULL CHECK (schema_version = 'mediflow.headless-soap-active-role-attestation.v1'), role TEXT NOT NULL CHECK (role = 'physician'),\n        operation_id TEXT NOT NULL CHECK (operation_id = 'mediflow.clinical_diary.append_soap.v1'), policy_version TEXT NOT NULL CHECK (policy_version = 'clinician_confirmed_single_use.v1'),\n        status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'revoked')), attestation_version INTEGER NOT NULL CHECK (attestation_version = 1),\n        issuer_ref TEXT, expires_at INTEGER, activated_at INTEGER,\n        revocation_generation INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revocation_generation) = 'integer' AND revocation_generation BETWEEN 0 AND 9007199254740991),\n        revoked_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),\n        CONSTRAINT headless_soap_active_role_attestations_lifecycle_check CHECK (\n            (status = 'inactive' AND issuer_ref IS NULL AND expires_at IS NULL AND activated_at IS NULL AND revoked_at IS NULL AND revocation_generation = 0)\n            OR (status = 'active' AND issuer_ref IS NOT NULL AND length(issuer_ref) BETWEEN 1 AND 256 AND trim(issuer_ref) = issuer_ref AND expires_at IS NOT NULL AND activated_at IS NOT NULL AND revoked_at IS NULL AND revocation_generation = 0)\n            OR (status = 'revoked' AND revoked_at IS NOT NULL AND revocation_generation BETWEEN 1 AND 9007199254740991\n                AND ((issuer_ref IS NULL AND expires_at IS NULL AND activated_at IS NULL)\n                    OR (issuer_ref IS NOT NULL AND length(issuer_ref) BETWEEN 1 AND 256 AND trim(issuer_ref) = issuer_ref AND expires_at IS NOT NULL AND activated_at IS NOT NULL)))\n        ),\n        CONSTRAINT headless_soap_active_role_attestations_timestamp_check CHECK (\n            typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000 AND typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 8640000000000\n            AND (expires_at IS NULL OR (typeof(expires_at) = 'integer' AND expires_at BETWEEN created_at AND 8640000000000))\n            AND (activated_at IS NULL OR (typeof(activated_at) = 'integer' AND activated_at BETWEEN created_at AND 8640000000000 AND (expires_at IS NULL OR activated_at <= expires_at)))\n            AND (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at BETWEEN created_at AND 8640000000000 AND (activated_at IS NULL OR revoked_at >= activated_at)))\n        )\n    )",
    "CREATE TABLE headless_soap_entry_commits (\n        idempotency_key TEXT PRIMARY KEY NOT NULL,\n        approval_ref TEXT NOT NULL,\n        authorization_proof_digest TEXT NOT NULL,\n        command_id TEXT NOT NULL,\n        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,\n        audit_event_id TEXT NOT NULL REFERENCES audit_events(event_id) ON DELETE RESTRICT,\n        receipt_ref TEXT NOT NULL,\n        binding_snapshot TEXT NOT NULL,\n        binding_digest TEXT NOT NULL,\n        entry_digest TEXT NOT NULL,\n        audit_snapshot TEXT NOT NULL,\n        audit_digest TEXT NOT NULL,\n        receipt_snapshot TEXT NOT NULL,\n        receipt_digest TEXT NOT NULL,\n        committed_at INTEGER NOT NULL\n    )",
    "CREATE UNIQUE INDEX durable_review_command_operations_review_key_unique ON durable_review_command_operations(review_id, idempotency_key)",
    "CREATE UNIQUE INDEX durable_review_operations_review_key_unique ON durable_review_operations(review_id, idempotency_key)",
    "CREATE UNIQUE INDEX headless_soap_entry_commits_audit_event_id_unique ON headless_soap_entry_commits (audit_event_id)",
    "CREATE UNIQUE INDEX headless_soap_entry_commits_command_id_unique ON headless_soap_entry_commits (command_id)",
    "CREATE UNIQUE INDEX headless_soap_entry_commits_entry_id_unique ON headless_soap_entry_commits (entry_id)",
    "CREATE UNIQUE INDEX headless_soap_entry_commits_receipt_ref_unique ON headless_soap_entry_commits (receipt_ref)"
];
export function assertAmbulatoryCommandPredecessorRecoverySchema(probe: Database.Database): void {
    const version = Number(probe.pragma('user_version', { simple: true }));
    const fingerprint = PREDECESSORS.get(version);
    if (!fingerprint) throw new Error('Unsupported ambulatory command recovery predecessor');
    const canonical = new Database(':memory:');
    try {
        initializeSqliteSchema(canonical);
        for (const sql of RETIRED_FEATURE_TABLES_SQL) canonical.exec(sql);
        if (version < 9) {
            canonical.exec('DROP TABLE portable_import_origins');
            for (const column of ['identifier_type', 'identifier_history', 'birth_date_precision', 'birth_year', 'allergies']) canonical.exec(`ALTER TABLE patients DROP COLUMN ${column}`);
        }
        if (version < 10) canonical.exec('ALTER TABLE entries DROP COLUMN recorded_by');
        if (version < 6) canonical.exec('DROP TABLE ambulatory_destructive_commands');
        if (version === 4) canonical.exec('DROP TABLE therapy_status_commands');
        const expected = schemaSnapshot(canonical);
        if (createHash('sha256').update(JSON.stringify(expected)).digest('hex') !== fingerprint)
            throw new Error('Immutable recovery predecessor contract drift');
        const unexpected = probe.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' OR (?<9 AND name='portable_import_origins') OR (?<6 AND name='ambulatory_destructive_commands') OR (?=4 AND name='therapy_status_commands') LIMIT 1").get(version, version, version);
        if (unexpected || schemaDifferences(expected, schemaSnapshot(probe)).length > 0)
            throw new Error('Recovery predecessor schema incompatible');
    } finally { canonical.close(); }
}
