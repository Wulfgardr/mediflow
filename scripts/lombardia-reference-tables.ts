import { readFileSync } from 'node:fs';
import {
    LOMBARDIA_SERVICE_CODE_SYSTEM,
    type LombardiaReferenceCatalog,
    type RegionalExemptionCoverageEntry,
    type RegionalServiceCatalogEntry,
    type ServicePrescriptionCategory,
} from '../lib/territorial/lombardia/service-packages';
import { parseCsv } from './loinc-lab-table';

export const NOMENCLATORE_TABLE_PATH = 'assets/reference-data/lombardia/nomenclatore-regionale.csv';
export const EXEMPTION_COVERAGE_TABLE_PATH = 'assets/reference-data/lombardia/esenzioni-prestazioni.csv';

const NOMENCLATORE_COLUMNS = ['codice', 'descrizione', 'nota', 'nota_regionale', 'branca'] as const;
const EXEMPTION_COLUMNS = ['esenzione', 'malattia', 'codice_prestazione', 'condizione', 'pagine_allegato_8'] as const;

export type NomenclatoreRow = Readonly<{
    code: string;
    description: string;
    nationalNote: string;
    regionalNote: string;
    branch: string;
}>;

function rowsWithHeader(text: string, columns: readonly string[], label: string): string[][] {
    const [header, ...body] = parseCsv(text);
    if (JSON.stringify(header) !== JSON.stringify(columns)) {
        throw new Error(`Intestazione di ${label} diversa da: ${columns.join(',')}`);
    }
    return body.map((cells, index) => {
        if (cells.length !== columns.length) {
            throw new Error(`${label}, riga ${index + 2}: ${cells.length} colonne invece di ${columns.length}`);
        }
        return cells;
    });
}

export function parseNomenclatoreTable(text: string): NomenclatoreRow[] {
    const seen = new Set<string>();
    return rowsWithHeader(text, NOMENCLATORE_COLUMNS, 'nomenclatore regionale').map(([code, description, nationalNote, regionalNote, branch]) => {
        if (seen.has(code)) throw new Error(`Codice ripetuto nel nomenclatore regionale: ${code}`);
        seen.add(code);
        return { code, description, nationalNote, regionalNote, branch };
    });
}

export function parseExemptionCoverageTable(text: string): RegionalExemptionCoverageEntry[] {
    return rowsWithHeader(text, EXEMPTION_COLUMNS, 'esenzioni').map(([exemptionCode, , serviceCode, condition]) => ({
        exemptionCode,
        serviceCode,
        condition,
    }));
}

function categoryForBranch(branch: string): ServicePrescriptionCategory {
    if (branch === 'Laboratorio') return 'lab';
    return 'other';
}

export function nomenclatoreCatalogEntries(rows: readonly NomenclatoreRow[]): RegionalServiceCatalogEntry[] {
    return rows.map((row) => ({
        codeSystem: LOMBARDIA_SERVICE_CODE_SYSTEM,
        serviceCode: row.code,
        displayName: row.description,
        category: categoryForBranch(row.branch),
        active: true,
    }));
}

export function readNomenclatoreTable(path = NOMENCLATORE_TABLE_PATH): NomenclatoreRow[] {
    return parseNomenclatoreTable(readFileSync(path, 'utf8'));
}

export function readLombardiaReferenceCatalog(): LombardiaReferenceCatalog {
    return {
        services: nomenclatoreCatalogEntries(readNomenclatoreTable()),
        exemptions: parseExemptionCoverageTable(readFileSync(EXEMPTION_COVERAGE_TABLE_PATH, 'utf8')),
    };
}
