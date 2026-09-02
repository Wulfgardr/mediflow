import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { normalizeAifaSearchText } from '@/lib/aifa-catalog';
import { ensureAuditSqliteSchema } from '@/lib/security/audit-db';
import { resolveDataPath } from '@/lib/data-dir';
import { copySqliteDatabaseSync, replaceSqliteDatabase } from '@/lib/sqlite-repair';
import { initSqlitePragmas } from '@/lib/sqlite-pragmas';

// Ensure the data directory exists in production or use project root for dev
/* @Codex */
const isNextProductionBuild = process.env.NEXT_PHASE === 'phase-production-build';
/* @Codex */
const dbPath = isNextProductionBuild ? ':memory:' : resolveDataPath('medical.db');
const legacyDbPath = path.join(process.cwd(), 'medical.db');

// A crash inside replaceSqliteDatabase can leave medical.db.repair-tmp-* /
// medical.db.old-* files behind. If the crash hit the window between retiring
// medical.db and renaming the staged copy in, the .old-* file is the only
// surviving database: restore it before opening; everything else is stale.
function recoverSwapArtifacts(): void {
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return;
    }
    const isSidecar = (name: string) => name.endsWith('-wal') || name.endsWith('-shm');
    const retired = entries.filter((name) => name.startsWith(`${base}.old-`) && !isSidecar(name));
    if (!fs.existsSync(dbPath) && retired.length > 0) {
        const newest = retired
            .map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
            .sort((a, b) => a.mtimeMs - b.mtimeMs)
            .pop()!.name;
        try {
            for (const suffix of ['-wal', '-shm']) {
                const sidecar = path.join(dir, `${newest}${suffix}`);
                if (fs.existsSync(sidecar)) fs.renameSync(sidecar, `${dbPath}${suffix}`);
            }
            fs.renameSync(path.join(dir, newest), dbPath);
            console.warn(`[MediFlow] Restored ${base} from interrupted swap artifact ${newest}`);
        } catch (error) {
            // Keep the artifacts on disk rather than risk deleting the only copy.
            console.error('[MediFlow] Failed to restore DB from swap artifact:', error);
            return;
        }
    }
    for (const name of entries) {
        if (!name.startsWith(`${base}.repair-tmp`) && !name.startsWith(`${base}.old-`)) continue;
        const stalePath = path.join(dir, name);
        if (fs.existsSync(stalePath)) fs.rmSync(stalePath, { force: true });
    }
}
if (!isNextProductionBuild) recoverSwapArtifacts();

if (!isNextProductionBuild && !fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    // Copy through SQLite (recovers pages still in the legacy -wal sidecar)
    // and stage + rename so a failed copy never leaves a torn medical.db:
    // a plain fs.copyFileSync here was the same bug WUL-321 fixes (boot path).
    const bootStagingPath = `${dbPath}.repair-tmp-boot-${process.pid}`;
    try {
        fs.rmSync(bootStagingPath, { force: true });
        copySqliteDatabaseSync(legacyDbPath, bootStagingPath);
        fs.renameSync(bootStagingPath, dbPath);
        console.log(`[MediFlow] Copied legacy DB to ${dbPath}`);
    } catch (error) {
        console.error('[MediFlow] Failed to copy legacy DB:', error);
        fs.rmSync(bootStagingPath, { force: true });
    }
}

// WUL-268 (STREAM A): apply durable pragmas (WAL, busy_timeout, synchronous,
// foreign_keys) right after every open (boot + swap). See lib/sqlite-pragmas.ts.
let sqlite = new Database(dbPath);
initSqlitePragmas(sqlite);
/* @Codex */
const PHYSICIAN_REVIEW_ATTESTATIONS_DDL = `
    CREATE TABLE physician_review_attestations (
        actor_ref TEXT PRIMARY KEY NOT NULL REFERENCES users(id) CHECK (length(actor_ref) BETWEEN 1 AND 256 AND trim(actor_ref) = actor_ref),
        schema_version TEXT NOT NULL CHECK (schema_version = 'mediflow.physician-review-attestation.v1'),
        capability TEXT NOT NULL CHECK (capability = 'physician_terminal_review'),
        status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'revoked')),
        attestation_version INTEGER NOT NULL CHECK (attestation_version = 1),
        policy_version TEXT NOT NULL CHECK (policy_version = 'physician_terminal_review.v1'),
        revoked_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CONSTRAINT physician_review_attestations_lifecycle_check CHECK ((status IN ('inactive', 'active') AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL)),
        CONSTRAINT physician_review_attestations_timestamp_check CHECK (
            typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000
            AND typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 8640000000000
            AND (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at BETWEEN created_at AND 8640000000000))
        )
    )
`;
/* @Codex */
const PHYSICIAN_REVIEW_ATTESTATIONS_P2A_DDL = `
    CREATE TABLE physician_review_attestations (
        actor_ref TEXT PRIMARY KEY NOT NULL REFERENCES users(id) CHECK (length(actor_ref) BETWEEN 1 AND 256 AND trim(actor_ref) = actor_ref),
        schema_version TEXT NOT NULL CHECK (schema_version = 'mediflow.physician-review-attestation.v1'),
        capability TEXT NOT NULL CHECK (capability = 'physician_terminal_review'),
        status TEXT NOT NULL CHECK (status IN ('inactive', 'revoked')),
        attestation_version INTEGER NOT NULL CHECK (attestation_version = 1),
        policy_version TEXT NOT NULL CHECK (policy_version = 'physician_terminal_review.v1'),
        revoked_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CONSTRAINT physician_review_attestations_lifecycle_check CHECK ((status = 'inactive' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL)),
        CONSTRAINT physician_review_attestations_timestamp_check CHECK (
            typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000
            AND typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 8640000000000
            AND (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at BETWEEN created_at AND 8640000000000))
        )
    )
`;
const normalizeSchemaSql = (value: string) => value.toLowerCase().replace(/if\s+not\s+exists/gu, '').replace(/[\s`"']/gu, '');
const PHYSICIAN_REVIEW_ATTESTATIONS_SCHEMA = normalizeSchemaSql(PHYSICIAN_REVIEW_ATTESTATIONS_DDL);
const PHYSICIAN_REVIEW_ATTESTATIONS_P2A_SCHEMA = normalizeSchemaSql(PHYSICIAN_REVIEW_ATTESTATIONS_P2A_DDL);
/* @Codex */
const HEADLESS_SOAP_ACTIVE_ROLE_ATTESTATIONS_DDL = `
    CREATE TABLE headless_soap_active_role_attestations (
        attestation_ref TEXT PRIMARY KEY NOT NULL CHECK (length(attestation_ref) BETWEEN 1 AND 256 AND trim(attestation_ref) = attestation_ref),
        actor_ref TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT CHECK (length(actor_ref) BETWEEN 1 AND 256 AND trim(actor_ref) = actor_ref),
        schema_version TEXT NOT NULL CHECK (schema_version = 'mediflow.headless-soap-active-role-attestation.v1'), role TEXT NOT NULL CHECK (role = 'physician'),
        operation_id TEXT NOT NULL CHECK (operation_id = 'mediflow.clinical_diary.append_soap.v1'), policy_version TEXT NOT NULL CHECK (policy_version = 'clinician_confirmed_single_use.v1'),
        status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'revoked')), attestation_version INTEGER NOT NULL CHECK (attestation_version = 1),
        issuer_ref TEXT, expires_at INTEGER, activated_at INTEGER,
        revocation_generation INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revocation_generation) = 'integer' AND revocation_generation BETWEEN 0 AND 9007199254740991),
        revoked_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CONSTRAINT headless_soap_active_role_attestations_lifecycle_check CHECK (
            (status = 'inactive' AND issuer_ref IS NULL AND expires_at IS NULL AND activated_at IS NULL AND revoked_at IS NULL AND revocation_generation = 0)
            OR (status = 'active' AND issuer_ref IS NOT NULL AND length(issuer_ref) BETWEEN 1 AND 256 AND trim(issuer_ref) = issuer_ref AND expires_at IS NOT NULL AND activated_at IS NOT NULL AND revoked_at IS NULL AND revocation_generation = 0)
            OR (status = 'revoked' AND revoked_at IS NOT NULL AND revocation_generation BETWEEN 1 AND 9007199254740991
                AND ((issuer_ref IS NULL AND expires_at IS NULL AND activated_at IS NULL)
                    OR (issuer_ref IS NOT NULL AND length(issuer_ref) BETWEEN 1 AND 256 AND trim(issuer_ref) = issuer_ref AND expires_at IS NOT NULL AND activated_at IS NOT NULL)))
        ),
        CONSTRAINT headless_soap_active_role_attestations_timestamp_check CHECK (
            typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000 AND typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 8640000000000
            AND (expires_at IS NULL OR (typeof(expires_at) = 'integer' AND expires_at BETWEEN created_at AND 8640000000000))
            AND (activated_at IS NULL OR (typeof(activated_at) = 'integer' AND activated_at BETWEEN created_at AND 8640000000000 AND (expires_at IS NULL OR activated_at <= expires_at)))
            AND (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at BETWEEN created_at AND 8640000000000 AND (activated_at IS NULL OR revoked_at >= activated_at)))
        )
    )
