/* Catalogo farmaci di qualunque agenzia: fonte dichiarata, colonne mappate, anteprima prima della conferma.
 * Il catalogo attivo resta uno solo (tabella `drugs`); AIFA è una delle fonti possibili. */
import { normalizeAifaSearchText, parseDelimitedRecords, type ParsedAifaDrug } from './aifa-catalog';

export const DRUG_CATALOG_SOURCE_SETTING_KEY = 'drugCatalogSource';
export const DRUG_CATALOG_MANIFEST_FORMAT = 'mediflow.drug-catalog-manifest.v1';
export const DRUG_CATALOG_MAX_BYTES = 100 * 1024 * 1024;
export const DRUG_CATALOG_FIELDS = ['codice', 'denominazione', 'principio_attivo', 'atc', 'forma', 'confezione', 'classe_rimborsabilita', 'titolare'] as const;
export type DrugCatalogField = typeof DRUG_CATALOG_FIELDS[number];
export const DRUG_CATALOG_REQUIRED_FIELDS: readonly DrugCatalogField[] = ['codice', 'denominazione'];
export const DRUG_CATALOG_FIELD_LABELS: Record<DrugCatalogField, string> = {
    codice: 'Codice', denominazione: 'Denominazione', principio_attivo: 'Principio attivo', atc: 'ATC',
    forma: 'Forma farmaceutica', confezione: 'Confezione', classe_rimborsabilita: 'Classe di rimborsabilità', titolare: 'Titolare',
};
const FIELD_ALIASES: Record<DrugCatalogField, readonly string[]> = {
    codice: ['codice', 'code', 'codice_aic', 'aic', 'product_code', 'ndc', 'cip13', 'cip', 'pzn', 'gtin'],
    denominazione: ['denominazione', 'name', 'nome', 'product_name', 'nome_commerciale', 'brand_name', 'trade_name'],
    principio_attivo: ['principio_attivo', 'principi_attivi', 'pa_associati', 'active_ingredient', 'active_substance', 'substance', 'inn'],
    atc: ['atc', 'codice_atc', 'atc_code'],
    forma: ['forma', 'forma_farmaceutica', 'dosage_form', 'form', 'pharmaceutical_form'],
    confezione: ['confezione', 'descrizione', 'package', 'packaging', 'package_description', 'presentation'],
    classe_rimborsabilita: ['classe_rimborsabilita', 'classe', 'fascia', 'reimbursement', 'reimbursement_class', 'tier'],
    titolare: ['titolare', 'ragione_sociale', 'ditta', 'titolare_aic', 'company', 'manufacturer', 'labeler', 'marketing_authorisation_holder'],
};

export type DrugCatalogDelimiter = ',' | ';' | '\t';
export type DrugCatalogMapping = { delimiter: DrugCatalogDelimiter; columns: Partial<Record<DrugCatalogField, number>> };
export type DrugCatalogSourceInput = { agency: string; codeSystem: string; version: string; date: string; sourceUrl: string | null };
export type DrugCatalogManifest = DrugCatalogSourceInput & {
    format: typeof DRUG_CATALOG_MANIFEST_FORMAT;
    sha256: string; fileName: string; rowCount: number; importedAt: string; mapping: DrugCatalogMapping;
};
/** Fonte di un catalogo attivo caricato da file (per AIFA vale il manifest AIFA). */
export type DrugCatalogActiveSource = {
    kind: 'file'; agency: string; codeSystem: string; version: string; date: string; rowCount: number; sha256: string;
};
export type DrugCatalogPreviewRow = { code: string; name: string; activePrinciple: string | null; atc: string | null;
    packaging: string | null; reimbursementClass: string | null };
export type DrugCatalogParseResult = {
    header: string[]; mapping: DrugCatalogMapping; drugs: ParsedAifaDrug[]; totalRecords: number;
    rejectedRecords: number; duplicateCodes: number; diagnostics: { row: number; reason: string }[];
};

export class DrugCatalogImportError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
}

function cleanText(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= max && !/[\u0000-\u001f\u007f]/u.test(trimmed) ? trimmed : null;
}

