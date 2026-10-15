/* @Codex */

import { createHash } from 'node:crypto';
import { AifaUpdateError, AifaReductionError, acquireAifaCatalogOperation } from './aifa-catalog-lock';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { writeAuditEventInTransaction, type buildAuditWriteInputFromRequest } from './security/audit';
import { asc, eq, or, sql } from 'drizzle-orm';
import {
    AIFA_CATALOG_MANIFEST_SETTING_KEY,
    buildAifaCatalogManifest,
    normalizeAifaSearchText,
    parseAifaCsv,
    parseStoredAifaCatalogManifest,
    validateAifaManifestInput,
    type AifaCatalogManifest,
    type AifaCatalogManifestInput,
    AIFA_DOWNLOAD_URL,
} from './aifa-catalog';
import { AIFA_REMOTE_SETTING_KEY } from './aifa-catalog-source';
import { dbServer } from './db-server';
import {
    buildDrugPrefixSearchOrder,
    buildDrugPrefixSearchPredicate,
    buildDrugSearchPredicate,
    normalizeDrugSearchQuery,
} from './drug-search-query';
import { drugs, settings } from './schema';

const INSERT_BATCH_SIZE = 400;
const MAX_AIFA_CSV_BYTES = 100 * 1024 * 1024;

export type AifaCatalogStatus = {
    count: number;
    manifest: AifaCatalogManifest | null;
    state: 'ready' | 'unverified' | 'not-imported';
};

export type AifaCatalogImportResult = AifaCatalogStatus & {
    rejectedRecords: number;
    totalRecords: number;
};

export async function getAifaCatalogStatus(): Promise<AifaCatalogStatus> {
    const [countRow, manifestRow] = await Promise.all([
        dbServer.select({ total: sql<number>`count(*)` }).from(drugs).get(),
        dbServer.select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, AIFA_CATALOG_MANIFEST_SETTING_KEY))
            .get(),
    ]);
    const count = Number(countRow?.total || 0);
    const manifest = parseStoredAifaCatalogManifest(manifestRow?.value);
    return {
        count,
        manifest,
        state: count === 0 ? 'not-imported' : manifest ? 'ready' : 'unverified',
    };
}

/* @Codex Snapshot includes every stored drug field and the raw manifest, including legacy catalogs. */
function catalogSnapshot(connection: Pick<typeof dbServer, 'select'>): string {
    const hash = createHash('sha256');
    for (const row of connection.select().from(drugs).orderBy(asc(drugs.aic)).all()) {
        hash.update(JSON.stringify(row)).update('\n');
    }
    const manifest = connection.select({ value: settings.value }).from(settings)
        .where(eq(settings.key, AIFA_CATALOG_MANIFEST_SETTING_KEY)).get();
    return hash.update(JSON.stringify(manifest ?? null)).digest('hex');
}

export function getAifaCatalogSnapshot(): string {
    return dbServer.transaction((transaction) => catalogSnapshot(transaction));
}

/* @Codex Strict structure check for automatic acquisition; manual parser behavior stays unchanged. */
function assertCompleteCsv(text: string): void {
    const delimiter = (text.split(/\r?\n/, 1)[0] || '').includes(';') ? ';' : ',';
    let mode: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
    let fields = 1;
    let expected = 0;
    let populated = false;
    const fail = () => { throw new AifaUpdateError('Struttura CSV AIFA non valida', 422); };
    const endRecord = () => {
        if (populated) {
            if (!expected) expected = fields;
            else if (fields !== expected) fail();
        }
        fields = 1; populated = false; mode = 'start';
    };
    for (const char of text.replace(/^\uFEFF/, '')) {
        if (char === '\0') fail();
        if (mode === 'quoted') {
            if (char === '"') mode = 'closed';
            continue;
        }
        if (char === '"') {
            if (mode === 'closed') mode = 'quoted';
            else if (mode === 'start') mode = 'quoted';
            else fail();
            populated = true;
        } else if (char === delimiter) {
            fields++; mode = 'start'; populated = true;
        } else if (char === '\r' || char === '\n') {
            endRecord();
        } else {
            if (mode === 'closed') fail();
            mode = 'plain'; populated = true;
        }
    }
    if (mode === 'quoted') fail();
    endRecord();
}

