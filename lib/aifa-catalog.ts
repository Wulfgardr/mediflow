/* @Codex */

export const AIFA_CATALOG_MANIFEST_SETTING_KEY = 'aifaCatalogManifest';
export const AIFA_CATALOG_SOURCE = 'Agenzia Italiana del Farmaco (AIFA)';
export const AIFA_CATALOG_DEFAULT_SOURCE_URL = 'https://www.aifa.gov.it/open-data';
export const AIFA_REUSE_TERMS_URL = 'https://www.aifa.gov.it/copyright';

export type AifaCatalogManifestInput = {
    sourceUrl: string;
    downloadedAt: string;
    version: string;
};

export type AifaCatalogManifest = AifaCatalogManifestInput & {
    format: 'mediflow.aifa-catalog-manifest.v1';
    source: typeof AIFA_CATALOG_SOURCE;
    reuseTermsUrl: typeof AIFA_REUSE_TERMS_URL;
    reuseStatus: 'source-artifact-review-required';
    sha256: string;
    fileName: string;
    rowCount: number;
    importedAt: string;
};

export type ParsedAifaDrug = {
    aic: string;
    name: string;
    activePrinciple: string | null;
    company: string | null;
    packaging: string | null;
    class: string | null;
    price: number | null;
    atc: string | null;
    aicSearch: string;
    nameSearch: string;
    activePrincipleSearch: string;
};

export type AifaCsvParseResult = {
    drugs: ParsedAifaDrug[];
    totalRecords: number;
    rejectedRecords: number;
};

const HEADER_ALIASES = {
    aic: ['codice_aic', 'aic'],
    name: ['denominazione', 'nome_commerciale'],
    packaging: ['descrizione', 'confezione'],
    company: ['ragione_sociale', 'ditta', 'titolare_aic'],
    atc: ['codice_atc', 'atc'],
    activePrinciple: ['pa_associati', 'principio_attivo', 'principi_attivi'],
    drugClass: ['fascia', 'classe'],
    price: ['prezzo', 'prezzo_riferimento'],
} as const;

export function normalizeAifaSearchText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLocaleLowerCase('it-IT')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function normalizeHeader(value: string): string {
    return normalizeAifaSearchText(value.replace(/^\uFEFF/, '')).replace(/ /g, '_');
}

function parseCsvRecords(text: string, delimiter: string): string[][] {
    const records: string[][] = [];
    let record: string[] = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
            continue;
        }
        if (!quoted && char === delimiter) {
            record.push(field.trim());
            field = '';
            continue;
        }
        if (!quoted && (char === '\n' || char === '\r')) {
            if (char === '\r' && text[index + 1] === '\n') index += 1;
            record.push(field.trim());
            field = '';
            if (record.some(Boolean)) records.push(record);
            record = [];
            continue;
        }
        field += char;
    }

    record.push(field.trim());
    if (record.some(Boolean)) records.push(record);
    if (quoted) throw new Error('CSV AIFA non valido: virgolette non chiuse');
    return records;
}

function resolveColumn(headers: string[], aliases: readonly string[], required = false): number {
    const index = aliases.map((alias) => headers.indexOf(alias)).find((value) => value >= 0) ?? -1;
    if (required && index < 0) {
        throw new Error(`CSV AIFA non valido: colonna ${aliases[0]} assente`);
    }
    return index;
}

function readColumn(record: string[], index: number): string | null {
    if (index < 0) return null;
    const value = record[index]?.trim();
    return value || null;
}