export function isDrugCatalogDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateDrugCatalogSource(input: unknown): DrugCatalogSourceInput {
    const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const agency = cleanText(value.agency, 200);
    const codeSystem = cleanText(value.codeSystem, 120);
    const version = cleanText(value.version, 120);
    const date = cleanText(value.date, 10);
    if (!agency) throw new DrugCatalogImportError('Indica l’agenzia o l’ente che pubblica il catalogo.');
    if (!codeSystem) throw new DrugCatalogImportError('Indica il nome della codifica dei farmaci.');
    if (!version) throw new DrugCatalogImportError('Indica la versione del catalogo.');
    if (!date || !isDrugCatalogDate(date)) throw new DrugCatalogImportError('Indica la data del catalogo (AAAA-MM-GG).');
    let sourceUrl: string | null = null;
    if (typeof value.sourceUrl === 'string' && value.sourceUrl.trim()) {
        let url: URL;
        try { url = new URL(value.sourceUrl.trim()); } catch { throw new DrugCatalogImportError('URL della fonte non valido.'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.toString().length > 500) throw new DrugCatalogImportError('L’URL della fonte deve usare https.');
        sourceUrl = url.toString();
    }
    if (agency === 'Agenzia Italiana del Farmaco (AIFA)' && codeSystem.toUpperCase() === 'AIC') {
        throw new DrugCatalogImportError('Per il feed AIFA usa il pannello Farmaci AIFA.');
    }
    return { agency, codeSystem, version, date, sourceUrl };
}

function normalizeHeader(value: string): string {
    return normalizeAifaSearchText(value.replace(/^﻿/u, '')).replace(/ /gu, '_');
}

export function detectDrugCatalogDelimiter(firstLine: string): DrugCatalogDelimiter {
    const counts = ([',', ';', '\t'] as const).map(d => [d, firstLine.split(d).length] as const);
    return counts.reduce((best, item) => item[1] > best[1] ? item : best)[0];
}

export function suggestDrugCatalogMapping(header: string[], delimiter: DrugCatalogDelimiter): DrugCatalogMapping {
    const normalized = header.map(normalizeHeader);
    const used = new Set<number>();
    const columns: DrugCatalogMapping['columns'] = {};
    for (const field of DRUG_CATALOG_FIELDS) {
        const index = FIELD_ALIASES[field].map(alias => normalized.indexOf(alias)).find(i => i >= 0 && !used.has(i));
        if (index !== undefined) { columns[field] = index; used.add(index); }
    }
    return { delimiter, columns };
}

export function validateDrugCatalogMapping(input: unknown, headerLength: number): DrugCatalogMapping {
    const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const delimiter = value.delimiter;
    if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') throw new DrugCatalogImportError('Separatore non valido.');
    const raw = (value.columns && typeof value.columns === 'object' && !Array.isArray(value.columns) ? value.columns : null) as Record<string, unknown> | null;
    if (!raw || Object.keys(raw).some(key => !(DRUG_CATALOG_FIELDS as readonly string[]).includes(key))) throw new DrugCatalogImportError('Mappatura delle colonne non valida.');
    const columns: DrugCatalogMapping['columns'] = {};
    const used = new Set<number>();
    for (const field of DRUG_CATALOG_FIELDS) {
        const index = raw[field];
        if (index === undefined || index === null) continue;
        if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= headerLength || used.has(index)) {
            throw new DrugCatalogImportError('Ogni campo va associato a una colonna diversa presente nel file.');
        }
        used.add(index); columns[field] = index;
    }
    for (const field of DRUG_CATALOG_REQUIRED_FIELDS) {
        if (columns[field] === undefined) throw new DrugCatalogImportError(`Associa una colonna al campo ${DRUG_CATALOG_FIELD_LABELS[field]}.`);
    }
    return { delimiter, columns };
}

function decode(bytes: Uint8Array): string {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new DrugCatalogImportError('Il file deve essere un CSV UTF-8.'); }
}

/** Legge l'intestazione e propone una mappatura; non convalida le righe. */
export function readDrugCatalogHeader(bytes: Uint8Array): { header: string[]; suggestion: DrugCatalogMapping } {
    const text = decode(bytes.subarray(0, Math.min(bytes.byteLength, 256 * 1024)));
    const firstLine = text.replace(/^﻿/u, '').split(/\r?\n/u, 1)[0] ?? '';
    const delimiter = detectDrugCatalogDelimiter(firstLine);
    const header = parseDelimitedRecords(`${firstLine}\n`, delimiter)[0] ?? [];
    if (header.length < 2) throw new DrugCatalogImportError('Il file non ha un’intestazione con almeno due colonne.');
    return { header, suggestion: suggestDrugCatalogMapping(header, delimiter) };
}

