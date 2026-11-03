import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { AifaCatalogConflictError, AifaReductionError, acquireAifaCatalogOperation } from './aifa-catalog-lock';
import { AIFA_CATALOG_MANIFEST_SETTING_KEY } from './aifa-catalog';
import { AIFA_MINIMUM_REPLACEMENT_RATIO, catalogSnapshot, getAifaCatalogVersionedStatus, runDrugCatalogTransaction, type AifaCatalogStatus } from './aifa-catalog-server';
import {
    DRUG_CATALOG_MANIFEST_FORMAT, DRUG_CATALOG_SOURCE_SETTING_KEY, DrugCatalogImportError, parseMappedDrugCatalog,
    previewDrugCatalogRows, readDrugCatalogHeader, validateDrugCatalogSource,
    type DrugCatalogManifest, type DrugCatalogMapping, type DrugCatalogPreviewRow,
} from './drug-catalog-import';
import { drugs, settings } from './schema';
import { writeAuditEventInTransaction, type buildAuditWriteInputFromRequest } from './security/audit';

type AuditWriteInput = ReturnType<typeof buildAuditWriteInputFromRequest>;

const INSERT_BATCH_SIZE = 400;

export type DrugCatalogPreview = {
    header: string[]; mapping: DrugCatalogMapping; suggested: boolean; sha256: string;
    counts: { total: number; importable: number; rejected: number; duplicateCodes: number } | null;
    diagnostics: { row: number; reason: string }[]; sample: DrugCatalogPreviewRow[];
    current: AifaCatalogStatus & { snapshot: string };
    reductionRequired: boolean;
};

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Anteprima: senza mappatura propone le colonne; con mappatura conta e mostra le righe. Non scrive nulla. */
export function previewDrugCatalogFile(bytes: Uint8Array, mapping: unknown | undefined): DrugCatalogPreview {
    const current = getAifaCatalogVersionedStatus();
    const { header, suggestion } = readDrugCatalogHeader(bytes);
    const base = { header, sha256: sha256(bytes), current, diagnostics: [], sample: [] };
    if (mapping === undefined) return { ...base, mapping: suggestion, suggested: true, counts: null, reductionRequired: false };
    const parsed = parseMappedDrugCatalog(bytes, mapping);
    return {
        ...base, mapping: parsed.mapping, suggested: false,
        counts: { total: parsed.totalRecords, importable: parsed.drugs.length, rejected: parsed.rejectedRecords, duplicateCodes: parsed.duplicateCodes },
        diagnostics: parsed.diagnostics, sample: previewDrugCatalogRows(parsed.drugs),
        reductionRequired: current.count > 0 && parsed.drugs.length < current.count * AIFA_MINIMUM_REPLACEMENT_RATIO,
    };
}

export type DrugCatalogCommitInput = {
    bytes: Uint8Array; fileName: string; mapping: unknown; source: unknown;
    previewSha256: unknown; expectedSnapshot: unknown; confirmedReduction?: unknown; confirmed: unknown;
    audit: AuditWriteInput;
};

/** Sostituisce il catalogo attivo con il file confermato; terapie e prescrizioni salvate non cambiano. */
export function commitDrugCatalogFile(input: DrugCatalogCommitInput): AifaCatalogStatus & { snapshot: string; imported: DrugCatalogManifest } {
    if (input.confirmed !== true) throw new DrugCatalogImportError('Conferma esplicita richiesta.');
    const digest = sha256(input.bytes);
    if (input.previewSha256 !== digest) throw new DrugCatalogImportError('Il file è cambiato dopo l’anteprima: ripeti l’anteprima.', 409);
    if (typeof input.expectedSnapshot !== 'string' || !/^[a-f0-9]{64}$/u.test(input.expectedSnapshot)) throw new DrugCatalogImportError('Versione attesa del catalogo non valida.');
    const fileName = input.fileName.trim();
    if (!fileName || fileName.length > 200 || /[/\\]/u.test(fileName)) throw new DrugCatalogImportError('Nome file non valido.');
    const source = validateDrugCatalogSource(input.source);
    const parsed = parseMappedDrugCatalog(input.bytes, input.mapping);
    const manifest: DrugCatalogManifest = { format: DRUG_CATALOG_MANIFEST_FORMAT, ...source, sha256: digest, fileName,
        rowCount: parsed.drugs.length, importedAt: new Date().toISOString(), mapping: parsed.mapping };
    const release = acquireAifaCatalogOperation();
    try {
        runDrugCatalogTransaction((tx) => {
            const snapshot = catalogSnapshot(tx);
            if (snapshot !== input.expectedSnapshot) throw new AifaCatalogConflictError();
            const previousCount = Number(tx.select({ total: sql<number>`count(*)` }).from(drugs).get()?.total ?? 0);
            const hadAifa = !!tx.select({ key: settings.key }).from(settings).where(eq(settings.key, AIFA_CATALOG_MANIFEST_SETTING_KEY)).get();
            const hadFile = !!tx.select({ key: settings.key }).from(settings).where(eq(settings.key, DRUG_CATALOG_SOURCE_SETTING_KEY)).get();
            const reduction = previousCount > 0 && parsed.drugs.length < previousCount * AIFA_MINIMUM_REPLACEMENT_RATIO;
            if (reduction) {
                const confirmation = `${snapshot}:${digest}`;
                if (input.confirmedReduction !== confirmation) throw new AifaReductionError(confirmation, previousCount, parsed.drugs.length);
            }
            tx.delete(drugs).run();
            for (let offset = 0; offset < parsed.drugs.length; offset += INSERT_BATCH_SIZE) {
                tx.insert(drugs).values(parsed.drugs.slice(offset, offset + INSERT_BATCH_SIZE)).run();
            }
            tx.delete(settings).where(eq(settings.key, AIFA_CATALOG_MANIFEST_SETTING_KEY)).run();
            tx.insert(settings).values({ key: DRUG_CATALOG_SOURCE_SETTING_KEY, value: JSON.stringify(manifest) })
                .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(manifest) } }).run();
            writeAuditEventInTransaction(tx, { ...input.audit, outcome: 'success', redactedMetadata: {
                ...input.audit.redactedMetadata, counts: parsed.drugs.length,
                flags: ['mode:file-import', `before:${hadAifa ? 'aifa' : hadFile ? 'file' : previousCount ? 'unverified' : 'empty'}`,
                    ...(reduction ? ['forced-reduction'] : [])],
            } });
        });
    } finally { release(); }
    return { ...getAifaCatalogVersionedStatus(), imported: manifest };
}

