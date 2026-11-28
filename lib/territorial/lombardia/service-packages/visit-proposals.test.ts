import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    TERRITORIAL_PACK_SCHEMA,
    type TerritorialPackCapability,
} from '../../../territorial-pack-contract';
import {
    PACKAGE_CATALOG_MODULE_PATH,
    readLombardiaReferenceCatalog,
    renderPackageCatalogModule,
    selectPackageReferenceCatalog,
} from '../../../../scripts/lombardia-reference-tables';
import {
    ALL_LOMBARDIA_SERVICE_PACKAGES,
    APPROVED_PACKAGE_REFERENCE_CATALOG,
    DRAFT_SET_MINIMI_PACKAGES,
    buildPackagePrescriptionDrafts,
    buildVisitServiceHistory,
    composeVisitPackageProposals,
    listApprovedServicePackages,
    type VisitHistoryItem,
    type VisitHistoryObservation,
    type VisitHistoryPrescription,
    type VisitPackageProposal,
} from './index';

const LOMBARDIA: TerritorialPackCapability = { schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: 1, preset: 'core+it+lom', status: 'ready' };
const ITALY_ONLY: TerritorialPackCapability = { schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: 1, preset: 'core+it', status: 'ready' };
const PATIENT = 'synthetic-patient-a';
const OTHER_PATIENT = 'synthetic-patient-b';
const AS_OF = '2026-11-28';
const DIABETES = [{ code: '5A11', system: 'ICD-11' }];

function prescription(overrides: Partial<VisitHistoryPrescription> & Pick<VisitHistoryPrescription, 'id' | 'serviceCode'>): VisitHistoryPrescription {
    return { patientId: PATIENT, status: 'prescribed', codeSystem: 'REGIONAL_PRESTAZIONI', prescribedAt: '2026-11-01', ...overrides };
}

function item(overrides: Partial<VisitHistoryItem> & Pick<VisitHistoryItem, 'id' | 'prescriptionId' | 'serviceCode'>): VisitHistoryItem {
    return { patientId: PATIENT, status: 'prescribed', codeSystem: 'REGIONAL_PRESTAZIONI', ...overrides };
}

function compose(input: {
    prescriptions?: VisitHistoryPrescription[];
    items?: VisitHistoryItem[];
    observations?: VisitHistoryObservation[];
    diagnoses?: { code: string; system: string }[];
    exemptionCodes?: string[];
    capability?: TerritorialPackCapability | null;
    patientId?: string;
}) {
    const history = buildVisitServiceHistory({
        patientId: input.patientId ?? PATIENT,
        prescriptions: input.prescriptions ?? [],
        items: input.items ?? [],
        observations: input.observations ?? [],
    });
    const proposals = composeVisitPackageProposals({
        packages: ALL_LOMBARDIA_SERVICE_PACKAGES,
        catalog: APPROVED_PACKAGE_REFERENCE_CATALOG,
        territorialCapability: input.capability === undefined ? LOMBARDIA : input.capability,
        diagnoses: input.diagnoses ?? DIABETES,
        exemptionCodes: input.exemptionCodes ?? ['013'],
        history: history.entries,
        asOf: AS_OF,
    });
    return { history, proposals };
}

function onlyProposal(result: ReturnType<typeof compose>): VisitPackageProposal {
    assert.equal(result.proposals.status, 'ready');
    if (result.proposals.status !== 'ready') throw new Error('unreachable');
    assert.equal(result.proposals.proposals.length, 1);
    return result.proposals.proposals[0];
}

function codes(proposal: VisitPackageProposal) {
    assert.equal(proposal.outcome.ok, true, JSON.stringify(proposal.outcome));
    if (!proposal.outcome.ok) throw new Error('unreachable');
    return {
        requested: new Set(proposal.outcome.requests.map((request) => request.serviceCode)),
        skipped: new Map(proposal.outcome.skipped.map((skipped) => [skipped.serviceCode, skipped.reason])),
        requests: proposal.outcome.requests,
    };
}

test('the generated client catalog equals the committed regional tables for the approved packages', () => {
    const expected = renderPackageCatalogModule(selectPackageReferenceCatalog(
        readLombardiaReferenceCatalog(),
        listApprovedServicePackages(ALL_LOMBARDIA_SERVICE_PACKAGES),
    ));
    assert.equal(readFileSync(PACKAGE_CATALOG_MODULE_PATH, 'utf8'), expected, 'npm run generate:lombardia-package-catalog');
});