export function parseMappedDrugCatalog(bytes: Uint8Array, mappingInput: unknown): DrugCatalogParseResult {
    if (bytes.byteLength < 1 || bytes.byteLength > DRUG_CATALOG_MAX_BYTES) throw new DrugCatalogImportError('File vuoto o superiore a 100 MB.');
    const text = decode(bytes).replace(/^﻿/u, '');
    const delimiter = (mappingInput as { delimiter?: unknown } | null)?.delimiter;
    if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') throw new DrugCatalogImportError('Separatore non valido.');
    let records: string[][];
    try { records = parseDelimitedRecords(text, delimiter); }
    catch { throw new DrugCatalogImportError('CSV non valido: virgolette non chiuse.'); }
    if (records.length < 2) throw new DrugCatalogImportError('Il file non contiene righe dati.');
    const header = records[0];
    const mapping = validateDrugCatalogMapping(mappingInput, header.length);
    const cell = (record: string[], field: DrugCatalogField) => {
        const index = mapping.columns[field];
        return index === undefined ? null : cleanText(record[index] ?? '', 2000);
    };
    const byCode = new Map<string, ParsedAifaDrug>();
    const diagnostics: DrugCatalogParseResult['diagnostics'] = [];
    let rejectedRecords = 0, duplicateCodes = 0;
    records.slice(1).forEach((record, offset) => {
        const row = offset + 2;
        const code = cell(record, 'codice');
        const name = cell(record, 'denominazione');
        if (!code || code.length > 64 || !name) {
            rejectedRecords++;
            if (diagnostics.length < 50) diagnostics.push({ row, reason: !code || code.length > 64 ? 'codice assente o oltre 64 caratteri' : 'denominazione assente' });
            return;
        }
        if (byCode.has(code)) {
            duplicateCodes++;
            if (diagnostics.length < 50) diagnostics.push({ row, reason: 'codice ripetuto: resta la riga successiva' });
        }
        const activePrinciple = cell(record, 'principio_attivo');
        const form = cell(record, 'forma');
        const confezione = cell(record, 'confezione');
        // La tabella locale non ha una colonna per la forma: la conserva in testa alla confezione.
        const packaging = [form, confezione].filter(Boolean).join(' · ') || null;
        byCode.set(code, {
            aic: code, name, activePrinciple, company: cell(record, 'titolare'), packaging,
            class: cell(record, 'classe_rimborsabilita'), price: null, atc: cell(record, 'atc')?.toUpperCase() ?? null,
            aicSearch: normalizeAifaSearchText(code), nameSearch: normalizeAifaSearchText(name),
            activePrincipleSearch: normalizeAifaSearchText(activePrinciple ?? ''), packagingSearch: normalizeAifaSearchText(packaging ?? ''),
        });
    });
    if (byCode.size === 0) throw new DrugCatalogImportError('Nessuna riga importabile con la mappatura scelta.');
    return { header, mapping, drugs: [...byCode.values()], totalRecords: records.length - 1, rejectedRecords, duplicateCodes, diagnostics };
}

export function previewDrugCatalogRows(drugs: readonly ParsedAifaDrug[], limit = 5): DrugCatalogPreviewRow[] {
    return drugs.slice(0, limit).map(drug => ({ code: drug.aic, name: drug.name, activePrinciple: drug.activePrinciple, atc: drug.atc,
        packaging: drug.packaging, reimbursementClass: drug.class }));
}

export function parseStoredDrugCatalogManifest(value: string | null | undefined): DrugCatalogManifest | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as Partial<DrugCatalogManifest>;
        if (parsed.format !== DRUG_CATALOG_MANIFEST_FORMAT || typeof parsed.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.sha256)
            || typeof parsed.fileName !== 'string' || typeof parsed.rowCount !== 'number' || !Number.isSafeInteger(parsed.rowCount)
            || typeof parsed.importedAt !== 'string' || !parsed.mapping) return null;
        const source = validateDrugCatalogSource(parsed);
        return { format: DRUG_CATALOG_MANIFEST_FORMAT, ...source, sha256: parsed.sha256, fileName: parsed.fileName,
            rowCount: parsed.rowCount, importedAt: parsed.importedAt, mapping: parsed.mapping };
    } catch { return null; }
}