`;
const HEADLESS_SOAP_ACTIVE_ROLE_ATTESTATIONS_SCHEMA = normalizeSchemaSql(HEADLESS_SOAP_ACTIVE_ROLE_ATTESTATIONS_DDL);
/* @Codex */
const HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATIONS_DDL = `
    CREATE TABLE headless_checkup_active_role_attestations (
        attestation_ref TEXT PRIMARY KEY NOT NULL CHECK (length(attestation_ref) BETWEEN 1 AND 256 AND trim(attestation_ref) = attestation_ref),
        actor_ref TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT CHECK (length(actor_ref) BETWEEN 1 AND 256 AND trim(actor_ref) = actor_ref),
        schema_version TEXT NOT NULL CHECK (schema_version = 'mediflow.headless-checkup-active-role-attestation.v1'),
        role TEXT NOT NULL CHECK (role = 'physician'), operation_id TEXT NOT NULL CHECK (operation_id = 'mediflow.patient.checkup.status.transition.v1'),
        policy_version TEXT NOT NULL CHECK (policy_version = 'physician_confirmed_single_use.v1'),
        status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'revoked')), attestation_version INTEGER NOT NULL CHECK (attestation_version = 1),
        issuer_ref TEXT, expires_at INTEGER, activated_at INTEGER,
        revocation_generation INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revocation_generation) = 'integer' AND revocation_generation BETWEEN 0 AND 9007199254740991),
        revoked_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CONSTRAINT headless_checkup_active_role_attestations_lifecycle_check CHECK (
            (status = 'inactive' AND issuer_ref IS NULL AND expires_at IS NULL AND activated_at IS NULL AND revoked_at IS NULL AND revocation_generation = 0)
            OR (status = 'active' AND issuer_ref IS NOT NULL AND length(issuer_ref) BETWEEN 1 AND 256 AND trim(issuer_ref) = issuer_ref AND expires_at IS NOT NULL AND activated_at IS NOT NULL AND revoked_at IS NULL AND revocation_generation = 0)
            OR (status = 'revoked' AND revoked_at IS NOT NULL AND revocation_generation BETWEEN 1 AND 9007199254740991
                AND ((issuer_ref IS NULL AND expires_at IS NULL AND activated_at IS NULL)
                    OR (issuer_ref IS NOT NULL AND length(issuer_ref) BETWEEN 1 AND 256 AND trim(issuer_ref) = issuer_ref AND expires_at IS NOT NULL AND activated_at IS NOT NULL)))
        ),
        CONSTRAINT headless_checkup_active_role_attestations_timestamp_check CHECK (
            typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000 AND typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 8640000000000
            AND (expires_at IS NULL OR (typeof(expires_at) = 'integer' AND expires_at BETWEEN created_at AND 8640000000000))
            AND (activated_at IS NULL OR (typeof(activated_at) = 'integer' AND activated_at BETWEEN created_at AND 8640000000000 AND (expires_at IS NULL OR activated_at <= expires_at)))
            AND (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at BETWEEN created_at AND 8640000000000 AND (activated_at IS NULL OR revoked_at >= activated_at)))
        )
    )
`;
const HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATIONS_SCHEMA = normalizeSchemaSql(HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATIONS_DDL);
export type HeadlessSoapActiveRoleAttestationSchemaErrorCode = 'schema_incompatible' | 'schema_unavailable';
/* @Codex */
export class HeadlessSoapActiveRoleAttestationSchemaError extends Error {
    constructor(readonly code: HeadlessSoapActiveRoleAttestationSchemaErrorCode) {
        super(`Headless SOAP active-role attestation schema ${code === 'schema_incompatible' ? 'is incompatible' : 'is unavailable'}.`);
        this.name = 'HeadlessSoapActiveRoleAttestationSchemaError';
    }
}
/* @Codex */
const HEADLESS_SOAP_ENTRY_COMMITS_DDL = `
    CREATE TABLE headless_soap_entry_commits (
        idempotency_key TEXT PRIMARY KEY NOT NULL,
        approval_ref TEXT NOT NULL,
        authorization_proof_digest TEXT NOT NULL,
        command_id TEXT NOT NULL,
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        audit_event_id TEXT NOT NULL REFERENCES audit_events(event_id) ON DELETE RESTRICT,
        receipt_ref TEXT NOT NULL,
        binding_snapshot TEXT NOT NULL,
        binding_digest TEXT NOT NULL,
        entry_digest TEXT NOT NULL,
        audit_snapshot TEXT NOT NULL,
        audit_digest TEXT NOT NULL,
        receipt_snapshot TEXT NOT NULL,
        receipt_digest TEXT NOT NULL,
        committed_at INTEGER NOT NULL
    )