export type AifaReplacementGuard = {
    snapshot: string;
    assertCurrent: () => void;
};

type AifaAuditInput = ReturnType<typeof buildAuditWriteInputFromRequest>;
export type AifaReplacementOptions = { audit?: AifaAuditInput; confirmedReduction?: string };
export const AIFA_MINIMUM_REPLACEMENT_RATIO = 0.9;

function systemAifaAudit(): AifaAuditInput {
    return { eventType: 'reference_data.aifa.updated', outcome: 'success', actorType: 'system', actorRef: 'local-catalog',
        subjectType: 'reference_data', subjectRef: 'aifa', sourceSurface: 'job', archiveGeneration: currentArchiveGeneration() };
}

export async function replaceAifaCatalog(
    file: File,
    manifestInput: AifaCatalogManifestInput,
    guard?: AifaReplacementGuard,
    options: AifaReplacementOptions = {},
): Promise<AifaCatalogImportResult> {
    const release = guard ? () => undefined : acquireAifaCatalogOperation();
    try {
        if (file.size < 1 || file.size > MAX_AIFA_CSV_BYTES) {
            throw new Error('File AIFA vuoto o superiore a 100 MB');
        }
        const validatedManifestInput = validateAifaManifestInput(manifestInput);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (guard) assertCompleteCsv(text);
        const parsed = parseAifaCsv(text, true);
        if (guard && parsed.rejectedRecords > 0) {
            throw new AifaUpdateError('CSV AIFA contiene righe invalide: catalogo conservato', 422);
        }
        const manifest = buildAifaCatalogManifest(validatedManifestInput, {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            fileName: file.name,
            rowCount: parsed.drugs.length,
        });

        dbServer.transaction((transaction) => {
            let currentSnapshot: string | undefined;
            if (guard) {
                guard.assertCurrent();
                currentSnapshot = catalogSnapshot(transaction);
                if (currentSnapshot !== guard.snapshot) {
                    throw new AifaUpdateError('Catalogo modificato durante il download: rileggi lo stato', 409);
                }
            }
            const previous = parseStoredAifaCatalogManifest(transaction.select().from(settings)
                .where(eq(settings.key, AIFA_CATALOG_MANIFEST_SETTING_KEY)).get()?.value);
            const previousCount = Number(transaction.select({ total: sql<number>`count(*)` }).from(drugs).get()?.total ?? 0);
            const reduction = previousCount > 0 && parsed.drugs.length < previousCount * AIFA_MINIMUM_REPLACEMENT_RATIO;
            if (reduction) {
                currentSnapshot ??= catalogSnapshot(transaction);
                const confirmation = `${currentSnapshot}:${manifest.sha256}`;
                if (options.confirmedReduction !== confirmation) throw new AifaReductionError(confirmation, previousCount, parsed.drugs.length);
            }
            transaction.delete(drugs).run();
            for (let offset = 0; offset < parsed.drugs.length; offset += INSERT_BATCH_SIZE) {
                transaction.insert(drugs).values(parsed.drugs.slice(offset, offset + INSERT_BATCH_SIZE)).run();
            }
            transaction.insert(settings)
                .values({ key: AIFA_CATALOG_MANIFEST_SETTING_KEY, value: JSON.stringify(manifest) })
                .onConflictDoUpdate({
                    target: settings.key,
                    set: { value: JSON.stringify(manifest) },
                })
                .run();
            writeAuditEventInTransaction(transaction, { ...(options.audit ?? systemAifaAudit()),
                redactedMetadata: { ...options.audit?.redactedMetadata, aifaCatalog: {
                    mode: guard ? 'remote' : 'manual', before: previous, after: manifest, forcedReduction: reduction,
                } } });
            if (guard && manifest.sourceUrl === AIFA_DOWNLOAD_URL) {
                const remote = { etag: manifest.etag, lastModified: manifest.lastModified, contentLength: manifest.contentLength,
                    checkedAt: new Date().toISOString(), outcome: manifest.etag || manifest.lastModified ? 'unchanged' : 'unavailable' };
                transaction.insert(settings).values({ key: AIFA_REMOTE_SETTING_KEY, value: JSON.stringify(remote) })
                    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(remote) } }).run();
            }
            guard?.assertCurrent();
        }, { behavior: 'immediate' });

        return {
            count: parsed.drugs.length,
            manifest,
            state: 'ready',
            rejectedRecords: parsed.rejectedRecords,
            totalRecords: parsed.totalRecords,
        };
    } finally { release(); }
}

