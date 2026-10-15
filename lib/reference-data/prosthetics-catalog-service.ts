/* @Codex */
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { buildAttachmentPath } from '../attachment-path';
import { getAttachmentPayloadByteSize, resolveMaxAttachmentBytes } from '../attachment-payload';
import { parseProstheticsCsv } from './prosthetics-catalog-parser';
import { prostheticsImportSource, prostheticsSourceId, prostheticsIdentity, isProstheticsText, type ProstheticsImportOptions, type ProstheticsSourceRecord, type ProstheticsDocument, type ProstheticsCatalogSelection, type ProstheticsSnapshot, type ProstheticsRow, type ProstheticsEntry, type ProstheticsManifest, type ProstheticsChanges, type ProstheticsReceipt, type ProstheticsStatus, type ProstheticsPreview } from './prosthetics-catalog-contract';

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
const SELECT_ENTRIES = `SELECT id, source_id AS sourceId, code_system AS codeSystem, code, description, version, source, scope,
    start_date AS startDate, end_date AS endDate, source_sha256 AS sourceSha256,
    operation_key AS operationKey, imported_at AS importedAt FROM prosthetics_catalog_entries`;
const count = (connection: Database.Database) => (connection.prepare('SELECT count(*) n FROM prosthetics_catalog_entries').get() as { n: number }).n;
function latest(connection: Database.Database): ProstheticsReceipt | null {
    const row = connection.prepare('SELECT receipt_json FROM prosthetics_catalog_receipts ORDER BY id DESC LIMIT 1').get() as { receipt_json: string } | undefined;
    return row ? JSON.parse(row.receipt_json) as ProstheticsReceipt : null;
}
function revision(connection: Database.Database, operationKey?: string): string {
    return hash({ rows: connection.prepare(`${SELECT_ENTRIES} ORDER BY id COLLATE BINARY`).all(), sources: connection.prepare('SELECT * FROM prosthetics_catalog_sources ORDER BY id').all(), documents: connection.prepare('SELECT id,source_id,name,sha256,size,page,operation_key FROM prosthetics_catalog_documents ORDER BY id').all(), operationKey: operationKey ?? latest(connection)?.operationKey ?? null });
}
function changes(connection: Database.Database, rows: (ProstheticsRow & { sourceId: string })[]): ProstheticsChanges {
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
        sources(): { sources: (ProstheticsSourceRecord & { documents: ProstheticsDocument[] })[]; revision: string } {
            return connection.transaction(() => ({ revision: revision(connection), sources: (connection.prepare('SELECT * FROM prosthetics_catalog_sources ORDER BY name,id').all() as ProstheticsSourceRecord[])
                .map(source => ({ ...source, documents: documents(connection, source.id) })) }))();
        },
        addDocument(input: { sourceId: string; revision: string; name: string; base64: string; page: string | null }, assertCurrent: () => void) {
            assertPrivateArchive(connection);
            const bytes = decodeProstheticsDocument(input.base64);
            if (!isProstheticsText(input.name) || (input.page !== null && !isProstheticsText(input.page, 100))) throw new ProstheticsCatalogError('INVALID_DOCUMENT', 'Nome o pagina non validi.');
            return connection.transaction(() => {
                assertCurrent();
                if (revision(connection) !== input.revision) throw new ProstheticsCatalogError('CATALOG_REVISION_CONFLICT', 'Il repertorio è cambiato: rileggi le fonti.', 409);
                if (!connection.prepare('SELECT 1 FROM prosthetics_catalog_sources WHERE id=?').get(input.sourceId)) throw new ProstheticsCatalogError('SOURCE_NOT_FOUND', 'Fonte non disponibile.', 404);
                const total = connection.prepare('SELECT coalesce(sum(size),0) n, count(*) c FROM prosthetics_catalog_documents').get() as { n: number; c: number };
                if (total.n + bytes.length > 100 * 1024 * 1024 || total.c >= 1000) throw new ProstheticsCatalogError('DOCUMENT_LIMIT', 'Limite degli originali raggiunto (100 MiB o 1.000 documenti).', 409);
                const id = randomUUID();
                const doc: ProstheticsDocument = { id, sourceId: input.sourceId, name: buildAttachmentPath(null, input.name, id).slice('attachments/'.length),
                    sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, page: input.page };
                const result = connection.prepare(`INSERT INTO prosthetics_catalog_documents (id,source_id,name,sha256,size,page,bytes,operation_key)
                    VALUES (@id,@sourceId,@name,@sha256,@size,@page,@bytes,@operationKey)`).run({ ...doc, bytes, operationKey: currentSourceImport(connection, input.sourceId) });
                if (result.changes !== 1) throw new Error('PROSTHETICS_DOCUMENT_WRITE_FAILED');
                assertCurrent(); return doc;
            }).immediate();
        },
        document(id: string, expectedHash?: string) {
            assertPrivateArchive(connection);
            const doc = connection.prepare('SELECT id, source_id AS sourceId, name, sha256, size, page, bytes FROM prosthetics_catalog_documents WHERE id=?').get(id) as (ProstheticsDocument & { bytes: Buffer }) | undefined;
            if (!doc) throw new ProstheticsCatalogError('DOCUMENT_NOT_FOUND', 'Originale non disponibile.', 404);
            const bytes = doc.bytes;
            if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 25 * 1024 * 1024 || bytes.length !== doc.size || createHash('sha256').update(bytes).digest('hex') !== doc.sha256 || (expectedHash && doc.sha256 !== expectedHash))
                throw new ProstheticsCatalogError('DOCUMENT_CHANGED', 'Originale modificato: integrità non verificata.', 409);
            if (buildAttachmentPath(`attachments/${doc.name}`, doc.name, doc.id) !== `attachments/${doc.name}`)
                throw new ProstheticsCatalogError('DOCUMENT_CHANGED', 'Nome originale modificato: integrità non verificata.', 409);
            return { ...doc, bytes };
        },
        snapshot(selection: ProstheticsCatalogSelection): ProstheticsSnapshot {
            if (revision(connection) !== selection.revision) throw new ProstheticsCatalogError('CATALOG_REVISION_CONFLICT', 'Il repertorio è cambiato: scegli nuovamente la voce.', 409);
            const entry = connection.prepare(`${SELECT_ENTRIES} WHERE id=?`).get(selection.entryId) as ProstheticsEntry | undefined;
            if (!entry) throw new ProstheticsCatalogError('ENTRY_NOT_FOUND', 'Voce non disponibile.', 409);
            const row = connection.prepare('SELECT receipt_json FROM prosthetics_catalog_receipts WHERE operation_key=?').get(entry.operationKey) as { receipt_json: string } | undefined;
            if (!row) throw new ProstheticsCatalogError('SOURCE_NOT_FOUND', 'Provenienza della voce non disponibile.', 409);
            const receipt = JSON.parse(row.receipt_json) as ProstheticsReceipt;
            const source = prostheticsImportSource(receipt.manifest, entry.sourceId);
            if (source.sha256 !== entry.sourceSha256 || source.version !== entry.version || source.name !== entry.source || source.scope !== entry.scope
                || (receipt.manifest.options?.sourceDetails?.id ?? prostheticsSourceId(receipt.manifest.metadata!)) !== entry.sourceId)
                throw new ProstheticsCatalogError('SOURCE_CHANGED', 'Provenienza della voce incoerente.', 409);
            const originals = documents(connection, source.id, entry.operationKey);
            for (const doc of originals) this.document(doc.id, doc.sha256);
            return { entryId: entry.id, code: entry.code, codeSystem: entry.codeSystem, description: entry.description,
                source, documents: originals, revision: selection.revision, operationKey: entry.operationKey };
        },
        status(): ProstheticsStatus {
            return connection.transaction(() => ({ revision: revision(connection), count: count(connection), sourceCount: (connection.prepare('SELECT count(*) n FROM prosthetics_catalog_sources').get() as { n: number }).n, latestReceipt: latest(connection) }))();
        },
        preview(bytes: Uint8Array, sourceName: string, actor: string, options?: ProstheticsImportOptions): ProstheticsPreview {
            const parsed = parseProstheticsCsv(bytes, sourceName, options);
            return connection.transaction(() => {
                const current = revision(connection);
                const delta = parsed.valid ? changes(connection, parsed.rows.map(row => ({ ...row, sourceId: parsed.manifest.options?.sourceDetails?.id ?? prostheticsSourceId(row) }))) : null;
                if (delta && count(connection) + delta.inserted > 100_000) throw new ProstheticsCatalogError('CATALOG_LIMIT', 'Il repertorio può contenere al massimo 100.000 voci.', 409);
                return { valid: parsed.valid, manifest: parsed.manifest, revision: current,
                    proof: parsed.valid ? sign(parsed.manifest, current, actor) : null,
                    diagnostics: parsed.diagnostics, diagnosticsTruncated: parsed.diagnosticsTruncated,
                    sample: parsed.rows.slice(0, 10), changes: delta };
            })();
        },
        commit(input: { bytes: Uint8Array; sourceName: string; proof: string; acceptSubset: boolean; options?: ProstheticsImportOptions }, actor: string, assertCurrent: () => void) {
            assertCurrent();
            if (input.acceptSubset !== true) throw new ProstheticsCatalogError('CONFIRMATION_REQUIRED', 'Conferma fonte e campi prima di importare.');
            const parsed = parseProstheticsCsv(input.bytes, input.sourceName, input.options);
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
                const delta = changes(connection, parsed.rows.map(row => ({ ...row, sourceId: parsed.manifest.options?.sourceDetails?.id ?? prostheticsSourceId(row) })));
                if (count(connection) + delta.inserted > 100_000) throw new ProstheticsCatalogError('CATALOG_LIMIT', 'Il repertorio può contenere al massimo 100.000 voci.', 409);
                const metadata = parsed.manifest.metadata!;
                const sourceId = input.options?.sourceDetails?.id ?? prostheticsSourceId(metadata);
                const details = input.options?.sourceDetails;
                if (details?.id && !connection.prepare('SELECT 1 FROM prosthetics_catalog_sources WHERE id=?').get(sourceId))
                    throw new ProstheticsCatalogError('SOURCE_NOT_FOUND', 'Fonte non disponibile.', 404);
                const sourceWrite = connection.prepare(`INSERT INTO prosthetics_catalog_sources (id,name,authority,scope,version,date,sha256,notes)
                    VALUES (@id,@name,@authority,@scope,@version,@date,@sha256,@notes)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name,authority=excluded.authority,scope=excluded.scope,
                    version=excluded.version,date=excluded.date,sha256=excluded.sha256,notes=excluded.notes`)
                    .run({ id: sourceId, name: metadata.source, authority: details?.authority || metadata.scope, scope: metadata.scope,
                        version: metadata.version, date: details?.date ?? null, sha256: parsed.manifest.sha256, notes: details?.notes ?? '' });
                if (sourceWrite.changes !== 1) throw new Error('PROSTHETICS_SOURCE_WRITE_FAILED');
                const committedAt = new Date().toISOString();
                const upsert = connection.prepare(`INSERT INTO prosthetics_catalog_entries
                    (id, source_id, code_system, code, description, version, source, scope, start_date, end_date, source_sha256, operation_key, imported_at)
                    VALUES (@id, @sourceId, @codeSystem, @code, @description, @version, @source, @scope, @startDate, @endDate, @sourceSha256, @operationKey, @importedAt)
                    ON CONFLICT(id) DO UPDATE SET description = excluded.description, version = excluded.version,
                    source = excluded.source, start_date = excluded.start_date, end_date = excluded.end_date,
                    source_sha256 = excluded.source_sha256, operation_key = excluded.operation_key, imported_at = excluded.imported_at`);
                for (const row of parsed.rows) {
                    const result = upsert.run({ ...row, sourceId, id: prostheticsIdentity({ ...row, sourceId }), sourceSha256: parsed.manifest.sha256, operationKey, importedAt: committedAt });
                    if (result.changes !== 1) throw new Error('PROSTHETICS_ENTRY_WRITE_FAILED');
                }
                const receipt: ProstheticsReceipt = { operationKey, manifest: parsed.manifest, previousRevision: proof.revision,
                    revision: revision(connection, operationKey), applied: parsed.rows.length, changes: delta, committedAt };
                const receiptWrite = connection.prepare('INSERT INTO prosthetics_catalog_receipts (operation_key, receipt_json) VALUES (?, ?)').run(operationKey, JSON.stringify(receipt));
                if (receiptWrite.changes !== 1) throw new Error('PROSTHETICS_RECEIPT_WRITE_FAILED');
                assertCurrent();
                return { receipt, replayed: false };
            }).immediate();
        },
        search(query: string, sourceId = ''): { revision: string; entries: ProstheticsEntry[]; truncated: boolean } {
            if (typeof sourceId !== 'string' || sourceId.length > 1024) throw new ProstheticsCatalogError('INVALID_QUERY', 'Fonte non valida.');
            if (typeof query !== 'string' || query.length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(query)) throw new ProstheticsCatalogError('INVALID_QUERY', 'Ricerca non valida: massimo 200 caratteri.');
            return connection.transaction(() => {
                // Escape wildcards: user text is a literal search, not a LIKE expression.
                const pattern = `%${query.replace(/[\\%_]/gu, '\\$&')}%`;
                const entries = connection.prepare(`${SELECT_ENTRIES} WHERE (? = '' OR source_id = ?) AND (code LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR code_system LIKE ? ESCAPE '\\')
                    ORDER BY code_system COLLATE BINARY, code COLLATE BINARY, scope COLLATE BINARY LIMIT 51`).all(sourceId, sourceId, pattern, pattern, pattern) as ProstheticsEntry[];
                return { revision: revision(connection), entries: entries.slice(0, 50), truncated: entries.length > 50 };
            })();
        },
    };
}
function assertPrivateArchive(connection: Database.Database) {
    if (process.platform === 'win32' || connection.name === ':memory:' || !connection.name) return;
    for (const file of [path.dirname(connection.name), connection.name, `${connection.name}-wal`, `${connection.name}-shm`]) {
        let info: fs.Stats;
        try { info = fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && file !== connection.name && file !== path.dirname(connection.name)) continue; throw error; }
        if (info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
            throw new ProstheticsCatalogError('ARCHIVE_PERMISSIONS', 'L’archivio deve essere accessibile soltanto al proprietario prima di conservare o aprire originali.', 409);
    }
}
function documents(connection: Database.Database, sourceId: string, operationKey?: string): ProstheticsDocument[] {
    return connection.prepare('SELECT id,source_id AS sourceId,name,sha256,size,page FROM prosthetics_catalog_documents WHERE source_id=? AND (? IS NULL OR operation_key=?) ORDER BY id').all(sourceId, operationKey ?? null, operationKey ?? null) as ProstheticsDocument[];
}
export function decodeProstheticsDocument(base64: string): Buffer {
    const size = getAttachmentPayloadByteSize(base64);
    if (!size.ok || typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(Math.min(resolveMaxAttachmentBytes(), 25 * 1024 * 1024) / 3) * 4)
        throw new ProstheticsCatalogError('INVALID_DOCUMENT', 'Originale non valido o superiore al limite consentito.');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64 || bytes.length > Math.min(resolveMaxAttachmentBytes(), 25 * 1024 * 1024)) throw new ProstheticsCatalogError('INVALID_DOCUMENT', 'Originale non valido o superiore al limite consentito.');
    return bytes;
}
export type ProstheticsCatalog = ReturnType<typeof createProstheticsCatalog>;

function currentSourceImport(connection: Database.Database, sourceId: string): string {
    const source = connection.prepare('SELECT * FROM prosthetics_catalog_sources WHERE id=?').get(sourceId) as ProstheticsSourceRecord;
    for (const row of connection.prepare('SELECT operation_key,receipt_json FROM prosthetics_catalog_receipts ORDER BY id DESC').iterate() as Iterable<{ operation_key: string; receipt_json: string }>) {
        const receipt = JSON.parse(row.receipt_json) as ProstheticsReceipt;
        const manifest = receipt.manifest;
        if ((manifest.options?.sourceDetails?.id ?? prostheticsSourceId(manifest.metadata!)) !== sourceId) continue;
        const imported = prostheticsImportSource(manifest, sourceId);
        if ((Object.keys(source) as (keyof ProstheticsSourceRecord)[]).every(key => source[key] === imported[key])) return row.operation_key;
    }
    throw new ProstheticsCatalogError('SOURCE_NOT_FOUND', 'Import della fonte non disponibile.', 409);
}
