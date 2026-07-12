import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { ensureAuditSqliteSchema } from '@/lib/security/audit-db';
import { resolveDataPath } from '@/lib/data-dir';
import { copySqliteDatabaseSync, replaceSqliteDatabase } from '@/lib/sqlite-repair';
import { initSqlitePragmas } from '@/lib/sqlite-pragmas';

// Ensure the data directory exists in production or use project root for dev
/* @Codex */
const dbPath = resolveDataPath('medical.db');
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
recoverSwapArtifacts();

if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
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
type TableInfoRow = { name: string };
/* @Codex */
function ensureColumn(table: string, columnName: string, columnSql: string) {
    const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[]).map((col) => col.name);
    if (!columns.includes(columnName)) {
        sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`).run();
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
        ensureColumn('observations', 'service_prescription_item_id', 'service_prescription_item_id TEXT REFERENCES service_prescription_items(id)');
        sqlite.prepare("CREATE INDEX IF NOT EXISTS observations_patient_idx ON observations(patient_id)").run();
        sqlite.prepare("CREATE INDEX IF NOT EXISTS observations_code_idx ON observations(code_system, code)").run();
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
}
applySchemaGuards();

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
            applySchemaGuards();
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