export async function recordAifaCatalogRejection(audit: AifaAuditInput): Promise<void> {
    dbServer.transaction(tx => { writeAuditEventInTransaction(tx, audit); }, { behavior: 'immediate' });
}

export async function confirmAifaCatalogUnchanged(snapshot: string, assertCurrent: () => void, audit: AifaAuditInput) {
    dbServer.transaction(tx => {
        assertCurrent();
        if (catalogSnapshot(tx) !== snapshot) throw new AifaUpdateError('Catalogo modificato durante la verifica: rileggi lo stato', 409);
        const manifest = parseStoredAifaCatalogManifest(tx.select().from(settings).where(eq(settings.key, AIFA_CATALOG_MANIFEST_SETTING_KEY)).get()?.value);
        writeAuditEventInTransaction(tx, { ...audit, redactedMetadata: { ...audit.redactedMetadata,
            flags: [...(audit.redactedMetadata?.flags ?? []), 'not-modified'],
            aifaCatalog: { mode: 'remote', before: manifest, after: manifest, forcedReduction: false } } });
        const remote = { etag: manifest?.etag, lastModified: manifest?.lastModified, contentLength: manifest?.contentLength,
            checkedAt: new Date().toISOString(), outcome: 'unchanged' };
        tx.insert(settings).values({ key: AIFA_REMOTE_SETTING_KEY, value: JSON.stringify(remote) })
            .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(remote) } }).run();
        assertCurrent();
    }, { behavior: 'immediate' });
    const status = await getAifaCatalogStatus();
    return { ...status, rejectedRecords: 0, totalRecords: status.count, notModified: true };
}

export function clearAifaCatalog(): void {
    dbServer.transaction((transaction) => {
        transaction.delete(drugs).run();
        transaction.delete(settings)
            .where(eq(settings.key, AIFA_CATALOG_MANIFEST_SETTING_KEY))
            .run();
    });
}

export function replaceUnverifiedDrugCatalog(items: readonly (typeof drugs.$inferInsert)[]): void {
    if (items.length === 0) throw new Error('Catalogo farmaci legacy vuoto');

    const normalizedItems = items.map((item) => ({
        ...item,
        packagingSearch: item.packagingSearch ?? normalizeAifaSearchText(item.packaging || ''),
    }));

    dbServer.transaction((transaction) => {
        transaction.delete(drugs).run();
        for (let offset = 0; offset < normalizedItems.length; offset += INSERT_BATCH_SIZE) {
            transaction.insert(drugs).values(normalizedItems.slice(offset, offset + INSERT_BATCH_SIZE)).run();
        }
        transaction.delete(settings)
            .where(eq(settings.key, AIFA_CATALOG_MANIFEST_SETTING_KEY))
            .run();
    });
}

export async function searchAifaCatalog(
    query: string,
    limit: number,
): Promise<{ rows: typeof drugs.$inferSelect[]; status: AifaCatalogStatus }> {
    const normalized = normalizeDrugSearchQuery(query);
    const status = await getAifaCatalogStatus();
    if (!normalized) return { rows: [], status };

    const isMultiToken = normalized.includes(' ');
    const rows = await dbServer.select()
        .from(drugs)
        .where(isMultiToken
            ? buildDrugSearchPredicate(normalized)
            : or(buildDrugPrefixSearchPredicate(normalized), eq(drugs.atc, normalized.toUpperCase())))
        .orderBy(
            ...(isMultiToken ? [] : [buildDrugPrefixSearchOrder(normalized)]),
            asc(drugs.name),
            asc(drugs.packaging),
        )
        .limit(limit);
    return { rows, status };
}
