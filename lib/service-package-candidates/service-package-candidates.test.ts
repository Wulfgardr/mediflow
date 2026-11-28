import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvedServicePackageSchema } from '../territorial/lombardia/service-packages';
import {
    PERSONAL_CANDIDATE_REVIEW_SCHEMA,
    PERSONAL_SERVICE_CANDIDATE_KIND,
    correctCandidateDecision,
    deriveRecurringServiceCandidates,
    discardCandidateDecision,
    emptyPersonalCandidateReviewStore,
    findCandidateDecision,
    keepCandidateDecision,
    parsePersonalCandidateReviewStore,
    restoreCandidateDecision,
    serializePersonalCandidateReviewStore,
    type CandidateHistoryPatientInput,
    type CandidateHistoryPrescriptionInput,
    type CandidateHistoryPrescriptionItemInput,
} from './index';

function buildSynthetic50PrescriptionsFixture() {
    const patients: CandidateHistoryPatientInput[] = [];
    for (let i = 1; i <= 15; i += 1) {
        const isDiabetesCohort = i <= 10;
        patients.push({
            id: `pat-syn-${i}`,
            diagnoses: isDiabetesCohort
                ? [
                    { code: '5A11', system: 'ICD-11', description: 'Diabete mellito di tipo 2' },
                    ...(i <= 3 ? [{ code: 'BA00', system: 'ICD-11', description: 'Ipertensione essenziale' }] : []),
                ]
                : [{ code: 'BA00', system: 'ICD-11', description: 'Ipertensione essenziale' }],
        });
    }

    const prescriptions: CandidateHistoryPrescriptionInput[] = [];
    const items: CandidateHistoryPrescriptionItemInput[] = [];

    const coreTriplet = [
        { code: '90.28.1', name: 'EMOGLOBINA GLICATA', category: 'lab' as const },
        { code: '90.27.1', name: 'GLUCOSIO [S/P]', category: 'lab' as const },
        { code: '90.16.3', name: 'CREATININA [S/P]', category: 'lab' as const },
    ];

    for (let p = 1; p <= 30; p += 1) {
        const patientId = `pat-syn-${((p - 1) % 10) + 1}`;
        const prescriptionId = `rx-tri-${p}`;
        prescriptions.push({
            id: prescriptionId,
            patientId,
            status: 'prescribed',
            category: 'lab',
            serviceName: 'Controllo metabolico sintetico',
        });
        coreTriplet.forEach((service, ordinal) => {
            items.push({
                id: `${prescriptionId}-item-${ordinal}`,
                patientId,
                prescriptionId,
                status: 'prescribed',
                category: service.category,
                codeSystem: 'REGIONAL_PRESTAZIONI',
                serviceCode: service.code,
                serviceName: service.name,
            });
        });
    }

    for (let p = 31; p <= 50; p += 1) {
        const patientId = `pat-syn-${11 + ((p - 31) % 5)}`;
        const prescriptionId = `rx-other-${p}`;
        prescriptions.push({
            id: prescriptionId,
            patientId,
            status: 'prescribed',
            category: 'lab',
            serviceName: `Controllo vario ${p}`,
        });
        items.push(
            {
                id: `${prescriptionId}-item-0`,
                patientId,
                prescriptionId,
                status: 'prescribed',
                category: 'lab',
                codeSystem: 'REGIONAL_PRESTAZIONI',
                serviceCode: `99.${p}.1`,
                serviceName: `Esame vario A ${p}`,
            },
            {
                id: `${prescriptionId}-item-1`,
                patientId,
                prescriptionId,
                status: 'prescribed',
                category: 'lab',
                codeSystem: 'REGIONAL_PRESTAZIONI',
                serviceCode: `99.${p}.2`,
                serviceName: `Esame vario B ${p}`,
            },
        );
    }

    return { patients, prescriptions, items };
}

