import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseWhoTabulation } from '../../../reference-data/icd11-embedded-parser';
import {
    TERRITORIAL_PACK_SCHEMA,
    type TerritorialPackCapability,
} from '../../../territorial-pack-contract';
import {
    readLombardiaReferenceCatalog,
    readNomenclatoreTable,
} from '../../../../scripts/lombardia-reference-tables';
import {
    DIABETES_T2_PACKAGE_DRAFT,
    approvedServicePackageSchema,
    formatServicePackageApproval,
    generatePackageServiceRequests,
    resolveMatchingComplicationModules,
    validateServicePackage,
    type ApprovedServicePackage,
    type GeneratedServiceRequest,
    type PatientServiceHistoryEntry,
    type ServicePackage,
    type ServicePackageItem,
} from './index';

const CATALOG = readLombardiaReferenceCatalog();

const LOMBARDIA: TerritorialPackCapability = {
    schemaVersion: TERRITORIAL_PACK_SCHEMA,
    revision: 1,
    preset: 'core+it+lom',
    status: 'ready',
};

const CORE_ONLY: TerritorialPackCapability = {
    schemaVersion: TERRITORIAL_PACK_SCHEMA,
    revision: 0,
    preset: 'core',
    status: 'ready',
};

function approvedForTest(): ApprovedServicePackage {
    return approvedServicePackageSchema.parse({
        ...DIABETES_T2_PACKAGE_DRAFT,
        approval: { status: 'approved', approvedBy: 'Medico Sintetico', approvedAt: '2026-11-25' },
    });
}

function allItems(pkg: ServicePackage): ServicePackageItem[] {
    return [...pkg.baseItems, ...pkg.complicationModules.flatMap((module) => module.items)];
}

function generate(input: {
    patientIcd11Codes: readonly string[];
    patientExemptionCodes?: readonly string[];
    history?: readonly PatientServiceHistoryEntry[];
    asOf?: string;
}) {
    const pkg = approvedForTest();
    return generatePackageServiceRequests({
        package: pkg,
        territorialCapability: LOMBARDIA,
        catalog: CATALOG,
        activeModuleIds: resolveMatchingComplicationModules(pkg, input.patientIcd11Codes),
        history: input.history ?? [],
        asOf: input.asOf ?? '2026-11-25',
        patientExemptionCodes: input.patientExemptionCodes,
    });
}

function requestsByCode(outcome: ReturnType<typeof generate>): Map<string, GeneratedServiceRequest> {
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok) throw new Error('unreachable');
    return new Map(outcome.requests.map((request) => [request.serviceCode, request]));
}

test('ogni codice di prestazione del pacchetto esiste nel nomenclatore regionale del repository', () => {
    const nomenclatore = new Map(readNomenclatoreTable().map((row) => [row.code, row]));
    assert.ok(nomenclatore.size > 2000);
    for (const item of allItems(DIABETES_T2_PACKAGE_DRAFT)) {
        assert.ok(nomenclatore.has(item.serviceCode), `${item.serviceCode} (${item.id}) assente dal nomenclatore`);
    }
    assert.match(nomenclatore.get('90.28.1')?.description ?? '', /EMOGLOBINA GLICATA/u);
    assert.match(nomenclatore.get('89.52')?.description ?? '', /Visita cardiologica di controllo \(89\.01\.3\)/u);
    assert.equal(nomenclatore.has('95.09.1'), false);
});

test('ogni esenzione usata esiste nella tabella del repository e comprende la prestazione', () => {
    const coverage = new Set(CATALOG.exemptions.map((entry) => `${entry.exemptionCode}:${entry.serviceCode}`));
    const exemptions = new Set(CATALOG.exemptions.map((entry) => entry.exemptionCode));
    assert.ok(exemptions.has(DIABETES_T2_PACKAGE_DRAFT.exemption.code));
    for (const item of allItems(DIABETES_T2_PACKAGE_DRAFT)) {
        if (item.exemptionCode === null) continue;
        assert.ok(coverage.has(`${item.exemptionCode}:${item.serviceCode}`), `${item.exemptionCode} non comprende ${item.serviceCode}`);
    }
});

