/* @Codex */
export const EXEMPTION_IMPORT_VERSION = 'exemptions-pipe-utf8-v1';
export const EXEMPTION_IMPORT_POLICY = 'merge-reject-duplicates-explicit-subset-v1';
export const EXEMPTION_IMPORT_SCHEMA = 1;
export const EXEMPTION_MAX_BYTES = 2 * 1024 * 1024;
export const EXEMPTION_MAX_ROWS = 20_000;
export const EXEMPTION_COLUMNS = [
    'CD_ESENZIONE', 'DS_ESENZIONE', 'CD_TIPO_ESENZIONE',
    'DT_INIZIO_VALIDITA', 'DT_FINE_VALIDITA', 'FL_AMBITO_FARMACEUTICO',
    'FL_AMBITO_SPECIALISTICO', 'FL_NAZIONALE',
] as const;
export const EXEMPTION_EXCLUDED_COLUMNS = [
    'FL_ESENZIONE', 'DT_INSERT', 'DT_UPDATE', 'FL_ESENZIONE_LOMBARDI',
    'FL_SOLO_RESIDENTI', 'FL_LIMITE_GENERE', 'NR_ETA_MINIMA', 'NR_ETA_MASSIMA',
    'FL_MS', 'FL_MRSA', 'FL_MMG', 'FL_ATTR_CRED',
] as const;
export type ExemptionImportRow = {
    line: number;
    code: string;
    description: string;
    type: string | null;
    startDate: number | null;
    endDate: number | null;
    isPharma: boolean | null;
    isSpecialist: boolean | null;
    isNational: boolean | null;
};
export type ExemptionImportDiagnostic = { line: number; column: string; message: string };
export type ExemptionImportManifest = {
    sourceName: string;
    sourceSha256: string;
    byteLength: number;
    parserVersion: string;
    schemaVersion: number;
    policy: string;
    rowCount: number;
    validRows: number;
    errorCount: number;
    duplicateRows: number;
    excludedColumns: { name: string; nonNullValues: number }[];
};
export type ExemptionImportPreview = {
    manifest: ExemptionImportManifest;
    revision: string;
    valid: boolean;
    diagnostics: ExemptionImportDiagnostic[];
    sample: ExemptionImportRow[];
    proof: string | null;
};
export type ExemptionImportReceipt = {
    operationKey: string;
    manifest: ExemptionImportManifest;
    previousRevision: string;
    revision: string;
    applied: number;
    inserted: number;
    updated: number;
    committedAt: string;
};
export type ExemptionCatalogStatus = {
    revision: string;
    count: number;
    latestReceipt: ExemptionImportReceipt | null;
};
