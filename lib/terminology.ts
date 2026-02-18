/* @Codex */
export type TerminologySystemCode = 'AIC' | 'ATC' | 'ICD-11' | 'LOINC' | 'UCUM' | 'SNOMED-CT' | 'CND';

/* @Codex */
export type TerminologySystemDescriptor = {
    code: TerminologySystemCode;
    display: string;
    source: string;
    status: 'active' | 'planned';
    notes?: string;
};

/* @Codex */
export type TerminologyItem = {
    system: TerminologySystemCode;
    code: string;
    display: string;
    version?: string | null;
    source: string;
};

/* @Codex */
type StaticCatalogItem = {
    code: string;
    display: string;
    version?: string;
};

/* @Codex */
const SYSTEMS: TerminologySystemDescriptor[] = [
    { code: 'ICD-11', display: 'ICD-11', source: 'WHO local API proxy', status: 'active' },
    { code: 'AIC', display: 'AIC', source: 'AIFA local catalog', status: 'active' },
    { code: 'ATC', display: 'ATC', source: 'Derived from local AIFA catalog', status: 'active' },
    { code: 'LOINC', display: 'LOINC', source: 'Pilot local subset', status: 'active', notes: 'Vital signs pilot subset' },
    { code: 'UCUM', display: 'UCUM', source: 'Pilot local subset', status: 'active', notes: 'Unit-of-measure pilot subset' },
    { code: 'SNOMED-CT', display: 'SNOMED CT', source: 'Not integrated yet', status: 'planned' },
    { code: 'CND', display: 'CND', source: 'Not integrated yet', status: 'planned' },
];

/* @Codex */
const LOINC_PILOT: StaticCatalogItem[] = [
    { code: '8480-6', display: 'Systolic blood pressure', version: '2.78' },
    { code: '8462-4', display: 'Diastolic blood pressure', version: '2.78' },
    { code: '8867-4', display: 'Heart rate', version: '2.78' },
    { code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry', version: '2.78' },
    { code: '8310-5', display: 'Body temperature', version: '2.78' },
    { code: '29463-7', display: 'Body weight', version: '2.78' },
    { code: '2339-0', display: 'Glucose [Mass/volume] in Blood', version: '2.78' },
];

/* @Codex */
const UCUM_PILOT: StaticCatalogItem[] = [
    { code: 'mm[Hg]', display: 'millimeter of mercury', version: '2.1' },
    { code: '/min', display: 'per minute', version: '2.1' },
    { code: '%', display: 'percent', version: '2.1' },
    { code: 'Cel', display: 'degree Celsius', version: '2.1' },
    { code: 'kg', display: 'kilogram', version: '2.1' },
    { code: 'mg/dL', display: 'milligram per deciliter', version: '2.1' },
];

/* @Codex */
export function listTerminologySystems(): TerminologySystemDescriptor[] {
    return SYSTEMS;
}

/* @Codex */
export function normalizeTerminologySystem(value: unknown): TerminologySystemCode | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    if (normalized === 'ICD11' || normalized === 'ICD-11') return 'ICD-11';
    if (normalized === 'AIC') return 'AIC';
    if (normalized === 'ATC') return 'ATC';
    if (normalized === 'LOINC') return 'LOINC';
    if (normalized === 'UCUM') return 'UCUM';
    if (normalized === 'SNOMED' || normalized === 'SNOMED-CT' || normalized === 'SNOMED CT') return 'SNOMED-CT';
    if (normalized === 'CND') return 'CND';
    return null;
}

/* @Codex */
function staticCatalogFor(system: TerminologySystemCode): StaticCatalogItem[] | null {
    if (system === 'LOINC') return LOINC_PILOT;
    if (system === 'UCUM') return UCUM_PILOT;
    return null;
}

/* @Codex */
export function searchStaticTerminology(system: TerminologySystemCode, query: string, limit: number): TerminologyItem[] {
    const catalog = staticCatalogFor(system);
    if (!catalog) return [];

    const q = query.trim().toLowerCase();
    const filtered = catalog.filter((item) => {
        if (!q) return true;
        return item.code.toLowerCase().includes(q) || item.display.toLowerCase().includes(q);
    });

    return filtered.slice(0, limit).map((item) => ({
        system,
        code: item.code,
        display: item.display,
        version: item.version ?? null,
        source: 'local-pilot-catalog',
    }));
}

/* @Codex */
export function resolveStaticTerminology(system: TerminologySystemCode, code: string): TerminologyItem | null {
    const catalog = staticCatalogFor(system);
    if (!catalog) return null;
    const match = catalog.find((item) => item.code.toLowerCase() === code.trim().toLowerCase());
    if (!match) return null;
    return {
        system,
        code: match.code,
        display: match.display,
        version: match.version ?? null,
        source: 'local-pilot-catalog',
    };
}

/* @Codex */
export type FseValidationIssue = {
    field: string;
    code: string;
    message: string;
};

/* @Codex */
export type FseValidationResponse = {
    ok: boolean;
    profile: string;
    errors: FseValidationIssue[];
    warnings: FseValidationIssue[];
};

/* @Codex */
export function buildValidationResponse(profile: string, errors: FseValidationIssue[], warnings: FseValidationIssue[]): FseValidationResponse {
    return {
        ok: errors.length === 0,
        profile,
        errors,
        warnings,
    };
}