`;
const HEADLESS_SOAP_ENTRY_COMMITS_SCHEMA = normalizeSchemaSql(HEADLESS_SOAP_ENTRY_COMMITS_DDL);
const HEADLESS_SOAP_ENTRY_COMMITS_UNIQUE_INDEXES = [
    ['headless_soap_entry_commits_command_id_unique', 'command_id'],
    ['headless_soap_entry_commits_entry_id_unique', 'entry_id'],
    ['headless_soap_entry_commits_audit_event_id_unique', 'audit_event_id'],
    ['headless_soap_entry_commits_receipt_ref_unique', 'receipt_ref'],
] as const;
export type HeadlessSoapEntryCommitSchemaErrorCode = 'schema_incompatible' | 'schema_unavailable';
/* @Codex */
export class HeadlessSoapEntryCommitSchemaError extends Error {
    constructor(readonly code: HeadlessSoapEntryCommitSchemaErrorCode) {
        super(`Headless SOAP entry commit schema ${code === 'schema_incompatible' ? 'is incompatible' : 'is unavailable'}.`);
        this.name = 'HeadlessSoapEntryCommitSchemaError';
    }
}
/* @Codex */
const DURABLE_REVIEW_PATIENT_LINKS_DDL = `
    CREATE TABLE IF NOT EXISTS durable_review_patient_links (
        review_id TEXT PRIMARY KEY NOT NULL REFERENCES durable_review_records(review_id),
        patient_id TEXT NOT NULL REFERENCES patients(id),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CONSTRAINT durable_review_patient_links_timestamp_check CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000 AND typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 8640000000000)
    )
`;
const DURABLE_REVIEW_PATIENT_LINKS_SCHEMA = normalizeSchemaSql(DURABLE_REVIEW_PATIENT_LINKS_DDL);
/* @Codex */
function physicianReviewAttestationSchemaEquals(expected: string): boolean {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'physician_review_attestations'").get() as { sql?: unknown } | undefined;
    return typeof row?.sql === 'string' && normalizeSchemaSql(row.sql) === expected;
}
/* @Codex */
export function hasCanonicalPhysicianReviewAttestationSchema(): boolean {
    return physicianReviewAttestationSchemaEquals(PHYSICIAN_REVIEW_ATTESTATIONS_SCHEMA);
}
/* @Codex */
function headlessSoapActiveRoleAttestationSchemaEquals(expected: string): boolean {
    try {
        const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get('headless_soap_active_role_attestations') as { sql?: unknown } | undefined;
        return typeof row?.sql === 'string' && normalizeSchemaSql(row.sql) === expected;
    } catch {
        return false;
    }
}
/* @Codex */
function hasNoHeadlessSoapActiveRoleAttestationOrphans(): boolean {
    try {
        const orphan = sqlite.prepare(`
            SELECT 1 FROM headless_soap_active_role_attestations AS attestation
            LEFT JOIN users AS actor ON actor.id = attestation.actor_ref
            WHERE actor.id IS NULL LIMIT 1
        `).get();
        return !orphan;
    } catch {
        return false;
    }
}
/* @Codex */
export function hasCanonicalHeadlessSoapActiveRoleAttestationSchema(): boolean {
    return headlessSoapActiveRoleAttestationSchemaEquals(HEADLESS_SOAP_ACTIVE_ROLE_ATTESTATIONS_SCHEMA)
        && hasNoHeadlessSoapActiveRoleAttestationOrphans();
}
/* @Codex */
export function hasCanonicalHeadlessCheckupActiveRoleAttestationSchema(): boolean {
    try {
        const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get('headless_checkup_active_role_attestations') as { sql?: unknown } | undefined;
        if (typeof row?.sql !== 'string' || normalizeSchemaSql(row.sql) !== HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATIONS_SCHEMA) return false;
        const orphan = sqlite.prepare(`SELECT 1 FROM headless_checkup_active_role_attestations AS attestation
            LEFT JOIN users AS actor ON actor.id = attestation.actor_ref WHERE actor.id IS NULL LIMIT 1`).get();
        return !orphan;
    } catch { return false; }
}
/* @Codex */
function ensureHeadlessCheckupActiveRoleAttestationSchema(): void {
    try {
        const exists = Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get('headless_checkup_active_role_attestations'));
        if (!exists) sqlite.prepare(HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATIONS_DDL
            .replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')).run();
    } catch { throw new Error('Headless checkup active-role attestation schema is unavailable.'); }
    if (!hasCanonicalHeadlessCheckupActiveRoleAttestationSchema()) {
        throw new Error('Headless checkup active-role attestation schema is incompatible.');
    }
}
/* @Codex */
function ensureHeadlessSoapActiveRoleAttestationSchema(): void {
    let exists: boolean;
    try {
        exists = Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get('headless_soap_active_role_attestations'));
        if (!exists) sqlite.prepare(HEADLESS_SOAP_ACTIVE_ROLE_ATTESTATIONS_DDL.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')).run();
    } catch {
        throw new HeadlessSoapActiveRoleAttestationSchemaError('schema_unavailable');
    }
    if (!hasCanonicalHeadlessSoapActiveRoleAttestationSchema()) {
        throw new HeadlessSoapActiveRoleAttestationSchemaError('schema_incompatible');
    }
}
/* @Codex */
export function hasCanonicalHeadlessSoapEntryCommitSchema(): boolean {
    try {
        const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get('headless_soap_entry_commits') as { sql?: unknown } | undefined;
        if (typeof row?.sql !== 'string' || normalizeSchemaSql(row.sql) !== HEADLESS_SOAP_ENTRY_COMMITS_SCHEMA) return false;
        for (const [name, column] of HEADLESS_SOAP_ENTRY_COMMITS_UNIQUE_INDEXES) {
            const index = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = ?")
                .get(name, 'headless_soap_entry_commits') as { sql?: unknown } | undefined;
            const expected = normalizeSchemaSql(`CREATE UNIQUE INDEX ${name} ON headless_soap_entry_commits (${column})`);
            if (typeof index?.sql !== 'string' || normalizeSchemaSql(index.sql) !== expected) return false;
        }
        return true;
    } catch {
        return false;
    }
}
/* @Codex */
function ensureHeadlessSoapEntryCommitSchema(): void {
    try {
        const exists = Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get('headless_soap_entry_commits'));
        if (!exists) {
            sqlite.prepare(HEADLESS_SOAP_ENTRY_COMMITS_DDL.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')).run();
        } else {
            const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
                .get('headless_soap_entry_commits') as { sql?: unknown } | undefined;
            if (typeof row?.sql !== 'string' || normalizeSchemaSql(row.sql) !== HEADLESS_SOAP_ENTRY_COMMITS_SCHEMA) {
                throw new HeadlessSoapEntryCommitSchemaError('schema_incompatible');
            }
        }
        for (const [name, column] of HEADLESS_SOAP_ENTRY_COMMITS_UNIQUE_INDEXES) {
            sqlite.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON headless_soap_entry_commits (${column})`).run();
        }
    } catch (error) {
        if (error instanceof HeadlessSoapEntryCommitSchemaError) throw error;
        throw new HeadlessSoapEntryCommitSchemaError('schema_unavailable');
    }
    if (!hasCanonicalHeadlessSoapEntryCommitSchema()) throw new HeadlessSoapEntryCommitSchemaError('schema_incompatible');
}
/* @Codex */
export function hasCanonicalDurableReviewPatientLinkSchema(): boolean {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'durable_review_patient_links'").get() as { sql?: unknown } | undefined;
    return typeof row?.sql === 'string' && normalizeSchemaSql(row.sql) === DURABLE_REVIEW_PATIENT_LINKS_SCHEMA;
}
/* @Codex */
function migrateP2aPhysicianReviewAttestationSchema(): void {
    if (!physicianReviewAttestationSchemaEquals(PHYSICIAN_REVIEW_ATTESTATIONS_P2A_SCHEMA)) return;
    sqlite.transaction(() => {
        sqlite.exec('ALTER TABLE physician_review_attestations RENAME TO physician_review_attestations_p2a');
        sqlite.prepare(PHYSICIAN_REVIEW_ATTESTATIONS_DDL).run();
        sqlite.exec(`INSERT INTO physician_review_attestations (
            actor_ref, schema_version, capability, status, attestation_version, policy_version, revoked_at, created_at, updated_at
        ) SELECT actor_ref, schema_version, capability, status, attestation_version, policy_version, revoked_at, created_at, updated_at
        FROM physician_review_attestations_p2a`);
        sqlite.exec('DROP TABLE physician_review_attestations_p2a');
    }).immediate();
}
/* @Codex */
type TableInfoRow = { name: string };
/* @Codex */
function ensureColumn(table: string, columnName: string, columnSql: string) {
    const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[]).map((col) => col.name);
    if (!columns.includes(columnName)) {
        sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`).run();
    }
}

/* @Codex */
const ATTACHMENT_CURRENTNESS_LEGACY_DDL = `
    CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL,
        type TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, data TEXT,
        created_at INTEGER DEFAULT (unixepoch()), summary_snapshot TEXT,
        parse_evidence_artifact_snapshot TEXT, ocr_queue_state TEXT,
        ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER,
        ocr_replay_artifact_snapshot TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE NO ACTION ON DELETE NO ACTION
    )
