/* @Codex */
import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { parseProstheticsCsv } from './prosthetics-catalog-parser';
import { prostheticsIdentity, type ProstheticsRow, type ProstheticsEntry, type ProstheticsManifest, type ProstheticsChanges, type ProstheticsReceipt, type ProstheticsStatus, type ProstheticsPreview } from './prosthetics-catalog-contract';

export class ProstheticsCatalogError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
// ADR 0127 protocol, domain-separated proof. Shared across Next route bundles, not persisted.
const secretSymbol = Symbol.for('mediflow.prosthetics-catalog.preview-secret.v1');
const processState = globalThis as typeof globalThis & { [secretSymbol]?: Buffer };
const secret = processState[secretSymbol] ??= randomBytes(32);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mac = (value: string) => createHmac('sha256', secret).update(value).digest();
type Proof = { manifestHash: string; revision: string; actor: string; expires: number };
function sign(manifest: ProstheticsManifest, revision: string, actor: string) {
    const payload = Buffer.from(JSON.stringify({ manifestHash: hash(manifest), revision, actor, expires: Date.now() + 30 * 60_000 })).toString('base64url');
    return `${payload}.${mac(payload).toString('base64url')}`;
}
function verify(proof: string, manifest: ProstheticsManifest, actor: string): Proof {
    const fail = () => new ProstheticsCatalogError('PREVIEW_EXPIRED_OR_CHANGED', 'Anteprima scaduta o modificata: genera una nuova anteprima.', 409);
    if (typeof proof !== 'string' || proof.length > 4096) throw fail();
    const parts = proof.split('.');
    if (parts.length !== 2) throw fail();
    const signature = Buffer.from(parts[1], 'base64url');
    if (signature.length !== 32 || !timingSafeEqual(signature, mac(parts[0]))) throw fail();
    let data: Proof;
    try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw fail(); }
    if (!data || data.actor !== actor || data.manifestHash !== hash(manifest) || !Number.isSafeInteger(data.expires)
        || data.expires <= Date.now() || typeof data.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(data.revision)) throw fail();
    return data;
}
const SELECT_ENTRIES = `SELECT id, code_system AS codeSystem, code, description, version, source, scope,
    start_date AS startDate, end_date AS endDate, source_sha256 AS sourceSha256,
    operation_key AS operationKey, imported_at AS importedAt FROM prosthetics_catalog_entries`;
const count = (connection: Database.Database) => (connection.prepare('SELECT count(*) n FROM prosthetics_catalog_entries').get() as { n: number }).n;
function latest(connection: Database.Database): ProstheticsReceipt | null {
    const row = connection.prepare('SELECT receipt_json FROM prosthetics_catalog_receipts ORDER BY id DESC LIMIT 1').get() as { receipt_json: string } | undefined;
    return row ? JSON.parse(row.receipt_json) as ProstheticsReceipt : null;
}
function revision(connection: Database.Database, operationKey?: string): string {
    return hash({ rows: connection.prepare(`${SELECT_ENTRIES} ORDER BY id COLLATE BINARY`).all(), operationKey: operationKey ?? latest(connection)?.operationKey ?? null });
}
function changes(connection: Database.Database, rows: ProstheticsRow[]): ProstheticsChanges {
    const existing = connection.prepare(`${SELECT_ENTRIES} WHERE id = ?`);
    const result = { inserted: 0, updated: 0, unchanged: 0 };
    for (const row of rows) {
        const previous = existing.get(prostheticsIdentity(row)) as ProstheticsEntry | undefined;
        if (!previous) result.inserted++;
        else if ((Object.keys(row) as (keyof ProstheticsRow)[]).every(key => previous[key] === row[key])) result.unchanged++;
        else result.updated++;
    }
    return result;
}