test('a recent HbA1c from the record is excluded and a never-performed fundus is proposed', () => {
    const { requested, skipped } = codes(onlyProposal(compose({
        prescriptions: [prescription({ id: 'p-hba1c', serviceCode: '90.28.1', status: 'performed', prescribedAt: '2026-08-20', performedAt: '2026-08-28' })],
    })));
    assert.equal(requested.has('90.28.1'), false);
    assert.equal(skipped.get('90.28.1')?.kind, 'within_periodicity');
    assert.equal(requested.has('95.11'), true);
});

test('an observation explicitly linked to a regional HbA1c item counts as performed on its date', () => {
    const linked = compose({
        prescriptions: [prescription({ id: 'p-hba1c', serviceCode: '90.28.1', prescribedAt: '2026-01-10' })],
        items: [item({ id: 'i-hba1c', prescriptionId: 'p-hba1c', serviceCode: '90.28.1' })],
        observations: [{ patientId: PATIENT, display: 'Emoglobina glicata (HbA1c %)', observedAt: '2026-09-15', servicePrescriptionItemId: 'i-hba1c' }],
    });
    const linkedCodes = codes(onlyProposal(linked));
    assert.equal(linkedCodes.requested.has('90.28.1'), false);
    assert.deepEqual(linkedCodes.skipped.get('90.28.1'), {
        kind: 'within_periodicity', lastPerformedAt: '2026-09-15', validUntil: '2027-03-15', remainingMonths: 3,
        label: 'Valida ancora per 3 mesi (fino al 2027-03-15)',
    });
    assert.deepEqual(linked.history.uncomparedObservationNames, []);

    const unlinked = compose({
        observations: [{ patientId: PATIENT, display: 'Emoglobina glicata (HbA1c %)', observedAt: '2026-09-15' }],
    });
    assert.equal(codes(onlyProposal(unlinked)).requested.has('90.28.1'), true);
    assert.deepEqual(unlinked.history.uncomparedObservationNames, ['Emoglobina glicata (HbA1c %)']);

    const deleted = compose({
        prescriptions: [prescription({ id: 'p-hba1c', serviceCode: '90.28.1', status: 'cancelled', prescribedAt: '2026-01-10' })],
        items: [item({ id: 'i-hba1c', prescriptionId: 'p-hba1c', serviceCode: '90.28.1', status: 'cancelled' })],
        observations: [
            { patientId: PATIENT, display: 'Emoglobina glicata (HbA1c %)', observedAt: '2026-09-15', servicePrescriptionItemId: 'i-hba1c' },
            { patientId: PATIENT, display: 'Creatinina', observedAt: '2026-09-15', deletedAt: '2026-09-16' },
        ],
    });
    assert.equal(codes(onlyProposal(deleted)).requested.has('90.28.1'), true);
});

test('a pending prescription is excluded and an old one is proposed again', () => {
    const { requested, skipped } = codes(onlyProposal(compose({
        prescriptions: [
            prescription({ id: 'p-fundus', serviceCode: '95.11', prescribedAt: '2026-10-01' }),
            prescription({ id: 'p-ecg', serviceCode: '89.52', prescribedAt: '2025-06-01' }),
        ],
    })));
    assert.equal(requested.has('95.11'), false);
    assert.equal(skipped.get('95.11')?.kind, 'pending_order');
    assert.equal(requested.has('89.52'), true);
});

test('the renal module shortens albuminuria and adds potassium, declaring an exemption the patient lacks', () => {
    const proposal = onlyProposal(compose({
        diagnoses: [...DIABETES, { code: 'GB61.2', system: 'ICD-11' }],
        prescriptions: [prescription({ id: 'p-alb', serviceCode: '90.33.4', status: 'performed', prescribedAt: '2026-04-01', performedAt: '2026-05-01' })],
    }));
    assert.deepEqual(proposal.modules, [{ id: 'renale', title: 'Malattia renale cronica' }]);
    const { requested, requests } = codes(proposal);
    assert.equal(requested.has('90.33.4'), true);
    const potassium = requests.find((request) => request.serviceCode === '90.37.4');
    assert.ok(potassium);
    assert.equal(potassium.exemptionStatus, 'not_held_by_patient');
    assert.equal(potassium.exemptionCode, null);
    assert.equal(potassium.declaredExemptionCode, '023');

    const withoutModule = codes(onlyProposal(compose({
        prescriptions: [prescription({ id: 'p-alb', serviceCode: '90.33.4', status: 'performed', prescribedAt: '2026-04-01', performedAt: '2026-05-01' })],
    })));
    assert.equal(withoutModule.requested.has('90.33.4'), false);
    assert.equal(withoutModule.requested.has('90.37.4'), false);
});