`;
/* @Codex */
const ATTACHMENT_CURRENTNESS_CANONICAL_DDL = `
    CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, name TEXT NOT NULL,
        type TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, data TEXT,
        created_at INTEGER DEFAULT (unixepoch()), summary_snapshot TEXT,
        parse_evidence_artifact_snapshot TEXT, ocr_queue_state TEXT,
        ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER,
        ocr_replay_artifact_snapshot TEXT,
        document_source_ref TEXT NOT NULL UNIQUE CHECK (
            length(document_source_ref) = 64 AND document_source_ref NOT GLOB '*[^0-9a-f]*'
        ),
        document_revision INTEGER NOT NULL CHECK (
            typeof(document_revision) = 'integer' AND document_revision BETWEEN 1 AND 9007199254740991
        ),
        document_freshness_epoch INTEGER NOT NULL CHECK (
            typeof(document_freshness_epoch) = 'integer' AND document_freshness_epoch BETWEEN 1 AND 9007199254740991
        ),
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE NO ACTION ON DELETE NO ACTION
    )
`;
/* @Codex */
const ATTACHMENT_CURRENTNESS_LEGACY_SCHEMA = normalizeSchemaSql(ATTACHMENT_CURRENTNESS_LEGACY_DDL);
/* @Codex */
const ATTACHMENT_CURRENTNESS_CANONICAL_SCHEMA = normalizeSchemaSql(ATTACHMENT_CURRENTNESS_CANONICAL_DDL);
/* @Codex */
const ATTACHMENT_CURRENTNESS_COLUMNS = [
    ['id', 'TEXT', 1, null, 1], ['patient_id', 'TEXT', 1, null, 0], ['name', 'TEXT', 1, null, 0],
    ['type', 'TEXT', 1, null, 0], ['size', 'INTEGER', 1, null, 0], ['path', 'TEXT', 1, null, 0],
    ['data', 'TEXT', 0, null, 0], ['created_at', 'INTEGER', 0, 'unixepoch()', 0],
    ['summary_snapshot', 'TEXT', 0, null, 0], ['parse_evidence_artifact_snapshot', 'TEXT', 0, null, 0],
    ['ocr_queue_state', 'TEXT', 0, null, 0], ['ocr_queue_reason', 'TEXT', 0, null, 0],
    ['ocr_queue_updated_at', 'INTEGER', 0, null, 0], ['ocr_replay_artifact_snapshot', 'TEXT', 0, null, 0],
] as const;
/* @Codex */
const ATTACHMENT_CURRENTNESS_ERROR = 'ATTACHMENT_CURRENTNESS_MIGRATION_UNSUPPORTED';

/* @Codex */
function denyAttachmentCurrentnessMigration(): never {
    throw new Error(ATTACHMENT_CURRENTNESS_ERROR);
}
/* @Codex */
function attachmentCurrentnessSchemaMatches(expected: string, canonical: boolean): boolean {
    const table = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND lower(name) = 'attachments'").get() as { name?: unknown; sql?: unknown } | undefined;
    const columns = sqlite.prepare('PRAGMA table_xinfo(attachments)').all() as Array<{ name?: unknown; type?: unknown; notnull?: unknown; dflt_value?: unknown; pk?: unknown; hidden?: unknown }>;
    const expectedColumns = canonical
        ? [...ATTACHMENT_CURRENTNESS_COLUMNS, ['document_source_ref', 'TEXT', 1, null, 0], ['document_revision', 'INTEGER', 1, null, 0], ['document_freshness_epoch', 'INTEGER', 1, null, 0]]
        : ATTACHMENT_CURRENTNESS_COLUMNS;
    const foreignKeys = sqlite.prepare('PRAGMA foreign_key_list(attachments)').all() as Array<Record<string, unknown>>;
    const indexes = sqlite.prepare('PRAGMA index_list(attachments)').all() as Array<{ name?: unknown; unique?: unknown; origin?: unknown; partial?: unknown }>;
    const expectedIndexes = canonical ? 3 : 2;
    const hasExpectedIndexes = indexes.length === expectedIndexes && indexes.every((index) => {
        if (typeof index.name !== 'string' || (index.unique !== 0 && index.unique !== 1) || index.partial !== 0) return false;
        const keys = (sqlite.prepare('SELECT name, "desc", coll, "key" FROM pragma_index_xinfo(?)').all(index.name) as Array<{ name?: unknown; desc?: unknown; coll?: unknown; key?: unknown }>)
            .filter((row) => row.key === 1);
        const key = keys.length === 1 && keys[0].desc === 0 && keys[0].coll === 'BINARY' ? keys[0].name : null;
        return (index.name === 'attachments_patient_idx' && index.origin === 'c' && index.unique === 0 && key === 'patient_id')
            || (index.origin === 'pk' && index.unique === 1 && key === 'id')
            || (canonical && index.origin === 'u' && index.unique === 1 && key === 'document_source_ref');
    });
    return table?.name === 'attachments' && typeof table.sql === 'string' && normalizeSchemaSql(table.sql) === expected
        && columns.length === expectedColumns.length && columns.every((column, index) => {
            const field = expectedColumns[index];
            return column.name === field[0] && column.type === field[1] && column.notnull === field[2]
                && column.dflt_value === field[3] && column.pk === field[4] && column.hidden === 0;
        }) && foreignKeys.length === 1 && foreignKeys[0].id === 0 && foreignKeys[0].seq === 0
        && foreignKeys[0].table === 'patients' && foreignKeys[0].from === 'patient_id' && foreignKeys[0].to === 'id'
        && foreignKeys[0].on_update === 'NO ACTION' && foreignKeys[0].on_delete === 'NO ACTION' && foreignKeys[0].match === 'NONE'
        && hasExpectedIndexes;
}
/* @Codex */
function upgradeLegacyAttachmentCurrentness(): void {
    try {
        const stale = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE lower(name) = 'attachments_currentness_legacy' LIMIT 1").get();
        const trigger = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND lower(tbl_name) = 'attachments' LIMIT 1").get();
        if (stale || trigger) denyAttachmentCurrentnessMigration();
        if (attachmentCurrentnessSchemaMatches(ATTACHMENT_CURRENTNESS_CANONICAL_SCHEMA, true)) {
            const invalid = sqlite.prepare(`SELECT 1 FROM attachments WHERE typeof(document_source_ref) != 'text'
                OR length(document_source_ref) != 64 OR document_source_ref GLOB '*[^0-9a-f]*'
                OR typeof(document_revision) != 'integer' OR document_revision NOT BETWEEN 1 AND 9007199254740991
                OR typeof(document_freshness_epoch) != 'integer' OR document_freshness_epoch NOT BETWEEN 1 AND 9007199254740991 LIMIT 1`).get();
            if (invalid) denyAttachmentCurrentnessMigration();
            return;
        }
        if (!attachmentCurrentnessSchemaMatches(ATTACHMENT_CURRENTNESS_LEGACY_SCHEMA, false)) denyAttachmentCurrentnessMigration();
        if (sqlite.prepare('SELECT 1 FROM attachments AS attachment LEFT JOIN patients AS patient ON patient.id = attachment.patient_id WHERE patient.id IS NULL LIMIT 1').get()) denyAttachmentCurrentnessMigration();
        sqlite.exec('ALTER TABLE attachments RENAME TO attachments_currentness_legacy');
        sqlite.exec(ATTACHMENT_CURRENTNESS_CANONICAL_DDL);
        sqlite.exec(`INSERT INTO attachments (id, patient_id, name, type, size, path, data, created_at, summary_snapshot,
            parse_evidence_artifact_snapshot, ocr_queue_state, ocr_queue_reason, ocr_queue_updated_at, ocr_replay_artifact_snapshot,
            document_source_ref, document_revision, document_freshness_epoch)
            SELECT id, patient_id, name, type, size, path, data, created_at, summary_snapshot,
            parse_evidence_artifact_snapshot, ocr_queue_state, ocr_queue_reason, ocr_queue_updated_at, ocr_replay_artifact_snapshot,
            lower(hex(randomblob(32))), 1, 1 FROM attachments_currentness_legacy`);
        sqlite.exec('DROP TABLE attachments_currentness_legacy');
        sqlite.exec('CREATE INDEX attachments_patient_idx ON attachments(patient_id)');
    } catch (error) {
        if (error instanceof Error && error.message === ATTACHMENT_CURRENTNESS_ERROR) throw error;
        denyAttachmentCurrentnessMigration();
    }
}

// Schema guards run on every (re)open so older DB files gain the tables and
// columns the current code expects (re-applied after a repair swaps the file).
function applySchemaGuards() {
    try {
        ensureColumn('ambulatories', 'version', 'version INTEGER NOT NULL DEFAULT 1');
    } catch (error) {
        console.warn('[MediFlow] Ambulatories schema check skipped:', error);
    }
    /* @Codex */
    try {
        ensureColumn('users', 'failed_login_attempts', 'failed_login_attempts INTEGER NOT NULL DEFAULT 0');
        ensureColumn('users', 'first_failed_login_at', 'first_failed_login_at INTEGER');
        ensureColumn('users', 'locked_until', 'locked_until INTEGER');
    } catch (error) {
        console.warn('[MediFlow] Users schema check skipped:', error);
    }
    /* @Codex */
    try {
        migrateP2aPhysicianReviewAttestationSchema();
        sqlite.prepare(PHYSICIAN_REVIEW_ATTESTATIONS_DDL.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')).run();
    } catch (error) {
        console.warn('[MediFlow] Physician review attestation schema check skipped:', error);
    }
    /* @Codex */
    ensureHeadlessSoapActiveRoleAttestationSchema();
    /* @Codex */
    ensureHeadlessCheckupActiveRoleAttestationSchema();
    /* @Codex */
    try {
        ensureColumn('attachments', 'summary_snapshot', 'summary_snapshot TEXT');
        /* @Codex */
        ensureColumn('attachments', 'parse_evidence_artifact_snapshot', 'parse_evidence_artifact_snapshot TEXT');
        // WUL-237: OCR-needed queue state, additive and idempotent
        ensureColumn('attachments', 'ocr_queue_state', 'ocr_queue_state TEXT');
        ensureColumn('attachments', 'ocr_queue_reason', 'ocr_queue_reason TEXT');
        ensureColumn('attachments', 'ocr_queue_updated_at', 'ocr_queue_updated_at INTEGER');
        ensureColumn('attachments', 'ocr_replay_artifact_snapshot', 'ocr_replay_artifact_snapshot TEXT');
    } catch (error) {
        console.warn('[MediFlow] Attachments schema check skipped:', error);
    }
    /* @Codex */
    try {
        ensureColumn('patients', 'exemptions', 'exemptions TEXT');
        /* @Codex */
        ensureColumn('patients', 'diagnoses', 'diagnoses TEXT');
        /* @Codex */
        ensureColumn('patients', 'monitoring_profile', 'monitoring_profile TEXT');
        /* @Codex */
        ensureColumn('patients', 'status_reason', 'status_reason TEXT');
        /* @Codex */
        ensureColumn('patients', 'version', 'version INTEGER NOT NULL DEFAULT 1');
        // WUL-306 (ADR 0066): soft-delete tombstone columns, additive and idempotent
        ensureColumn('patients', 'deleted_at', 'deleted_at INTEGER');
        ensureColumn('patients', 'deletion_reason', 'deletion_reason TEXT');
        ensureColumn('patients', 'archive_reason', 'archive_reason TEXT');
        ensureColumn('patients', 'archive_note', 'archive_note TEXT');
        // S1: ciclo di vita insight (staleness). Additive e idempotenti.
        ensureColumn('patients', 'ai_summary_generated_at', 'ai_summary_generated_at INTEGER');
        ensureColumn('patients', 'ai_summary_context_hash', 'ai_summary_context_hash TEXT');
    } catch (error) {
        console.warn('[MediFlow] Patients schema check skipped:', error);
    }
    /* @Codex */
    try {
        ensureColumn('entries', 'title', "title TEXT NOT NULL DEFAULT 'Voce clinica'");
        ensureColumn('entries', 'setting', 'setting TEXT');
        ensureColumn('entries', 'metadata', 'metadata TEXT');
        ensureColumn('entries', 'attachments', 'attachments TEXT');
        ensureColumn('entries', 'deleted_at', 'deleted_at INTEGER');
        ensureColumn('entries', 'deletion_reason', 'deletion_reason TEXT');
        ensureColumn('entries', 'version', 'version INTEGER NOT NULL DEFAULT 1');
        ensureColumn('entries', 'updated_at', 'updated_at INTEGER');
    } catch (error) {
        console.warn('[MediFlow] Entries schema check skipped:', error);
    }
    /* @Codex */
    try {
        ensureColumn('checkups', 'notes', 'notes TEXT');
        /* @Codex */
        ensureColumn('checkups', 'source', 'source TEXT');
        /* @Codex */
        ensureColumn('checkups', 'version', 'version INTEGER NOT NULL DEFAULT 1');
        /* @Codex */
        ensureColumn('checkups', 'updated_at', 'updated_at INTEGER');
        /* @Codex */
        ensureColumn('checkups', 'deleted_at', 'deleted_at INTEGER');
        /* @Codex */
        ensureColumn('checkups', 'deletion_reason', 'deletion_reason TEXT');
    } catch (error) {
        console.warn('[MediFlow] Checkups schema check skipped:', error);
    }
    /* @Codex */
    try {
        ensureColumn('therapies', 'active_principle', 'active_principle TEXT');
        /* @Codex */
        ensureColumn('therapies', 'motivation', 'motivation TEXT');
        /* @Codex */
        ensureColumn('therapies', 'diagnosis_code', 'diagnosis_code TEXT');
        /* @Codex */
        ensureColumn('therapies', 'diagnosis_name', 'diagnosis_name TEXT');
        /* @Codex */
        ensureColumn('therapies', 'version', 'version INTEGER NOT NULL DEFAULT 1');
        /* @Codex */
        ensureColumn('therapies', 'updated_at', 'updated_at INTEGER');
        /* @Codex */
        ensureColumn('therapies', 'deleted_at', 'deleted_at INTEGER');
        /* @Codex */
        ensureColumn('therapies', 'deletion_reason', 'deletion_reason TEXT');
    } catch (error) {
        console.warn('[MediFlow] Therapies schema check skipped:', error);
    }
    /* @Codex */
    try {
        ensureColumn('drugs', 'aic_search', 'aic_search TEXT');
        ensureColumn('drugs', 'name_search', 'name_search TEXT');
        ensureColumn('drugs', 'active_principle_search', 'active_principle_search TEXT');
        ensureColumn('drugs', 'packaging_search', 'packaging_search TEXT');
        const selectPendingPackagingSearchRows = sqlite.prepare(`
            SELECT aic, packaging
            FROM drugs
            WHERE packaging_search IS NULL
            LIMIT 1000
        `);
        const updatePackagingSearch = sqlite.prepare(`
            UPDATE drugs SET packaging_search = ? WHERE aic = ?
        `);
        while (true) {
            const rows = selectPendingPackagingSearchRows.all() as Array<{
                aic: string;
                packaging: string | null;
            }>;
            if (rows.length === 0) break;
            for (const row of rows) {
                updatePackagingSearch.run(normalizeAifaSearchText(row.packaging || ''), row.aic);
            }
        }
        sqlite.prepare('CREATE INDEX IF NOT EXISTS drugs_aic_search_idx ON drugs(aic_search)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS drugs_name_search_idx ON drugs(name_search)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS drugs_active_principle_search_idx ON drugs(active_principle_search)').run();
    } catch (error) {
        console.warn('[MediFlow] Drugs schema check skipped:', error);
    }
    /* @Codex */
    try {
        ensureColumn('conversations', 'is_deleted', 'is_deleted INTEGER NOT NULL DEFAULT 0');
    } catch (error) {
        console.warn('[MediFlow] Conversations schema check skipped:', error);
    }
    /* @Codex */
    try {
        sqlite.prepare(`
            CREATE TABLE IF NOT EXISTS exemptions (
                code TEXT PRIMARY KEY NOT NULL,
                description TEXT NOT NULL,
                type TEXT,
                source TEXT,
                start_date INTEGER,
                end_date INTEGER,
                is_pharma INTEGER,
                is_specialist INTEGER,
                is_national INTEGER,
                updated_at INTEGER DEFAULT (unixepoch())
            )
        `).run();
        sqlite.prepare("CREATE INDEX IF NOT EXISTS exemptions_code_idx ON exemptions(code)").run();
        sqlite.prepare("CREATE INDEX IF NOT EXISTS exemptions_type_idx ON exemptions(type)").run();
    } catch (error) {
        console.warn('[MediFlow] Exemptions schema check skipped:', error);
    }
    /* @Codex */
    try {
        const therapyColumns = (sqlite.prepare("PRAGMA table_info(therapies)").all() as TableInfoRow[]).map((col) => col.name);
        if (!therapyColumns.includes('aic')) {
            sqlite.prepare("ALTER TABLE therapies ADD COLUMN aic TEXT").run();
        }
        if (!therapyColumns.includes('atc')) {
            sqlite.prepare("ALTER TABLE therapies ADD COLUMN atc TEXT").run();
        }
    } catch (error) {
        console.warn('[MediFlow] Therapies schema check skipped:', error);
    }
    /* @Codex */
    try {
        sqlite.prepare(`
            CREATE TABLE IF NOT EXISTS observations (
                id TEXT PRIMARY KEY NOT NULL,
                patient_id TEXT NOT NULL,
                code_system TEXT NOT NULL,
                code TEXT NOT NULL,
                display TEXT NOT NULL,
                unit_system TEXT NOT NULL,
                unit_code TEXT NOT NULL,
                value TEXT NOT NULL,
                notes TEXT,
                observed_at INTEGER NOT NULL,
                source TEXT DEFAULT 'manual',
                version INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch()),
                deleted_at INTEGER,
                deletion_reason TEXT,
                FOREIGN KEY (patient_id) REFERENCES patients(id)
            )
        `).run();
        ensureColumn('observations', 'version', 'version INTEGER NOT NULL DEFAULT 1');
        ensureColumn('observations', 'updated_at', 'updated_at INTEGER');
        ensureColumn('observations', 'deleted_at', 'deleted_at INTEGER');
        ensureColumn('observations', 'deletion_reason', 'deletion_reason TEXT');
        // S6: range di riferimento (additive, idempotenti)
        ensureColumn('observations', 'ref_low', 'ref_low TEXT');
        ensureColumn('observations', 'ref_high', 'ref_high TEXT');
        ensureColumn('observations', 'ref_text', 'ref_text TEXT');
        ensureColumn(
            'observations',
            'service_prescription_item_id',
            'service_prescription_item_id TEXT REFERENCES service_prescription_items(id) ON DELETE SET NULL',
        );
        sqlite.prepare("CREATE INDEX IF NOT EXISTS observations_patient_idx ON observations(patient_id)").run();
        sqlite.prepare("CREATE INDEX IF NOT EXISTS observations_code_idx ON observations(code_system, code)").run();
        sqlite.prepare("CREATE INDEX IF NOT EXISTS observations_service_prescription_item_idx ON observations(service_prescription_item_id)").run();
    } catch (error) {
        console.warn('[MediFlow] Observations schema check skipped:', error);
    }
    /* @Codex */
    try {
        sqlite.prepare(`
            CREATE TABLE IF NOT EXISTS prosthetic_prescriptions (
                id TEXT PRIMARY KEY NOT NULL,
                patient_id TEXT NOT NULL,
                prescribed_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'prescribed',
                category TEXT NOT NULL DEFAULT 'standard',
                iso_code TEXT,
                description TEXT NOT NULL,
                measures TEXT,
                clinical_reason TEXT,
                regional_prescription_id TEXT,
                supplier TEXT,
                collaudo_at INTEGER,
                collaudo_outcome TEXT,
                source TEXT NOT NULL DEFAULT 'manual',
                document_refs TEXT,
                notes TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch()),
                FOREIGN KEY (patient_id) REFERENCES patients(id)
            )
        `).run();
        ensureColumn('prosthetic_prescriptions', 'version', 'version INTEGER NOT NULL DEFAULT 1');
        sqlite.prepare('CREATE INDEX IF NOT EXISTS prosthetic_prescriptions_patient_idx ON prosthetic_prescriptions(patient_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS prosthetic_prescriptions_prescribed_idx ON prosthetic_prescriptions(prescribed_at DESC)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS prosthetic_prescriptions_status_idx ON prosthetic_prescriptions(status)').run();
    } catch (error) {
        console.warn('[MediFlow] Prosthetic prescriptions schema check skipped:', error);
    }
    /* @Codex */
    try {
        sqlite.prepare(`
            CREATE TABLE IF NOT EXISTS service_prescriptions (
                id TEXT PRIMARY KEY NOT NULL,
                patient_id TEXT NOT NULL,
                prescribed_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'prescribed',
                category TEXT NOT NULL DEFAULT 'other',
                priority TEXT,
                code_system TEXT,
                service_code TEXT,
                service_name TEXT NOT NULL,
                clinical_question TEXT,
                provider TEXT,
                scheduled_at INTEGER,
                performed_at INTEGER,
                report_received_at INTEGER,
                outcome_note TEXT,
                request_reference TEXT,
                source TEXT NOT NULL DEFAULT 'manual',
                document_refs TEXT,
                notes TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch()),
                FOREIGN KEY (patient_id) REFERENCES patients(id)
            )
        `).run();
        ensureColumn('service_prescriptions', 'version', 'version INTEGER NOT NULL DEFAULT 1');
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescriptions_patient_idx ON service_prescriptions(patient_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescriptions_prescribed_idx ON service_prescriptions(prescribed_at DESC)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescriptions_status_idx ON service_prescriptions(status)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescriptions_category_idx ON service_prescriptions(category)').run();
        sqlite.prepare(`
            CREATE TABLE IF NOT EXISTS service_prescription_items (
                id TEXT PRIMARY KEY NOT NULL,
                patient_id TEXT NOT NULL,
                prescription_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'prescribed',
                category TEXT,
                code_system TEXT,
                service_code TEXT,
                service_name TEXT NOT NULL,
                catalog_entry_id TEXT,
                catalog_display_name TEXT,
                match_status TEXT NOT NULL DEFAULT 'unmatched',
                confidence TEXT,
                evidence TEXT,
                notes TEXT,
                scheduled_at INTEGER,
                performed_at INTEGER,
                report_received_at INTEGER,
                outcome_note TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch()),
                FOREIGN KEY (patient_id) REFERENCES patients(id),
                FOREIGN KEY (prescription_id) REFERENCES service_prescriptions(id)
            )
        `).run();
        ensureColumn('service_prescription_items', 'patient_id', 'patient_id TEXT');
        ensureColumn('service_prescription_items', 'version', 'version INTEGER NOT NULL DEFAULT 1');
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescription_items_patient_idx ON service_prescription_items(patient_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescription_items_prescription_idx ON service_prescription_items(prescription_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescription_items_order_idx ON service_prescription_items(prescription_id, ordinal)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescription_items_status_idx ON service_prescription_items(status)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_prescription_items_code_idx ON service_prescription_items(code_system, service_code)').run();
        sqlite.prepare(`
            INSERT INTO service_prescription_items (
                id,
                patient_id,
                prescription_id,
                ordinal,
                status,
                category,
                code_system,
                service_code,
                service_name,
                match_status,
                scheduled_at,
                performed_at,
                report_received_at,
                outcome_note,
                notes,
                created_at,
                updated_at
            )
            SELECT
                id || ':item:0',
                patient_id,
                id,
                0,
                status,
                category,
                code_system,
                service_code,
                service_name,
                CASE
                    WHEN service_code IS NOT NULL AND trim(service_code) <> '' THEN 'manual'
                    ELSE 'unmatched'
                END,
                scheduled_at,
                performed_at,
                report_received_at,
                outcome_note,
                notes,
                COALESCE(created_at, unixepoch()),
                COALESCE(updated_at, unixepoch())
            FROM service_prescriptions
            WHERE NOT EXISTS (
                SELECT 1 FROM service_prescription_items
                WHERE service_prescription_items.prescription_id = service_prescriptions.id
            )
        `).run();
        sqlite.prepare(`
            CREATE TABLE IF NOT EXISTS service_catalog_entries (
                id TEXT PRIMARY KEY NOT NULL,
                code_system TEXT NOT NULL,
                service_code TEXT NOT NULL,
                display_name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'other',
                branch_code TEXT,
                synonyms TEXT,
                source TEXT NOT NULL DEFAULT 'manual',
                version TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                imported_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch())
            )
        `).run();
        sqlite.prepare('CREATE UNIQUE INDEX IF NOT EXISTS service_catalog_entries_code_idx ON service_catalog_entries(code_system, service_code)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_catalog_entries_display_idx ON service_catalog_entries(display_name)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS service_catalog_entries_category_idx ON service_catalog_entries(category)').run();
    } catch (error) {
        console.warn('[MediFlow] Service prescriptions schema check skipped:', error);
    }
    /* @Codex */
    try {
        sqlite.prepare(`
            CREATE TABLE IF NOT EXISTS siss_handoff_events (
                id TEXT PRIMARY KEY NOT NULL,
                patient_id TEXT NOT NULL,
                action TEXT NOT NULL,
                module_label TEXT NOT NULL,
                reason TEXT,
                started_at INTEGER NOT NULL,
                completed_at INTEGER,
                outcome TEXT NOT NULL DEFAULT 'started',
                next_action TEXT,
                notes TEXT,
                correlation_id TEXT,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch()),
                FOREIGN KEY (patient_id) REFERENCES patients(id)
            )
        `).run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS siss_handoff_events_patient_idx ON siss_handoff_events(patient_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS siss_handoff_events_started_idx ON siss_handoff_events(started_at DESC)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS siss_handoff_events_outcome_idx ON siss_handoff_events(outcome)').run();
    } catch (error) {
        console.warn('[MediFlow] SISS handoff events schema check skipped:', error);
    }
    /* @Codex */
    sqlite.prepare(`
        CREATE TABLE IF NOT EXISTS document_diagnosis_proposals (
            id TEXT PRIMARY KEY NOT NULL,
            patient_id TEXT NOT NULL,
            source_document_key TEXT NOT NULL,
            attachment_id TEXT,
            document_insight_id TEXT,
            candidate_key TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            confidence TEXT NOT NULL,
            decided_at INTEGER,
            decision_actor_type TEXT,
            decision_actor_ref TEXT,
            decision_payload TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch()),
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();
    sqlite.prepare('CREATE INDEX IF NOT EXISTS document_diagnosis_proposals_patient_idx ON document_diagnosis_proposals(patient_id)').run();
    sqlite.prepare('CREATE INDEX IF NOT EXISTS document_diagnosis_proposals_patient_status_idx ON document_diagnosis_proposals(patient_id, status)').run();
    sqlite.prepare('CREATE UNIQUE INDEX IF NOT EXISTS document_diagnosis_proposals_source_candidate_unique ON document_diagnosis_proposals(patient_id, source_document_key, candidate_key)').run();
    /* @Codex */
    sqlite.prepare(`
        CREATE TABLE IF NOT EXISTS durable_review_records (
            id TEXT PRIMARY KEY NOT NULL, patient_ref TEXT NOT NULL, review_id TEXT NOT NULL UNIQUE, review_revision INTEGER NOT NULL,
            receipt_ref TEXT NOT NULL, provenance_ref TEXT NOT NULL, receipt_binding TEXT NOT NULL, provenance_binding TEXT NOT NULL,
            presentation_version TEXT NOT NULL, sealed_ciphertext TEXT NOT NULL, sealed_digest TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch())
        )
    `).run();
    ensureColumn('durable_review_records', 'patient_ref', "patient_ref TEXT NOT NULL DEFAULT ''");
    /* @Codex */
    sqlite.prepare(`
        CREATE TABLE IF NOT EXISTS durable_review_operations (
            id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
            operation TEXT NOT NULL, expected_review_revision INTEGER NOT NULL, operation_digest TEXT NOT NULL,
            record_snapshot TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch())
        )
    `).run();
    sqlite.prepare('CREATE UNIQUE INDEX IF NOT EXISTS durable_review_operations_review_key_unique ON durable_review_operations(review_id, idempotency_key)').run();
    /* @Codex */
    sqlite.prepare(DURABLE_REVIEW_PATIENT_LINKS_DDL).run();
    /* @Codex */
    sqlite.prepare(`
        CREATE TABLE IF NOT EXISTS durable_review_command_states (
            review_id TEXT PRIMARY KEY NOT NULL, review_state TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch())
        )
    `).run();
    /* @Codex */
    sqlite.prepare(`
        CREATE TABLE IF NOT EXISTS durable_review_command_operations (
            id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_digest TEXT NOT NULL,
            result_snapshot TEXT NOT NULL, audit_event_id TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch())
        )
    `).run();
    sqlite.prepare('CREATE UNIQUE INDEX IF NOT EXISTS durable_review_command_operations_review_key_unique ON durable_review_command_operations(review_id, idempotency_key)').run();
    // WUL-268 (STREAM A): core tables shipped without secondary indices, so
    // patient-scoped reads and lookups fell back to full table scans (verified
    // via EXPLAIN QUERY PLAN). Guards are the operative migration mechanism, so
    // the indices are created here (idempotent) alongside the drizzle index()
    // declarations in lib/schema.ts. Composite (patient_id, deleted_at) covers the
    // soft-delete tombstone read predicate on tables that carry a deleted_at.
    try {
        sqlite.prepare('CREATE INDEX IF NOT EXISTS entries_patient_idx ON entries(patient_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS entries_patient_deleted_idx ON entries(patient_id, deleted_at)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS entries_date_idx ON entries(date)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS therapies_patient_idx ON therapies(patient_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS therapies_patient_deleted_idx ON therapies(patient_id, deleted_at)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS checkups_patient_idx ON checkups(patient_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS checkups_patient_deleted_idx ON checkups(patient_id, deleted_at)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS checkups_date_idx ON checkups(date)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS observations_patient_deleted_idx ON observations(patient_id, deleted_at)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS attachments_patient_idx ON attachments(patient_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS patients_deleted_idx ON patients(deleted_at)').run();
        sqlite.prepare('CREATE INDEX IF NOT EXISTS patients_last_name_idx ON patients(last_name)').run();
    } catch (error) {
        console.warn('[MediFlow] Core secondary index check skipped:', error);
    }
    /* @Codex */
    try {
        ensureAuditSqliteSchema(sqlite);
    } catch (error) {
        console.warn('[MediFlow] Audit schema check skipped:', error);
    }
    /* @Codex */
    ensureHeadlessSoapEntryCommitSchema();
}

