// ADR 0176: stato della conservazione nell'host. Tutte le funzioni lavorano sulla
// transazione del chiamante; lo scarto passa soltanto dalla cascata canonica.
import { randomUUID } from 'node:crypto';
import { getTableName, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { PATIENT_CHILD_TABLES, purgePatientCascade, totalPatientCascadeRows } from './patient-cascade';
import { projectTerritorialPacks, TERRITORIAL_PACK_SETTING_KEY, TERRITORIAL_PACK_INITIALIZATION_KEY, type TerritorialPackPreset } from './territorial-packs';
import {
    RETENTION_CATEGORIES, RETENTION_CLASSIFICATION, RETENTION_HOLDS_KEY, RETENTION_MAX_HOLDS, RETENTION_PATIENT_TIMESTAMPS,
    RETENTION_SCHEMA, RETENTION_WINDOWS_KEY, RetentionError, assertWindowsRespectProfile, classifyRetentionRow,
    evaluateFascicolo, parseRetentionWindows, retentionHoldsDocumentSchema, retentionProfileForPreset, retentionTermToken,
    retentionWindowsDocumentSchema, type FascicoloEvaluation, type FascicoloFacts, type RetentionCategory,
    type RetentionHold, type RetentionHoldReason, type RetentionHoldsDocument, type RetentionProfileId,
    type RetentionWindowsDocument, RETENTION_HOLD_REASONS,
} from './retention-policy';

export type RetentionRunner = Pick<BetterSQLite3Database, 'all' | 'get' | 'run' | 'select' | 'delete'>;
export type RetentionAuditEvent = {
    eventType: 'retention.windows.changed' | 'retention.hold.placed' | 'retention.hold.released' | 'retention.fascicolo.discarded';
    subjectType: 'settings' | 'patient';
    subjectRef: string;
    flags: string[];
    counts?: number;
};
/** Scrive l'evento nella stessa transazione; un errore annulla l'operazione. */
export type RetentionAuditPort = (event: RetentionAuditEvent) => void;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function readSetting(tx: RetentionRunner, key: string): string | undefined {
    return tx.get<{ value: string } | undefined>(sql`SELECT value FROM settings WHERE key = ${key}`)?.value;
}
function writeSetting(tx: RetentionRunner, key: string, value: string): void {
    tx.run(sql`INSERT INTO settings(key, value) VALUES (${key}, ${value}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    if (readSetting(tx, key) !== value) throw new Error('Retention setting persistence failed');
}

export type RetentionConfiguration =
    | { status: 'ready'; preset: TerritorialPackPreset; profileId: RetentionProfileId; windows: RetentionWindowsDocument; holds: RetentionHoldsDocument }
    | { status: 'configuration_error' };

function parseDocument<T>(raw: string | undefined, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, empty: T): T | null {
    if (raw === undefined) return empty;
    try {
        const parsed = schema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch { return null; }
}

/** Uno stato illeggibile non abilita mai uno scarto: la configurazione risulta in errore. */
export function readRetentionConfiguration(tx: RetentionRunner): RetentionConfiguration {
    const packRaw = readSetting(tx, TERRITORIAL_PACK_SETTING_KEY);
    const marker = readSetting(tx, TERRITORIAL_PACK_INITIALIZATION_KEY);
    const pack = projectTerritorialPacks(packRaw !== undefined && marker === undefined ? 'invalid' : packRaw);
    const windows = parseDocument(readSetting(tx, RETENTION_WINDOWS_KEY), retentionWindowsDocumentSchema,
        { schemaVersion: RETENTION_SCHEMA, revision: 0, windows: {} });
    const holds = parseDocument(readSetting(tx, RETENTION_HOLDS_KEY), retentionHoldsDocumentSchema,
        { schemaVersion: RETENTION_SCHEMA, revision: 0, holds: [] });
    if (pack.status !== 'ready' || !windows || !holds) return { status: 'configuration_error' };
    return { status: 'ready', preset: pack.preset, profileId: retentionProfileForPreset(pack.preset), windows, holds };
}
function requireReady(tx: RetentionRunner) {
    const configuration = readRetentionConfiguration(tx);
    if (configuration.status !== 'ready') throw new RetentionError('configuration_error');
    return configuration;
}

// --- Fatti del fascicolo ---

type PatientRow = { id: string; version: number; is_archived: number | null; deleted_at: number | null; closure: number | null };

const identifier = (name: string) => sql.raw(quote(name));
/** Massimo per riga fra le colonne, poi massimo aggregato; i NULL non annullano il confronto. */
function latestRowExpression(columns: readonly string[]) {
    const coalesced = columns.map(column => `COALESCE(${quote(column)}, 0)`);
    return sql.raw(coalesced.length === 1 ? `MAX(${coalesced[0]})` : `MAX(MAX(${coalesced.join(', ')}))`);
}
function maxTimestamp(tx: RetentionRunner, table: string, columns: readonly string[], patientId: string): number | null {
    const row = tx.get<{ value: number | null } | undefined>(
        sql`SELECT ${latestRowExpression(columns)} AS value FROM ${identifier(table)} WHERE patient_id = ${patientId}`);
    return typeof row?.value === 'number' && row.value > 0 ? row.value : null;
}

/**
 * Categorie presenti e chiusura stimata per eccesso: MediFlow non registra la data
 * di archiviazione, quindi la chiusura è l'ultima data nota del fascicolo.
 */
export function collectFascicoloFacts(tx: RetentionRunner, patient: PatientRow): FascicoloFacts {
    const categories = new Set<RetentionCategory>();
    let closure = patient.closure;
    for (const child of PATIENT_CHILD_TABLES) {
        const table = getTableName(child.table);
        const rule = RETENTION_CLASSIFICATION[child.name];
        if (typeof rule.category === 'string') {
            const present = tx.get(sql`SELECT 1 AS present FROM ${identifier(table)} WHERE patient_id = ${patient.id} LIMIT 1`);
            if (present) categories.add(rule.category);
        } else {
            const values = tx.all<{ value: string | null }>(
                sql`SELECT DISTINCT ${identifier(rule.category.column)} AS value FROM ${identifier(table)} WHERE patient_id = ${patient.id}`);
            for (const { value } of values) categories.add(classifyRetentionRow(child.name, value));
        }
        const latest = maxTimestamp(tx, table, rule.timestamps, patient.id);
        if (latest !== null && (closure === null || latest > closure)) closure = latest;
    }
    return {
        patientId: patient.id,
        version: patient.version,
        archived: patient.is_archived === 1,
        deleted: patient.deleted_at !== null,
        closureEstimate: closure,
        categories: RETENTION_CATEGORIES.filter(category => categories.has(category)),
    };
}

function readPatients(tx: RetentionRunner, patientId?: string): PatientRow[] {
    const columns = sql`id, version, is_archived, deleted_at,
        NULLIF(MAX(${sql.raw(RETENTION_PATIENT_TIMESTAMPS.map(column => `COALESCE(${quote(column)}, 0)`).join(', '))}), 0) AS closure`;
    return patientId === undefined
        ? tx.all<PatientRow>(sql`SELECT ${columns} FROM patients WHERE is_archived = 1 AND deleted_at IS NULL ORDER BY id`)
        : tx.all<PatientRow>(sql`SELECT ${columns} FROM patients WHERE id = ${patientId}`);
}

export type RetentionReview = { evaluatedAt: number; items: FascicoloEvaluation[] };

/** Valuta i fascicoli chiusi. Nessuna scrittura. */
export function reviewRetention(tx: RetentionRunner, nowSeconds: number): RetentionReview & { configuration: RetentionConfiguration } {
    const configuration = readRetentionConfiguration(tx);
    if (configuration.status !== 'ready') return { configuration, evaluatedAt: nowSeconds, items: [] };
    const items = readPatients(tx).map(patient => evaluateFascicolo(collectFascicoloFacts(tx, patient),
        configuration.profileId, configuration.windows.windows, configuration.holds.holds, nowSeconds));
    return { configuration, evaluatedAt: nowSeconds, items };
}

// --- Finestre ---

export function commitRetentionWindows(tx: RetentionRunner, input: unknown, audit: RetentionAuditPort): RetentionWindowsDocument {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RetentionError('input_invalid');
    const body = input as Record<string, unknown>;
    if (body.confirmed !== true || !Number.isSafeInteger(body.expectedRevision)) throw new RetentionError('input_invalid');
    const windows = parseRetentionWindows(body.windows);
    const configuration = requireReady(tx);
    if (body.expectedRevision !== configuration.windows.revision) throw new RetentionError('conflict');
    assertWindowsRespectProfile(configuration.profileId, windows);
    const next: RetentionWindowsDocument = { schemaVersion: RETENTION_SCHEMA, revision: configuration.windows.revision + 1, windows };
    writeSetting(tx, RETENTION_WINDOWS_KEY, JSON.stringify(next));
    audit({ eventType: 'retention.windows.changed', subjectType: 'settings', subjectRef: RETENTION_WINDOWS_KEY,
        flags: [`profile:${configuration.profileId}`, ...Object.entries(windows)
            .map(([category, window]) => `window:${category}:${window.kind === 'years' ? `P${window.years}Y` : 'unlimited'}`)] });
    return next;
}

// --- Blocchi ---

export function placeRetentionHold(tx: RetentionRunner, input: unknown, actorRef: string, nowSeconds: number,
    audit: RetentionAuditPort): RetentionHoldsDocument {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RetentionError('input_invalid');
    const body = input as Record<string, unknown>;
    const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
    const attachmentId = typeof body.attachmentId === 'string' && body.attachmentId.trim() ? body.attachmentId.trim() : null;
    if (body.confirmed !== true || !Number.isSafeInteger(body.expectedRevision) || !patientId || patientId.length > 200
        || (attachmentId !== null && attachmentId.length > 200)
        || !RETENTION_HOLD_REASONS.includes(body.reason as RetentionHoldReason)) throw new RetentionError('input_invalid');
    const configuration = requireReady(tx);
    if (body.expectedRevision !== configuration.holds.revision) throw new RetentionError('conflict');
    if (!tx.get(sql`SELECT 1 AS present FROM patients WHERE id = ${patientId}`)) throw new RetentionError('not_found');
    if (attachmentId !== null && !tx.get(sql`SELECT 1 AS present FROM attachments WHERE id = ${attachmentId} AND patient_id = ${patientId}`)) {
        throw new RetentionError('not_found');
    }
    const existing = configuration.holds.holds.find(hold => hold.patientId === patientId && hold.attachmentId === attachmentId);
    if (existing) return configuration.holds;
    if (configuration.holds.holds.length >= RETENTION_MAX_HOLDS) throw new RetentionError('input_invalid');
    const hold: RetentionHold = { id: randomUUID(), scope: attachmentId ? 'document' : 'patient', patientId, attachmentId,
        reason: body.reason as RetentionHoldReason, placedAt: nowSeconds, placedBy: actorRef.slice(0, 200) };
    const next: RetentionHoldsDocument = { schemaVersion: RETENTION_SCHEMA, revision: configuration.holds.revision + 1,
        holds: [...configuration.holds.holds, hold] };
    writeSetting(tx, RETENTION_HOLDS_KEY, JSON.stringify(next));
    audit({ eventType: 'retention.hold.placed', subjectType: 'patient', subjectRef: patientId,
        flags: [`hold:${hold.id}`, `scope:${hold.scope}`, `reason:${hold.reason}`, ...(attachmentId ? [`attachment:${attachmentId}`] : [])] });
    return next;
}

export function releaseRetentionHold(tx: RetentionRunner, input: unknown, audit: RetentionAuditPort): RetentionHoldsDocument {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RetentionError('input_invalid');
    const body = input as Record<string, unknown>;
    if (body.confirmed !== true || !Number.isSafeInteger(body.expectedRevision) || typeof body.holdId !== 'string') throw new RetentionError('input_invalid');
    const configuration = requireReady(tx);
    if (body.expectedRevision !== configuration.holds.revision) throw new RetentionError('conflict');
    const hold = configuration.holds.holds.find(item => item.id === body.holdId);
    if (!hold) throw new RetentionError('not_found');
    const next: RetentionHoldsDocument = { schemaVersion: RETENTION_SCHEMA, revision: configuration.holds.revision + 1,
        holds: configuration.holds.holds.filter(item => item.id !== hold.id) };
    writeSetting(tx, RETENTION_HOLDS_KEY, JSON.stringify(next));
    audit({ eventType: 'retention.hold.released', subjectType: 'patient', subjectRef: hold.patientId,
        flags: [`hold:${hold.id}`, `scope:${hold.scope}`, `reason:${hold.reason}`] });
    return next;
}

/** Ogni percorso di cancellazione definitiva di un paziente lo chiama sotto il proprio lock di scrittura. */
export function assertNoRetentionHold(tx: RetentionRunner, patientId: string): void {
    const raw = readSetting(tx, RETENTION_HOLDS_KEY);
    if (raw === undefined) return;
    const holds = parseDocument(raw, retentionHoldsDocumentSchema, null);
    // Un elenco illeggibile vale come blocco: meglio fermare che cancellare.
    if (!holds || holds.holds.some(hold => hold.patientId === patientId)) throw new RetentionError('legal_hold');
}

// --- Scarto ---

export type RetentionDiscardReceipt = {
    patientId: string;
    category: RetentionCategory;
    term: string;
    sourceId: string | null;
    profileId: RetentionProfileId;
    closureEstimate: number;
    expiresAt: number;
    removedRows: number;
};

/**
 * Scarto confermato dal medico: rivaluta sotto il lock, richiede la stessa scadenza
 * mostrata, nessun blocco e la versione corrente, poi cancella con la cascata canonica.
 */
export function discardExpiredFascicolo(tx: RetentionRunner, input: unknown, nowSeconds: number,
    audit: RetentionAuditPort): RetentionDiscardReceipt {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RetentionError('input_invalid');
    const body = input as Record<string, unknown>;
    const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
    if (body.confirmed !== true || !patientId || !Number.isSafeInteger(body.expectedVersion)
        || !Number.isSafeInteger(body.expectedExpiresAt)) throw new RetentionError('input_invalid');
    const configuration = requireReady(tx);
    const [patient] = readPatients(tx, patientId);
    if (!patient?.id) throw new RetentionError('not_found');
    if (patient.version !== body.expectedVersion) throw new RetentionError('conflict');
    const evaluation = evaluateFascicolo(collectFascicoloFacts(tx, patient), configuration.profileId,
        configuration.windows.windows, configuration.holds.holds, nowSeconds);
    if (evaluation.status === 'held') throw new RetentionError('legal_hold');
    if (evaluation.status !== 'expired' || !evaluation.governing || evaluation.expiresAt === null || evaluation.closureEstimate === null) {
        throw new RetentionError('not_expired');
    }
    if (evaluation.expiresAt !== body.expectedExpiresAt) throw new RetentionError('expiry_changed');
    assertNoRetentionHold(tx, patientId);

    tx.run(sql`INSERT INTO patient_retired_ids(id) VALUES (${patientId}) ON CONFLICT(id) DO NOTHING`);
    const counts = purgePatientCascade(tx, patientId);
    const deleted = tx.run(sql`DELETE FROM patients WHERE id = ${patientId} AND version = ${patient.version} AND deleted_at IS NULL`);
    if (deleted.changes !== 1) throw new Error('Retention discard did not delete exactly one patient');
    const receipt: RetentionDiscardReceipt = {
        patientId,
        category: evaluation.governing.category,
        term: retentionTermToken(evaluation.governing.term),
        sourceId: evaluation.governing.sourceId,
        profileId: configuration.profileId,
        closureEstimate: evaluation.closureEstimate,
        expiresAt: evaluation.expiresAt,
        removedRows: totalPatientCascadeRows(counts) + 1,
    };
    audit({ eventType: 'retention.fascicolo.discarded', subjectType: 'patient', subjectRef: patientId, counts: receipt.removedRows,
        flags: [`profile:${receipt.profileId}`, `category:${receipt.category}`, `term:${receipt.term}:record_closure`,
            `source:${receipt.sourceId ?? 'owner'}`, `closure:${receipt.closureEstimate}`, `expired:${receipt.expiresAt}`,
            ...Object.entries(counts).map(([table, count]) => `purged:${table}:${count}`)] });
    return receipt;
}

// --- Vista per Impostazioni ---

export type RetentionOverview =
    | { status: 'configuration_error'; evaluatedAt: number }
    | {
        status: 'ready';
        evaluatedAt: number;
        preset: TerritorialPackPreset;
        profileId: RetentionProfileId;
        windowsRevision: number;
        windows: RetentionWindowsDocument['windows'];
        holdsRevision: number;
        holds: RetentionHold[];
        counts: Record<FascicoloEvaluation['status'], number>;
        /** Fascicoli scaduti o sospesi da un blocco: l'elenco di revisione. */
        review: FascicoloEvaluation[];
    };

export function retentionOverview(tx: RetentionRunner, nowSeconds: number): RetentionOverview {
    const { configuration, items, evaluatedAt } = reviewRetention(tx, nowSeconds);
    if (configuration.status !== 'ready') return { status: 'configuration_error', evaluatedAt };
    const counts = { deleted: 0, open: 0, held: 0, closure_unknown: 0, unlimited: 0, unset: 0, in_retention: 0, expired: 0 };
    for (const item of items) counts[item.status] += 1;
    counts.open = tx.get<{ count: number }>(sql`SELECT count(*) AS count FROM patients WHERE deleted_at IS NULL AND COALESCE(is_archived, 0) = 0`)?.count ?? 0;
    return {
        status: 'ready', evaluatedAt, preset: configuration.preset, profileId: configuration.profileId,
        windowsRevision: configuration.windows.revision, windows: configuration.windows.windows,
        holdsRevision: configuration.holds.revision, holds: configuration.holds.holds, counts,
        review: items.filter(item => item.status === 'expired' || item.status === 'held'),
    };
}