/** Host-owned named application service; accepts only its caller's active authority fence. */
export function createProstheticsCatalog(connection: Database.Database) {
    return {
        status(): ProstheticsStatus {
            return connection.transaction(() => ({ revision: revision(connection), count: count(connection), latestReceipt: latest(connection) }))();
        },
        preview(bytes: Uint8Array, sourceName: string, actor: string): ProstheticsPreview {
            const parsed = parseProstheticsCsv(bytes, sourceName);
            return connection.transaction(() => {
                const current = revision(connection);
                const delta = parsed.valid ? changes(connection, parsed.rows) : null;
                if (delta && count(connection) + delta.inserted > 100_000) throw new ProstheticsCatalogError('CATALOG_LIMIT', 'Il repertorio può contenere al massimo 100.000 voci.', 409);
                return { valid: parsed.valid, manifest: parsed.manifest, revision: current,
                    proof: parsed.valid ? sign(parsed.manifest, current, actor) : null,
                    diagnostics: parsed.diagnostics, diagnosticsTruncated: parsed.diagnosticsTruncated,
                    sample: parsed.rows.slice(0, 10), changes: delta };
            })();
        },
        commit(input: { bytes: Uint8Array; sourceName: string; proof: string; acceptSubset: boolean }, actor: string, assertCurrent: () => void) {
            assertCurrent();
            if (input.acceptSubset !== true) throw new ProstheticsCatalogError('CONFIRMATION_REQUIRED', 'Conferma fonte e campi prima di importare.');
            const parsed = parseProstheticsCsv(input.bytes, input.sourceName);
            if (!parsed.valid) throw new ProstheticsCatalogError('INVALID_FILE', 'File non valido: correggi gli errori e genera una nuova anteprima.');
            const proof = verify(input.proof, parsed.manifest, actor);
            const operationKey = hash({ manifest: parsed.manifest, previousRevision: proof.revision });
            return connection.transaction(() => {
                assertCurrent();
                const previous = connection.prepare('SELECT receipt_json FROM prosthetics_catalog_receipts WHERE operation_key = ?').get(operationKey) as { receipt_json: string } | undefined;
                if (previous) return { receipt: JSON.parse(previous.receipt_json) as ProstheticsReceipt, replayed: true };
                if (revision(connection) !== proof.revision) throw new ProstheticsCatalogError('CATALOG_REVISION_CONFLICT', 'Il repertorio è cambiato: genera una nuova anteprima.', 409);
                const receiptCount = (connection.prepare('SELECT count(*) n FROM prosthetics_catalog_receipts').get() as { n: number }).n;
                if (receiptCount >= 100_000) throw new ProstheticsCatalogError('RECEIPT_LIMIT', 'Limite di 100.000 import raggiunto. Il repertorio resta consultabile.', 409);
                const delta = changes(connection, parsed.rows);
                if (count(connection) + delta.inserted > 100_000) throw new ProstheticsCatalogError('CATALOG_LIMIT', 'Il repertorio può contenere al massimo 100.000 voci.', 409);
                const committedAt = new Date().toISOString();
                const upsert = connection.prepare(`INSERT INTO prosthetics_catalog_entries
                    (id, code_system, code, description, version, source, scope, start_date, end_date, source_sha256, operation_key, imported_at)
                    VALUES (@id, @codeSystem, @code, @description, @version, @source, @scope, @startDate, @endDate, @sourceSha256, @operationKey, @importedAt)
                    ON CONFLICT(id) DO UPDATE SET description = excluded.description, version = excluded.version,
                    source = excluded.source, start_date = excluded.start_date, end_date = excluded.end_date,
                    source_sha256 = excluded.source_sha256, operation_key = excluded.operation_key, imported_at = excluded.imported_at`);
                for (const row of parsed.rows) upsert.run({ ...row, id: prostheticsIdentity(row), sourceSha256: parsed.manifest.sha256, operationKey, importedAt: committedAt });
                const receipt: ProstheticsReceipt = { operationKey, manifest: parsed.manifest, previousRevision: proof.revision,
                    revision: revision(connection, operationKey), applied: parsed.rows.length, changes: delta, committedAt };
                connection.prepare('INSERT INTO prosthetics_catalog_receipts (operation_key, receipt_json) VALUES (?, ?)').run(operationKey, JSON.stringify(receipt));
                assertCurrent();
                return { receipt, replayed: false };
            }).immediate();
        },
        search(query: string): { revision: string; entries: ProstheticsEntry[]; truncated: boolean } {
            if (typeof query !== 'string' || query.length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(query)) throw new ProstheticsCatalogError('INVALID_QUERY', 'Ricerca non valida: massimo 200 caratteri.');
            return connection.transaction(() => {
                // Escape wildcards: user text is a literal search, not a LIKE expression.
                const pattern = `%${query.replace(/[\\%_]/gu, '\\$&')}%`;
                const entries = connection.prepare(`${SELECT_ENTRIES} WHERE code LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR code_system LIKE ? ESCAPE '\\'
                    ORDER BY code_system COLLATE BINARY, code COLLATE BINARY, scope COLLATE BINARY LIMIT 51`).all(pattern, pattern, pattern) as ProstheticsEntry[];
                return { revision: revision(connection), entries: entries.slice(0, 50), truncated: entries.length > 50 };
            })();
        },
    };
}
export type ProstheticsCatalog = ReturnType<typeof createProstheticsCatalog>;