test('history of another patient never shapes the proposal', () => {
    const { requested } = codes(onlyProposal(compose({
        prescriptions: [prescription({ id: 'p-other', patientId: OTHER_PATIENT, serviceCode: '95.11', prescribedAt: '2026-10-01' })],
        items: [item({ id: 'i-other', patientId: OTHER_PATIENT, prescriptionId: 'p-other', serviceCode: '90.28.1', status: 'performed', performedAt: '2026-10-01' })],
        observations: [{ patientId: OTHER_PATIENT, display: 'Creatinina', observedAt: '2026-10-01' }],
    })));
    assert.equal(requested.has('95.11'), true);
    assert.equal(requested.has('90.28.1'), true);
});

test('without the Lombardy pack, or without an ICD-11 diagnosis of an approved package, nothing is proposed', () => {
    assert.deepEqual(compose({ capability: ITALY_ONLY }).proposals, { status: 'territory_inactive' });
    assert.deepEqual(compose({ capability: null }).proposals, { status: 'territory_inactive' });
    assert.deepEqual(compose({ diagnoses: [{ code: '5A11', system: 'ICD-10' }] }).proposals, { status: 'ready', proposals: [] });
});

test('draft packages are never proposed, even when the patient carries their activation codes', () => {
    const draftCodes = DRAFT_SET_MINIMI_PACKAGES.flatMap((pkg) => pkg.activation.icd11Codes);
    assert.ok(draftCodes.length > 0);
    const result = compose({ diagnoses: draftCodes.map((code) => ({ code, system: 'ICD-11' })) });
    assert.equal(result.proposals.status, 'ready');
    if (result.proposals.status !== 'ready') return;
    const draftIds = new Set(DRAFT_SET_MINIMI_PACKAGES.map((pkg) => pkg.id));
    assert.equal(result.proposals.proposals.some((proposal) => draftIds.has(proposal.packageId)), false);
});

test('the prescription drafts carry code, edited question, priority and the package exemption for the chosen patient', () => {
    const proposal = onlyProposal(compose({}));
    const { requests } = codes(proposal);
    const fundus = requests.find((request) => request.serviceCode === '95.11');
    assert.ok(fundus);
    let counter = 0;
    const [draft] = buildPackagePrescriptionDrafts({
        patientId: PATIENT,
        proposal,
        choices: [{ request: fundus, clinicalQuestion: '  Screening retinopatia, primo controllo  ' }],
        prescribedAt: new Date('2026-11-28'),
        newId: () => `synthetic-id-${++counter}`,
    });
    assert.deepEqual(draft.prescription, {
        id: 'synthetic-id-1', patientId: PATIENT, prescribedAt: new Date('2026-11-28'), status: 'prescribed',
        category: 'imaging', priority: 'P', codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode: '95.11',
        serviceName: 'Fotografia del fundus', clinicalQuestion: 'Screening retinopatia, primo controllo', source: 'manual',
        notes: 'Dal pacchetto «Monitoraggio diabete mellito tipo 2» (Approvato da Leonardo Pegollo il 2026-11-25). Esenzione 013.',
    });
    assert.deepEqual(draft.item, {
        id: 'synthetic-id-2', patientId: PATIENT, prescriptionId: 'synthetic-id-1', ordinal: 0, status: 'prescribed',
        category: 'imaging', codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode: '95.11', serviceName: 'Fotografia del fundus', matchStatus: 'manual',
    });
    const [blank] = buildPackagePrescriptionDrafts({
        patientId: PATIENT, proposal, choices: [{ request: fundus, clinicalQuestion: '   ' }],
        prescribedAt: new Date('2026-11-28'), newId: () => 'synthetic-id',
    });
    assert.equal(blank.prescription.clinicalQuestion, fundus.clinicalQuestion);
});
