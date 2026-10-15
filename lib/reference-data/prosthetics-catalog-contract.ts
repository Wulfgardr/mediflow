/* @Codex */
export const PROSTHETICS_MAX_BYTES = 2 * 1024 * 1024;
export const PROSTHETICS_MAX_ROWS = 20_000;
export const PROSTHETICS_COLUMNS = ['codice_sistema', 'codice', 'descrizione', 'versione', 'fonte', 'ambito', 'data_inizio', 'data_fine'] as const;
export const PROSTHETICS_CONTRACT = 'prosthetics-csv-v1';
export const PROSTHETICS_TEMPLATE = `${PROSTHETICS_COLUMNS.join(',')}\r\nCodifica dimostrativa,DEMO-001,"Ausilio inventato, non prescrivibile",esempio-1,Fonte sintetica,Dimostrazione,,\r\n`;
export type ProstheticsRow = {
    codeSystem: string; code: string; description: string; version: string;
    source: string; scope: string; startDate: string | null; endDate: string | null;
};
export type ProstheticsEntry = ProstheticsRow & {
    id: string; sourceId: string; sourceSha256: string; operationKey: string; importedAt: string;
};
export type ProstheticsDiagnostic = { row: number; column: string; code: string; message: string };
export type ProstheticsManifest = {
    contract: typeof PROSTHETICS_CONTRACT; sourceName: string; sha256: string; bytes: number;
    metadata: Pick<ProstheticsRow, 'codeSystem' | 'version' | 'source' | 'scope'> | null;
    options?: ProstheticsImportOptions;
    counts: { total: number; valid: number; invalid: number; duplicates: number; errors: number };
};
export type ProstheticsChanges = { inserted: number; updated: number; unchanged: number };
export type ProstheticsPreview = {
    valid: boolean; manifest: ProstheticsManifest; revision: string; proof: string | null;
    diagnostics: ProstheticsDiagnostic[]; diagnosticsTruncated: boolean; sample: ProstheticsRow[];
    changes: ProstheticsChanges | null;
};
export type ProstheticsReceipt = {
    operationKey: string; manifest: ProstheticsManifest; previousRevision: string; revision: string;
    applied: number; changes: ProstheticsChanges; committedAt: string;
};
export type ProstheticsSourceRecord = {
    id: string; name: string; authority: string; scope: string; version: string;
    date: string | null; sha256: string; notes: string;
};
export type ProstheticsDocument = { id: string; sourceId: string; name: string; sha256: string; size: number; page: string | null };
export type ProstheticsMapping = { delimiter: ',' | ';'; columns: Record<typeof PROSTHETICS_COLUMNS[number], number> };
export type ProstheticsImportOptions = { mapping?: ProstheticsMapping; sourceDetails?: { id?: string; authority: string; date: string | null; notes: string } };
export type ProstheticsCatalogSelection = { entryId: string; revision: string };
export type ProstheticsSnapshot = {
    entryId: string; code: string; codeSystem: string; description: string;
    source: ProstheticsSourceRecord; documents: ProstheticsDocument[]; revision: string;
};
export function prostheticsSourceId(row: Pick<ProstheticsRow, 'source' | 'version' | 'scope'>): string {
    return JSON.stringify([row.source, row.version, row.scope]);
}
export type ProstheticsStatus = { revision: string; count: number; sourceCount: number; latestReceipt: ProstheticsReceipt | null };
export type ProstheticsSelection = Pick<ProstheticsRow, 'codeSystem' | 'code' | 'description' | 'source' | 'version'>;
/** Explicit field allowlist for the coordinator's form integration; never a clinical writer. */
export function prostheticsSelection(row: ProstheticsRow): ProstheticsSelection {
    return { codeSystem: row.codeSystem, code: row.code, description: row.description, source: row.source, version: row.version };
}
export function prostheticsIdentity(row: Pick<ProstheticsRow, 'codeSystem' | 'code' | 'scope' | 'source' | 'version'> & { sourceId?: string }): string {
    return JSON.stringify([row.sourceId ?? prostheticsSourceId(row), row.codeSystem, row.code, row.scope]);
}
export function isProstheticsText(value: unknown, max = 200): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= max
        && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
export function isProstheticsDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value) || value.slice(0, 4) < '0100') return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