test('la tabella delle esenzioni concorda col nomenclatore regionale, salvo l’albumina glicata 90.05.6', () => {
    const codes = new Set(readNomenclatoreTable().map((row) => row.code));
    const missing = CATALOG.exemptions.filter((entry) => !codes.has(entry.serviceCode)).map((entry) => entry.serviceCode);
    assert.deepEqual(missing, ['90.05.6']);
    assert.equal(CATALOG.exemptions.filter((entry) => entry.exemptionCode === '013').length, 46);
});

test('ogni codice ICD-11 di attivazione e di complicanza esiste nel catalogo ICD-11 del repository', () => {
    const { entries } = parseWhoTabulation(readFileSync('assets/reference-data/icd11/catalog.zip'));
    const codes = new Set(entries.map((entry) => entry.code));
    const used = [
        ...DIABETES_T2_PACKAGE_DRAFT.activation.icd11Codes,
        ...DIABETES_T2_PACKAGE_DRAFT.complicationModules.flatMap((module) => module.triggerIcd11Codes),
    ];
    for (const code of used) assert.ok(codes.has(code), `${code} assente dal catalogo ICD-11`);
});

test('ogni voce cita una fonte con documento, sezione, data e indirizzo', () => {
    for (const item of allItems(DIABETES_T2_PACKAGE_DRAFT)) {
        assert.ok(item.sources.length > 0, item.id);
        for (const source of item.sources) {
            assert.match(source.publishedAt, /^\d{4}-\d{2}-\d{2}$/u);
            assert.match(source.url, /^https:\/\//u);
            assert.ok(source.sectionOrTable.length > 0);
        }
    }
});

test('il pacchetto diabete nasce in bozza da approvare e passa la validazione sul catalogo vero', () => {
    assert.equal(formatServicePackageApproval(DIABETES_T2_PACKAGE_DRAFT.approval), 'Bozza da approvare');
    assert.deepEqual(validateServicePackage(DIABETES_T2_PACKAGE_DRAFT, CATALOG), { ok: true, value: DIABETES_T2_PACKAGE_DRAFT });
    assert.equal(formatServicePackageApproval(approvedForTest().approval), 'Approvato da Medico Sintetico il 2026-11-25');
});

test('WUL-921: diabetico con nefropatia, pacchetto diabete + modulo renale', () => {
    const outcome = generate({ patientIcd11Codes: ['5A11', 'GB61.Z'], patientExemptionCodes: ['013', '023'] });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.activeModuleIds, ['renale']);
    assert.deepEqual(outcome.skipped, []);
    const summary = outcome.requests.map((request) => [request.serviceCode, request.exemptionCode, request.periodicityMonths, request.reason.label]);
    assert.deepEqual(summary, [
        ['90.28.1', '013', 6, 'Mai eseguita'],
        ['90.14.3', '013', 12, 'Mai eseguita'],
        ['90.14.1', '013', 12, 'Mai eseguita'],
        ['90.43.2', '013', 12, 'Mai eseguita'],
        ['90.16.3', '013', 12, 'Mai eseguita'],
        ['90.33.4', '013', 6, 'Mai eseguita'],
        ['90.04.5', '013', 12, 'Mai eseguita'],
        ['90.09.2', '013', 12, 'Mai eseguita'],
        ['95.11', '013', 24, 'Mai eseguita'],
        ['89.52', '013', 12, 'Mai eseguita'],
        ['90.37.4', '023', 12, 'Mai eseguita'],
    ]);
    const byCode = requestsByCode(outcome);
    assert.equal(byCode.get('90.28.1')?.clinicalQuestion, 'Diabete mellito tipo 2: controllo del compenso glicemico');
    assert.equal(byCode.get('90.33.4')?.clinicalQuestion, 'Diabete mellito tipo 2 con malattia renale cronica: controllo dell’albuminuria');
    assert.equal(byCode.get('90.33.4')?.sourceModuleId, 'renale');
    assert.ok(byCode.get('90.16.3')?.appropriatenessConditions.includes('Più ravvicinata se la funzione renale è ridotta'));
    for (const request of outcome.requests) {
        assert.equal(request.codeSystem, 'REGIONAL_PRESTAZIONI');
        assert.equal(request.exemptionStatus, 'active');
        assert.ok(request.sources.length > 0);
    }
});

