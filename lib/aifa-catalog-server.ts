/* @Codex */

import { createHash } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import {
    AIFA_CATALOG_MANIFEST_SETTING_KEY,
    buildAifaCatalogManifest,
    parseAifaCsv,
    parseStoredAifaCatalogManifest,
    validateAifaManifestInput,
    type AifaCatalogManifest,
    type AifaCatalogManifestInput,
} from './aifa-catalog';
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

export async function replaceAifaCatalog(
    file: File,
    manifestInput: AifaCatalogManifestInput,
): Promise<AifaCatalogImportResult> {
    if (file.size < 1 || file.size > MAX_AIFA_CSV_BYTES) {
        throw new Error('File AIFA vuoto o superiore a 100 MB');
    }
    const validatedManifestInput = validateAifaManifestInput(manifestInput);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = parseAifaCsv(text);
    const manifest = buildAifaCatalogManifest(validatedManifestInput, {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        fileName: file.name,
        rowCount: parsed.drugs.length,
    });

    dbServer.transaction((transaction) => {
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
    });

    return {
        count: parsed.drugs.length,
        manifest,
        state: 'ready',
        rejectedRecords: parsed.rejectedRecords,
        totalRecords: parsed.totalRecords,
    };
}

export function clearAifaCatalog(): void {
    dbServer.transaction((transaction) => {
        transaction.delete(drugs).run();
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
    const predicate = status.state === 'ready'
        ? buildDrugPrefixSearchPredicate(normalized)
        : buildDrugSearchPredicate(query);
    const order = status.state === 'ready'
        ? [buildDrugPrefixSearchOrder(normalized), asc(drugs.name), asc(drugs.packaging)]
        : [asc(drugs.name), asc(drugs.packaging)];

    const rows = await dbServer.select()
        .from(drugs)
        .where(predicate)
        .orderBy(...order)
        .limit(limit);
    return { rows, status };
}
