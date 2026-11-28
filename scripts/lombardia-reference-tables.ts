import { readFileSync } from 'node:fs';
import {
    LOMBARDIA_SERVICE_CODE_SYSTEM,
    type ApprovedServicePackage,
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
export const ALLEGATO_8_CONTROL_VISIT = 'VISITA DI CONTROLLO';
const CONTROL_VISIT_DESCRIPTION = /^VISITA\b[^.]*\bDI CONTROLLO\b/u;

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

export function controlVisitCodes(rows: readonly NomenclatoreRow[]): string[] {
    return rows.filter((row) => CONTROL_VISIT_DESCRIPTION.test(row.description)).map((row) => row.code);
}

export function expandControlVisitCoverage(
    entries: readonly RegionalExemptionCoverageEntry[],
    nomenclatore: readonly NomenclatoreRow[],
): RegionalExemptionCoverageEntry[] {
    const visits = controlVisitCodes(nomenclatore);
    return entries.flatMap((entry) => (entry.serviceCode === ALLEGATO_8_CONTROL_VISIT
        ? visits.map((serviceCode) => ({ ...entry, serviceCode }))
        : [entry]));
}

export function readExemptionCoverageTable(path = EXEMPTION_COVERAGE_TABLE_PATH): RegionalExemptionCoverageEntry[] {
    return parseExemptionCoverageTable(readFileSync(path, 'utf8'));
}

export function readLombardiaReferenceCatalog(): LombardiaReferenceCatalog {
    const nomenclatore = readNomenclatoreTable();
    return {
        services: nomenclatoreCatalogEntries(nomenclatore),
        exemptions: expandControlVisitCoverage(readExemptionCoverageTable(), nomenclatore),
    };
}

export const PACKAGE_CATALOG_MODULE_PATH = 'lib/territorial/lombardia/service-packages/generated-package-catalog.ts';

function packageServiceCodes(packages: readonly ApprovedServicePackage[]): Set<string> {
    return new Set(packages.flatMap((pkg) => [
        ...pkg.baseItems,
        ...pkg.complicationModules.flatMap((module) => module.items),
    ]).map((item) => item.serviceCode));
}

export function selectPackageReferenceCatalog(
    catalog: LombardiaReferenceCatalog,
    packages: readonly ApprovedServicePackage[],
): LombardiaReferenceCatalog {
    const codes = packageServiceCodes(packages);
    return {
        services: catalog.services.filter((entry) => codes.has(entry.serviceCode)),
        exemptions: catalog.exemptions.filter((entry) => codes.has(entry.serviceCode)),
    };
}

export function renderPackageCatalogModule(catalog: LombardiaReferenceCatalog): string {
    const lines = (items: readonly object[]) => items.map((item) => `        ${JSON.stringify(item)},`);
    return [
        "import type { LombardiaReferenceCatalog } from './contract';",
        '',
        'export const APPROVED_PACKAGE_REFERENCE_CATALOG: LombardiaReferenceCatalog = {',
        '    services: [',
        ...lines(catalog.services),
        '    ],',
        '    exemptions: [',
        ...lines(catalog.exemptions),
        '    ],',
        '};',
        '',
    ].join('\n');
}