test('WUL-923: storico vuoto parte senza errori e restituisce empty_history', () => {
    const analysis = deriveRecurringServiceCandidates({
        patients: [],
        prescriptions: [],
        items: [],
    });

    assert.equal(analysis.kind, PERSONAL_SERVICE_CANDIDATE_KIND);
    assert.equal(analysis.status, 'empty_history');
    assert.equal(analysis.summary.totalPrescriptionsScanned, 0);
    assert.equal(analysis.summary.eligiblePrescriptions, 0);
    assert.equal(analysis.summary.distinctPatients, 0);
    assert.deepEqual(analysis.candidates, []);
    assert.deepEqual(analysis.insufficientCandidates, []);
});

test('WUL-923: su 50 prescrizioni sintetiche, tre prestazioni presenti insieme 30 volte danno un candidato chiuso con frequenza 30, 10 pazienti e diagnosi 5A11 associata', () => {
    const fixture = buildSynthetic50PrescriptionsFixture();
    const analysis = deriveRecurringServiceCandidates(fixture);

    assert.equal(analysis.status, 'ready');
    assert.equal(analysis.summary.totalPrescriptionsScanned, 50);
    assert.equal(analysis.summary.eligiblePrescriptions, 50);
    assert.equal(analysis.summary.distinctPatients, 15);
    assert.equal(analysis.candidates.length, 1);

    const candidate = analysis.candidates[0];
    assert.equal(candidate.kind, PERSONAL_SERVICE_CANDIDATE_KIND);
    assert.equal(candidate.prescriptionCount, 30);
    assert.equal(candidate.patientCount, 10);
    assert.equal(candidate.sufficiency, 'sufficient');
    assert.deepEqual(
        candidate.services.map((service) => service.serviceCode),
        ['90.16.3', '90.27.1', '90.28.1'],
    );
    assert.ok(candidate.primaryDiagnosis);
    assert.equal(candidate.primaryDiagnosis.code, '5A11');
    assert.equal(candidate.primaryDiagnosis.system, 'ICD-11');
    assert.equal(candidate.primaryDiagnosis.prescriptionCount, 30);
    assert.equal(candidate.primaryDiagnosis.patientCount, 10);

    const asApprovedPackage = approvedServicePackageSchema.safeParse(candidate);
    assert.equal(asApprovedPackage.success, false);
    assert.equal('periodicityMonths' in candidate, false);
    assert.equal('exemption' in candidate, false);
    assert.equal('approval' in candidate, false);
});