test('senza esenzione 023 il potassio resta proposto ma senza esenzione', () => {
    const potassium = requestsByCode(generate({ patientIcd11Codes: ['5A11', 'GB61'], patientExemptionCodes: ['013'] })).get('90.37.4');
    assert.equal(potassium?.exemptionCode, null);
    assert.equal(potassium?.exemptionStatus, 'not_held_by_patient');
});

test('i moduli si attivano solo con la loro complicanza', () => {
    const pkg = approvedForTest();
    assert.deepEqual(resolveMatchingComplicationModules(pkg, ['5A11']), []);
    assert.deepEqual(resolveMatchingComplicationModules(pkg, ['5A11', 'BA52', 'DB92.0']), ['cardiologico', 'epatico']);
    assert.deepEqual(resolveMatchingComplicationModules(pkg, ['GB610']), []);
});

test('la validazione rifiuta fonte assente, data mancante o non valida', () => {
    const [first, ...rest] = DIABETES_T2_PACKAGE_DRAFT.baseItems;
    const withItem = (item: unknown) => ({ ...DIABETES_T2_PACKAGE_DRAFT, baseItems: [item, ...rest] });
    const sourceWithoutDate = Object.fromEntries(Object.entries(first.sources[0]).filter(([key]) => key !== 'publishedAt'));
    const cases = [
        withItem({ ...first, sources: [] }),
        withItem({ ...first, sources: [sourceWithoutDate] }),
        withItem({ ...first, sources: [{ ...first.sources[0], publishedAt: '2026-02-30' }] }),
        { ...DIABETES_T2_PACKAGE_DRAFT, sources: [] },
    ];
    for (const candidate of cases) {
        const result = validateServicePackage(candidate, CATALOG);
        assert.equal(result.ok, false);
        if (!result.ok) assert.ok(result.issues.every((issue) => issue.code === 'SCHEMA_INVALID'));
    }
});

test('la validazione rifiuta codici assenti dal catalogo ed esenzioni che non comprendono la prestazione', () => {
    const [first, ...rest] = DIABETES_T2_PACKAGE_DRAFT.baseItems;
    const issuesFor = (item: ServicePackageItem) => {
        const result = validateServicePackage({ ...DIABETES_T2_PACKAGE_DRAFT, baseItems: [item, ...rest] }, CATALOG);
        return result.ok ? [] : result.issues.map((issue) => issue.code);
    };
    assert.deepEqual(issuesFor({ ...first, serviceCode: '95.09.1' }), ['CODE_NOT_IN_CATALOG', 'EXEMPTION_DOES_NOT_COVER_SERVICE']);
    assert.deepEqual(issuesFor({ ...first, serviceCode: '90.37.4' }), ['EXEMPTION_DOES_NOT_COVER_SERVICE']);
    assert.deepEqual(issuesFor({ ...first, exemptionCode: '999' }), ['EXEMPTION_NOT_IN_CATALOG']);
    assert.deepEqual(issuesFor({ ...first, exemptionCode: null }), []);
});

test('una bozza non genera prestazioni, né le genera il modulo Lombardia spento', () => {
    const draftAsApproved = DIABETES_T2_PACKAGE_DRAFT as unknown as ApprovedServicePackage;
    const base = { territorialCapability: LOMBARDIA, catalog: CATALOG, activeModuleIds: [], history: [], asOf: '2026-11-25' };
    const draft = generatePackageServiceRequests({ ...base, package: draftAsApproved });
    assert.equal(draft.ok, false);
    if (!draft.ok) assert.equal(draft.errorCode, 'PACKAGE_NOT_APPROVED');
    const disabled = generatePackageServiceRequests({ ...base, package: approvedForTest(), territorialCapability: CORE_ONLY });
    assert.equal(disabled.ok, false);
    if (!disabled.ok) assert.equal(disabled.errorCode, 'TERRITORIAL_PACK_DISABLED');
});

