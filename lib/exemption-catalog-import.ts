/* @Codex */
import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { parseExemptionImport } from './exemption-import-parser';
import type { ExemptionCatalogStatus, ExemptionImportManifest, ExemptionImportPreview, ExemptionImportReceipt } from './exemption-import-contract';

export class ExemptionImportError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

// Shared across Next route bundles in this process; never stored in catalog or sent to the client.
const secretSymbol = Symbol.for('mediflow.exemption-import.preview-secret.v1');
const processState = globalThis as typeof globalThis & { [secretSymbol]?: Buffer };
const secret = processState[secretSymbol] ??= randomBytes(32);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type PreviewProof = { manifestHash: string; revision: string; actor: string; expires: number };
const mac = (payload: string) => createHmac('sha256', secret).update(payload).digest();
function signProof(manifest: ExemptionImportManifest, revision: string, actor: string): string {
    const payload = Buffer.from(JSON.stringify({ manifestHash: hash(manifest), revision, actor, expires: Date.now() + 30 * 60_000 })).toString('base64url');
    return `${payload}.${mac(payload).toString('base64url')}`;
}
function verifyProof(proof: string, manifest: ExemptionImportManifest, actor: string): PreviewProof {
    const fail = () => new ExemptionImportError('PREVIEW_EXPIRED_OR_CHANGED', 'Anteprima scaduta o modificata: genera una nuova anteprima.', 409);
    if (typeof proof !== 'string' || proof.length > 4096) throw fail();
    const parts = proof.split('.');
    if (parts.length !== 2) throw fail();
    const signature = Buffer.from(parts[1], 'base64url');
    if (signature.length !== 32 || !timingSafeEqual(signature, mac(parts[0]))) throw fail();
    let data: PreviewProof;
    try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw fail(); }
    if (!data || data.actor !== actor || data.manifestHash !== hash(manifest)
        || !Number.isSafeInteger(data.expires) || data.expires <= Date.now()
        || typeof data.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(data.revision)) throw fail();
    return data;
}

const CATALOG_ROWS = 'SELECT code, description, type, source, start_date, end_date, is_pharma, is_specialist, is_national, updated_at FROM exemptions ORDER BY code COLLATE BINARY';
function latest(connection: Database.Database): ExemptionImportReceipt | null {
    const row = connection.prepare('SELECT receipt_json FROM exemption_import_receipts ORDER BY id DESC LIMIT 1').get() as { receipt_json: string } | undefined;
    return row ? JSON.parse(row.receipt_json) as ExemptionImportReceipt : null;
}
function revision(connection: Database.Database, latestOperationKey?: string): string {
    // Include the operation key, not the resulting revision, to avoid a circular digest.
    return hash({ rows: connection.prepare(CATALOG_ROWS).all(), latestOperationKey: latestOperationKey ?? latest(connection)?.operationKey ?? null });
}

export function readExemptionImportStatus(connection: Database.Database): ExemptionCatalogStatus {
    return connection.transaction(() => ({
        revision: revision(connection),
        count: (connection.prepare('SELECT count(*) AS count FROM exemptions').get() as { count: number }).count,
        latestReceipt: latest(connection),
    }))();
}

export function previewExemptionImport(connection: Database.Database, bytes: Uint8Array, sourceName: string, actor: string): ExemptionImportPreview {
    const parsed = parseExemptionImport(bytes, sourceName);
    const current = readExemptionImportStatus(connection).revision;
    return {
        manifest: parsed.manifest, revision: current, valid: parsed.valid,
        diagnostics: parsed.diagnostics, sample: parsed.rows.slice(0, 10),
        proof: parsed.valid ? signProof(parsed.manifest, current, actor) : null,
    };
}

export function commitExemptionImport(
    connection: Database.Database,
    input: { bytes: Uint8Array; sourceName: string; proof: string; acceptSubset: boolean },
    actor: string,
    assertCurrent?: () => void,
): { receipt: ExemptionImportReceipt; replayed: boolean } {
    if (input.acceptSubset !== true) throw new ExemptionImportError('SUBSET_CONFIRMATION_REQUIRED', 'Conferma il subset e le colonne escluse.');
    const parsed = parseExemptionImport(input.bytes, input.sourceName);
    if (!parsed.valid) throw new ExemptionImportError('INVALID_EXEMPTION_FILE', 'File non valido: genera una nuova anteprima.');
    const proof = verifyProof(input.proof, parsed.manifest, actor);
    const operationKey = hash({ manifest: parsed.manifest, previousRevision: proof.revision });
    return connection.transaction(() => {
        assertCurrent?.();
        const previous = connection.prepare('SELECT receipt_json FROM exemption_import_receipts WHERE operation_key = ?').get(operationKey) as { receipt_json: string } | undefined;
        if (previous) return { receipt: JSON.parse(previous.receipt_json) as ExemptionImportReceipt, replayed: true };
        if (revision(connection) !== proof.revision) {
            throw new ExemptionImportError('CATALOG_REVISION_CONFLICT', 'Il repertorio è cambiato: genera una nuova anteprima prima di importare.', 409);
        }
        const existing = connection.prepare('SELECT 1 FROM exemptions WHERE code = ?');
        const upsert = connection.prepare(`INSERT INTO exemptions
            (code, description, type, source, start_date, end_date, is_pharma, is_specialist, is_national, updated_at)
            VALUES (@code, @description, @type, @source, @startDate, @endDate, @isPharma, @isSpecialist, @isNational, @updatedAt)
            ON CONFLICT(code) DO UPDATE SET description = excluded.description, type = excluded.type,
            source = excluded.source, start_date = excluded.start_date, end_date = excluded.end_date,
            is_pharma = excluded.is_pharma, is_specialist = excluded.is_specialist,
            is_national = excluded.is_national, updated_at = excluded.updated_at`);
        let inserted = 0;
        const committedAt = new Date().toISOString();
        const updatedAt = Math.floor(Date.parse(committedAt) / 1000);
        for (const row of parsed.rows) {
            if (!existing.get(row.code)) inserted++;
            upsert.run({ ...row, source: parsed.manifest.sourceName, updatedAt,
                isPharma: row.isPharma === null ? null : Number(row.isPharma),
                isSpecialist: row.isSpecialist === null ? null : Number(row.isSpecialist),
                isNational: row.isNational === null ? null : Number(row.isNational),
            });
        }
        const receipt: ExemptionImportReceipt = {
            operationKey, manifest: parsed.manifest, previousRevision: proof.revision,
            revision: revision(connection, operationKey), applied: parsed.rows.length,
            inserted, updated: parsed.rows.length - inserted, committedAt,
        };
        assertCurrent?.();
        connection.prepare('INSERT INTO exemption_import_receipts (operation_key, receipt_json) VALUES (?, ?)').run(operationKey, JSON.stringify(receipt));
        return { receipt, replayed: false };
    }).immediate();
}