test('WUL-923: distingue prescrizioni ripetute sullo stesso paziente da pazienti diversi e dati insufficienti', () => {
    const patients: CandidateHistoryPatientInput[] = [
        { id: 'pat-single', diagnoses: [{ code: '5A11', system: 'ICD-11', description: 'Diabete mellito di tipo 2' }] },
        { id: 'pat-two-a', diagnoses: [{ code: 'BA00', system: 'ICD-11', description: 'Ipertensione essenziale' }] },
        { id: 'pat-two-b', diagnoses: [{ code: 'BA00', system: 'ICD-11', description: 'Ipertensione essenziale' }] },
    ];
    const prescriptions: CandidateHistoryPrescriptionInput[] = [];
    const items: CandidateHistoryPrescriptionItemInput[] = [];

    for (let i = 1; i <= 10; i += 1) {
        const prescriptionId = `rx-single-${i}`;
        prescriptions.push({ id: prescriptionId, patientId: 'pat-single', status: 'prescribed', serviceName: 'Gruppo singolo paziente' });
        items.push(
            { id: `${prescriptionId}-1`, patientId: 'pat-single', prescriptionId, status: 'prescribed', codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode: '90.28.1', serviceName: 'EMOGLOBINA GLICATA' },
            { id: `${prescriptionId}-2`, patientId: 'pat-single', prescriptionId, status: 'prescribed', codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode: '90.27.1', serviceName: 'GLUCOSIO [S/P]' },
        );
    }

    for (const [idx, patientId] of ['pat-two-a', 'pat-two-b'].entries()) {
        const prescriptionId = `rx-rare-${idx}`;
        prescriptions.push({ id: prescriptionId, patientId, status: 'prescribed', serviceName: 'Gruppo raro' });
        items.push(
            { id: `${prescriptionId}-1`, patientId, prescriptionId, status: 'prescribed', codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode: '90.37.4', serviceName: 'POTASSIO [S]' },
            { id: `${prescriptionId}-2`, patientId, prescriptionId, status: 'prescribed', codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode: '90.40.4', serviceName: 'SODIO [S]' },
        );
    }

    const analysis = deriveRecurringServiceCandidates({ patients, prescriptions, items });

    assert.equal(analysis.status, 'insufficient_data');
    assert.equal(analysis.candidates.length, 0);
    assert.equal(analysis.insufficientCandidates.length, 2);

    const singlePatientGroup = analysis.insufficientCandidates.find((c) => c.prescriptionCount === 10);
    assert.ok(singlePatientGroup);
    assert.equal(singlePatientGroup.patientCount, 1);
    assert.equal(singlePatientGroup.sufficiency, 'insufficient_patients');

    const rareGroup = analysis.insufficientCandidates.find((c) => c.prescriptionCount === 2);
    assert.ok(rareGroup);
    assert.equal(rareGroup.patientCount, 2);
    assert.equal(rareGroup.sufficiency, 'insufficient_prescriptions');
});

test('WUL-923: esclude prescrizioni annullate, pazienti eliminati e campi cifrati non decifrati', () => {
    const analysis = deriveRecurringServiceCandidates({
        patients: [
            { id: 'pat-active', diagnoses: [{ code: '5A11', system: 'ICD-11', description: 'Diabete' }] },
            { id: 'pat-deleted', deletedAt: '2026-10-01T00:00:00.000Z', diagnoses: [{ code: '5A11', system: 'ICD-11', description: 'Diabete' }] },
        ],
        prescriptions: [
            { id: 'rx-cancelled', patientId: 'pat-active', status: 'cancelled', serviceName: 'Annullata' },
            { id: 'rx-deleted', patientId: 'pat-deleted', status: 'prescribed', serviceName: 'Eliminato' },
            { id: 'rx-locked', patientId: 'pat-active', status: 'prescribed', serviceName: 'ENC:iv:ciphertext' },
        ],
        items: [
            { id: 'it-1', patientId: 'pat-active', prescriptionId: 'rx-locked', status: 'prescribed', serviceName: '[Dati Cifrati - Sblocca con PIN]' },
            { id: 'it-2', patientId: 'pat-active', prescriptionId: 'rx-locked', status: 'prescribed', serviceName: 'ENC:iv:cipher2' },
        ],
    });

    assert.equal(analysis.summary.cancelledPrescriptionsExcluded, 1);
    assert.equal(analysis.summary.totalPrescriptionsScanned, 1);
    assert.equal(analysis.summary.eligiblePrescriptions, 0);
    assert.equal(analysis.candidates.length, 0);
});

