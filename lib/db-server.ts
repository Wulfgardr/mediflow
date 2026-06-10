import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { ensureAuditSqliteSchema } from '@/lib/audit-db';
import { resolveDataPath } from '@/lib/data-dir';

// Ensure the data directory exists in production or use project root for dev
/* @Codex */
const dbPath = resolveDataPath('medical.db');
const legacyDbPath = path.join(process.cwd(), 'medical.db');

if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    try {
        fs.copyFileSync(legacyDbPath, dbPath);
        console.log(`[MediFlow] Copied legacy DB to ${dbPath}`);
    } catch (error) {
        console.error('[MediFlow] Failed to copy legacy DB:', error);
    }
}

const sqlite = new Database(dbPath);
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
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch()),
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();
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
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch()),
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();
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
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch()),
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (prescription_id) REFERENCES service_prescriptions(id)
        )
    `).run();
    ensureColumn('service_prescription_items', 'patient_id', 'patient_id TEXT');
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
try {
    ensureAuditSqliteSchema(sqlite);
} catch (error) {
    console.warn('[MediFlow] Audit schema check skipped:', error);
}
export const dbServer = drizzle(sqlite);