test('WUL-922: HbA1c di 3 mesi fa e fondo mai fatto, propone il fondo e non l’HbA1c', () => {
    const outcome = generate({
        patientIcd11Codes: ['5A11'],
        history: [{ serviceCode: '90.28.1', status: 'report_received', performedAt: '2026-08-25' }],
    });
    const byCode = requestsByCode(outcome);
    assert.equal(byCode.has('90.28.1'), false);
    assert.equal(byCode.get('95.11')?.reason.label, 'Mai eseguita');
    if (!outcome.ok) return;
    assert.deepEqual(outcome.skipped.map((item) => [item.serviceCode, item.reason.label]), [
        ['90.28.1', 'Valida ancora per 3 mesi (fino al 2027-02-25)'],
    ]);
});

test('WUL-922: recenti esclusi, scaduti con i mesi di ritardo, prescritti in attesa esclusi, annullati riproposti', () => {
    const history: PatientServiceHistoryEntry[] = [
        { serviceCode: '90.14.3', status: 'performed', performedAt: '2025-09-20' },
        { serviceCode: '90.14.3', status: 'performed', performedAt: '2024-01-10' },
        { serviceCode: '89.52', status: 'report_received', performedAt: '2026-06-01' },
        { serviceCode: '90.16.3', status: 'prescribed', prescribedAt: '2026-11-01' },
        { serviceCode: '90.33.4', status: 'cancelled', prescribedAt: '2026-11-01' },
        { serviceCode: '95.11', status: 'performed', performedAt: '2024-10-15' },
        { serviceCode: '90.28.1', status: 'performed', performedAt: '2027-01-01' },
        { serviceCode: '90.43.2', codeSystem: 'ALTRO_CATALOGO', status: 'performed', performedAt: '2026-11-01' },
    ];
    const outcome = generate({ patientIcd11Codes: ['5A11'], history });
    const byCode = requestsByCode(outcome);
    assert.deepEqual(byCode.get('90.14.3')?.reason, { kind: 'overdue', lastPerformedAt: '2025-09-20', overdueMonths: 2, label: 'Scaduta da 2 mesi' });
    assert.equal(byCode.get('95.11')?.reason.label, 'Scaduta da 1 mese');
    assert.equal(byCode.get('90.33.4')?.reason.label, 'Mai eseguita');
    assert.equal(byCode.get('90.28.1')?.reason.label, 'Mai eseguita');
    assert.equal(byCode.get('90.43.2')?.reason.label, 'Mai eseguita');
    if (!outcome.ok) return;
    assert.deepEqual(outcome.skipped.map((item) => [item.serviceCode, item.reason.kind]), [
        ['90.16.3', 'pending_order'],
        ['89.52', 'within_periodicity'],
    ]);
});

test('una prescrizione più vecchia della cadenza e mai eseguita torna proposta dicendo quando era stata prescritta', () => {
    const history: PatientServiceHistoryEntry[] = [{ serviceCode: '90.28.1', status: 'prescribed', prescribedAt: '2026-04-01' }];
    const hba1c = requestsByCode(generate({ patientIcd11Codes: ['5A11'], history })).get('90.28.1');
    assert.deepEqual(hba1c?.reason, {
        kind: 'ordered_not_performed',
        orderedAt: '2026-04-01',
        label: 'Prescritta o prenotata il 2026-04-01, non risulta eseguita',
    });
});

test('una data di calendario impossibile è rifiutata come riferimento e ignorata nello storico', () => {
    const outcome = generate({ patientIcd11Codes: ['5A11'], asOf: '2026-02-30' });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.errorCode, 'INVALID_REFERENCE_DATE');
    const history: PatientServiceHistoryEntry[] = [{ serviceCode: '90.28.1', status: 'performed', performedAt: '2026-09-31' }];
    assert.equal(requestsByCode(generate({ patientIcd11Codes: ['5A11'], history })).get('90.28.1')?.reason.label, 'Mai eseguita');
});

test('con il modulo renale l’albuminuria di 8 mesi fa torna da richiedere', () => {
    const history: PatientServiceHistoryEntry[] = [{ serviceCode: '90.33.4', status: 'performed', performedAt: '2026-03-25' }];
    assert.equal(requestsByCode(generate({ patientIcd11Codes: ['5A11'], history })).has('90.33.4'), false);
    const renal = requestsByCode(generate({ patientIcd11Codes: ['5A11', 'GB61.Z'], history })).get('90.33.4');
    assert.equal(renal?.reason.label, 'Scaduta da 2 mesi');
});