test('WUL-923: evita potenze dell’insieme senza tetto su prescrizioni con molte prestazioni', () => {
    const patients: CandidateHistoryPatientInput[] = [
        { id: 'pat-big-1', diagnoses: [{ code: '5A11', system: 'ICD-11', description: 'Diabete' }] },
        { id: 'pat-big-2', diagnoses: [{ code: '5A11', system: 'ICD-11', description: 'Diabete' }] },
    ];
    const prescriptions: CandidateHistoryPrescriptionInput[] = [];
    const items: CandidateHistoryPrescriptionItemInput[] = [];

    for (let p = 1; p <= 4; p += 1) {
        const patientId = p % 2 === 0 ? 'pat-big-2' : 'pat-big-1';
        const prescriptionId = `rx-big-${p}`;
        prescriptions.push({ id: prescriptionId, patientId, status: 'prescribed', serviceName: 'Pannello esteso' });
        for (let s = 1; s <= 24; s += 1) {
            items.push({
                id: `${prescriptionId}-s-${s}`,
                patientId,
                prescriptionId,
                status: 'prescribed',
                codeSystem: 'REGIONAL_PRESTAZIONI',
                serviceCode: `90.${String(s).padStart(2, '0')}.1`,
                serviceName: `Prestazione ${s}`,
            });
        }
    }

    const startedAt = Date.now();
    const analysis = deriveRecurringServiceCandidates({
        patients,
        prescriptions,
        items,
        thresholds: { maxServicesPerPrescription: 10, maxGroupSize: 4, maxCandidateSetsPerLevel: 80 },
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(analysis.summary.truncatedPrescriptions, 4);
    assert.ok(analysis.summary.candidatePoolCapped);
    assert.ok(elapsedMs < 2000, `Analisi troppo lenta: ${elapsedMs}ms`);
    assert.ok(analysis.candidates.every((candidate) => candidate.services.length <= 4));
});

test('WUL-923: gesti di revisione, correzione, scarto, ripristino e minimizzazione del payload persistito', () => {
    const fixture = buildSynthetic50PrescriptionsFixture();
    const analysis = deriveRecurringServiceCandidates(fixture);
    const candidate = analysis.candidates[0];
    const now = new Date('2026-11-28T15:00:00.000Z');

    let store = emptyPersonalCandidateReviewStore();
    store = keepCandidateDecision(store, candidate, now);
    const kept = findCandidateDecision(store, candidate.id);
    assert.ok(kept);
    assert.equal(kept.status, 'kept');
    assert.equal(kept.kind, PERSONAL_SERVICE_CANDIDATE_KIND);

    const invalidCorrection = correctCandidateDecision(store, candidate, {
        title: '   ',
        services: candidate.services,
        associatedDiagnosis: null,
    }, now);
    assert.equal(invalidCorrection.ok, false);

    const emptyServicesCorrection = correctCandidateDecision(store, candidate, {
        title: 'Gruppo vuoto',
        services: [],
        associatedDiagnosis: null,
    }, now);
    assert.equal(emptyServicesCorrection.ok, false);

    const correctedOutcome = correctCandidateDecision(store, candidate, {
        title: 'Controllo metabolico personale',
        services: candidate.services.slice(0, 2),
        associatedDiagnosis: {
            code: '5A11',
            system: 'ICD-11',
            description: 'Diabete mellito di tipo 2',
        },
        note: 'Bozza personale da rivedere in seguito',
    }, now);
    assert.equal(correctedOutcome.ok, true);
    store = correctedOutcome.store;
    assert.equal(correctedOutcome.decision.status, 'corrected');
    assert.equal(correctedOutcome.decision.services.length, 2);
    assert.equal(correctedOutcome.decision.title, 'Controllo metabolico personale');

    const serialized = serializePersonalCandidateReviewStore(store);
    assert.equal(serialized.includes('pat-syn-'), false);
    assert.equal(serialized.includes('rx-tri-'), false);
    assert.equal(serialized.includes('exemption'), false);
    assert.equal(serialized.includes('periodicity'), false);

    const reparsed = parsePersonalCandidateReviewStore(serialized);
    assert.equal(reparsed.schemaVersion, PERSONAL_CANDIDATE_REVIEW_SCHEMA);
    assert.equal(reparsed.decisions.length, 1);
    assert.equal(reparsed.decisions[0].title, 'Controllo metabolico personale');

    store = discardCandidateDecision(store, candidate, 'Non utile come gruppo', now);
    assert.equal(findCandidateDecision(store, candidate.id)?.status, 'discarded');

    store = restoreCandidateDecision(store, candidate.id);
    assert.equal(findCandidateDecision(store, candidate.id), null);
});