function parsePrice(value: string | null): number | null {
    if (!value) return null;
    const normalized = value.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
    const amount = Number(normalized);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function parseAifaCsv(text: string): AifaCsvParseResult {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = firstLine.includes(';') ? ';' : ',';
    const records = parseCsvRecords(text, delimiter);
    if (records.length < 2) throw new Error('CSV AIFA non valido: nessun record');

    const headers = records[0].map(normalizeHeader);
    const columns = {
        aic: resolveColumn(headers, HEADER_ALIASES.aic, true),
        name: resolveColumn(headers, HEADER_ALIASES.name, true),
        packaging: resolveColumn(headers, HEADER_ALIASES.packaging),
        company: resolveColumn(headers, HEADER_ALIASES.company),
        atc: resolveColumn(headers, HEADER_ALIASES.atc),
        activePrinciple: resolveColumn(headers, HEADER_ALIASES.activePrinciple),
        drugClass: resolveColumn(headers, HEADER_ALIASES.drugClass),
        price: resolveColumn(headers, HEADER_ALIASES.price),
    };

    const byAic = new Map<string, ParsedAifaDrug>();
    let rejectedRecords = 0;
    for (const record of records.slice(1)) {
        const aic = readColumn(record, columns.aic)?.replace(/\s/g, '') || '';
        const name = readColumn(record, columns.name) || '';
        if (!/^\d{6,9}$/.test(aic) || !name) {
            rejectedRecords += 1;
            continue;
        }
        const activePrinciple = readColumn(record, columns.activePrinciple);
        byAic.set(aic, {
            aic,
            name,
            activePrinciple,
            company: readColumn(record, columns.company),
            packaging: readColumn(record, columns.packaging),
            class: readColumn(record, columns.drugClass),
            price: parsePrice(readColumn(record, columns.price)),
            atc: readColumn(record, columns.atc)?.toUpperCase() || null,
            aicSearch: normalizeAifaSearchText(aic),
            nameSearch: normalizeAifaSearchText(name),
            activePrincipleSearch: normalizeAifaSearchText(activePrinciple || ''),
        });
    }

    if (byAic.size === 0) throw new Error('CSV AIFA non valido: nessun farmaco importabile');
    return {
        drugs: [...byAic.values()],
        totalRecords: records.length - 1,
        rejectedRecords,
    };
}

export function validateAifaManifestInput(input: AifaCatalogManifestInput): AifaCatalogManifestInput {
    const version = input.version.trim();
    const downloadedAt = input.downloadedAt.trim();
    let sourceUrl: URL;
    try {
        sourceUrl = new URL(input.sourceUrl.trim());
    } catch {
        throw new Error('URL fonte AIFA non valido');
    }
    if (!['http:', 'https:'].includes(sourceUrl.protocol)) throw new Error('URL fonte AIFA non valido');
    const parsedDownloadedAt = new Date(`${downloadedAt}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(downloadedAt)
        || Number.isNaN(parsedDownloadedAt.getTime())
        || parsedDownloadedAt.toISOString().slice(0, 10) !== downloadedAt) {
        throw new Error('Data di scarico AIFA non valida');
    }
    if (!version || version.length > 120) throw new Error('Versione dataset AIFA non valida');
    return { sourceUrl: sourceUrl.toString(), downloadedAt, version };
}

export function buildAifaCatalogManifest(
    input: AifaCatalogManifestInput,
    artifact: { sha256: string; fileName: string; rowCount: number; importedAt?: string },
): AifaCatalogManifest {
    const validated = validateAifaManifestInput(input);
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('Hash SHA-256 AIFA non valido');
    if (!artifact.fileName.trim() || artifact.rowCount < 1) throw new Error('Artifact AIFA non valido');
    return {
        format: 'mediflow.aifa-catalog-manifest.v1',
        source: AIFA_CATALOG_SOURCE,
        reuseTermsUrl: AIFA_REUSE_TERMS_URL,
        reuseStatus: 'source-artifact-review-required',
        ...validated,
        sha256: artifact.sha256,
        fileName: artifact.fileName.trim(),
        rowCount: artifact.rowCount,
        importedAt: artifact.importedAt || new Date().toISOString(),
    };
}

export function parseStoredAifaCatalogManifest(value: string | null | undefined): AifaCatalogManifest | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as Partial<AifaCatalogManifest>;
        if (parsed.format !== 'mediflow.aifa-catalog-manifest.v1'
            || parsed.source !== AIFA_CATALOG_SOURCE
            || parsed.reuseTermsUrl !== AIFA_REUSE_TERMS_URL
            || parsed.reuseStatus !== 'source-artifact-review-required'
            || typeof parsed.sha256 !== 'string'
            || typeof parsed.fileName !== 'string'
            || typeof parsed.rowCount !== 'number'
            || typeof parsed.importedAt !== 'string'
            || typeof parsed.sourceUrl !== 'string'
            || typeof parsed.downloadedAt !== 'string'
            || typeof parsed.version !== 'string') return null;
        buildAifaCatalogManifest(parsed as AifaCatalogManifestInput, {
            sha256: parsed.sha256,
            fileName: parsed.fileName,
            rowCount: parsed.rowCount,
            importedAt: parsed.importedAt,
        });
        return parsed as AifaCatalogManifest;
    } catch {
        return null;
    }
}