/* @Codex */
function applySchemaGuardsSerially(): void {
    // Next.js production builds load server modules in multiple processes.
    // BEGIN IMMEDIATE lets SQLite arbitrate one schema writer while the other
    // workers wait under busy_timeout, preventing concurrent check-then-ALTER
    // races and duplicate-column warnings.
    sqlite.transaction(() => {
        applySchemaGuards();
        upgradeLegacyAttachmentCurrentness();
    }).immediate();
}

// Next evaluates route modules while collecting build metadata. That phase has
// no runtime authority and must never open, copy, inspect, or migrate the
// persistent clinical database. The in-memory handle above keeps imports
// structurally valid; real bootstrap remains unchanged for dev/server phases.
if (!isNextProductionBuild) applySchemaGuardsSerially();

/**
 * Replaces the SQLite file from sourcePath without writing under the open
 * shared connection: checkpoint + close, swap via the SQLite backup API (with
 * an optional consistent pre-swap backup), then reopen and re-apply the schema
 * guards. Queries issued during the brief swap window fail fast instead of
 * reading a torn file.
 *
 * Swaps are serialized per destination inside replaceSqliteDatabase: a second
 * call while one is running rejects with SqliteSwapInProgressError before
 * touching the shared connection (the route maps it to HTTP 409).
 */
export async function swapDatabaseFromFile(sourcePath: string, backupPath: string | null): Promise<void> {
    await replaceSqliteDatabase({
        sourcePath,
        destPath: dbPath,
        backupPath,
        connection: sqlite,
        reopenConnection: () => {
            sqlite = new Database(dbPath);
            initSqlitePragmas(sqlite);
            applySchemaGuardsSerially();
        },
    });
}

// Stable handle so the shared drizzle instance keeps working across the
// close/reopen performed by swapDatabaseFromFile.
const sqliteHandle = new Proxy({} as Database.Database, {
    get(_target, prop) {
        const value = Reflect.get(sqlite, prop) as unknown;
        return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(sqlite)
            : value;
    },
    // drizzle 0.45.2 never assigns onto the connection, but forward writes to
    // the live connection anyway so they can never land on the dummy target.
    set(_target, prop, value) {
        return Reflect.set(sqlite, prop, value);
    },
});
export const dbServer = drizzle(sqliteHandle);

/* @Codex */
/** Runs a bounded DB mutation under SQLite's writer lock so stale readers cannot race a CAS decision. */
export function runDbServerImmediateTransaction<T>(operation: () => T): T {
    return sqlite.transaction(operation).immediate();
}
