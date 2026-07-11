import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildExemptionCopyFields,
    buildServicePrescriptionCopyFields,
    buildTherapyCopyFields,
    normalizeExemptionCodes,
    projectPrescriptiveTherapies,
    selectPrincipalDiagnoses,
    selectRecentServicePrescriptions,
} from './siss-prescriptive-context-projection';

// Fixture minime: oggetti compatibili con i tipi Dexie senza tirare dentro
// il modulo db (import solo type-level, erasabile da run-strip-types).
function therapy(id: string, overrides: Record<string, unknown> = {}): any {
    return {
        id,
        patientId: 'p1',
        drugName: `Farmaco ${id}`,
        dosage: '1 cpr/die',
        status: 'active',
        startDate: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
        ...overrides,
    };
}

function prescription(id: string, overrides: Record<string, unknown> = {}): any {
    return {
        id,
        patientId: 'p1',
        prescribedAt: new Date('2026-01-01'),
        status: 'prescribed',
        category: 'lab',
        serviceName: `Prestazione ${id}`,
        source: 'manual',
        version: 1,
        createdAt: new Date('2026-01-01'),
        ...overrides,
    };
}

test('projectPrescriptiveTherapies: solo le attive in evidenza, piu recenti prima', () => {
    const therapies = [
        therapy('a', { startDate: new Date('2026-01-01') }),
        therapy('b', { startDate: new Date('2026-06-01') }),
        therapy('c', { status: 'suspended' }),
        therapy('d', { status: 'completed' }),
    ];
    const result = projectPrescriptiveTherapies(therapies);
    assert.deepEqual(result.active.map((t) => t.id), ['b', 'a']);
    assert.equal(result.inactiveCount, 2);
});

test('projectPrescriptiveTherapies: esclude le terapie cancellate dal conteggio e dall\'elenco', () => {
    const therapies = [
        therapy('a'),
        therapy('b', { deletedAt: new Date('2026-02-01') }),
    ];
    const result = projectPrescriptiveTherapies(therapies);
    assert.deepEqual(result.active.map((t) => t.id), ['a']);
    assert.equal(result.inactiveCount, 0);
});

test('projectPrescriptiveTherapies: degrada a vuoto per input non array', () => {
    assert.deepEqual(projectPrescriptiveTherapies(undefined), { active: [], inactiveCount: 0 });
    assert.deepEqual(projectPrescriptiveTherapies(null), { active: [], inactiveCount: 0 });
});

test('selectRecentServicePrescriptions: ordina per data di prescrizione decrescente', () => {
    const prescriptions = [
        prescription('a', { prescribedAt: new Date('2026-01-01') }),
        prescription('b', { prescribedAt: new Date('2026-06-01') }),
        prescription('c', { prescribedAt: new Date('2026-03-01') }),
    ];
    const result = selectRecentServicePrescriptions(prescriptions);
    assert.deepEqual(result.map((p) => p.id), ['b', 'c', 'a']);
});

test('selectRecentServicePrescriptions: usa createdAt se manca prescribedAt, rispetta max', () => {
    const prescriptions = [
        prescription('a', { prescribedAt: undefined, createdAt: new Date('2026-01-01') }),
        prescription('b', { prescribedAt: undefined, createdAt: new Date('2026-06-01') }),
        prescription('c', { prescribedAt: undefined, createdAt: new Date('2026-03-01') }),
    ];
    const result = selectRecentServicePrescriptions(prescriptions, { max: 2 });
    assert.deepEqual(result.map((p) => p.id), ['b', 'c']);
});

test('selectPrincipalDiagnoses: riusa il parser dei record datati, piu recenti prima, limitate a max', () => {
    const raw = JSON.stringify([
        { code: 'E11', description: 'Diabete', system: 'ICD-10', date: '2026-01-01' },
        { code: 'I10', description: 'Ipertensione', system: 'ICD-10', date: '2026-06-01' },
    ]);
    const result = selectPrincipalDiagnoses(raw, { max: 1 });
    assert.equal(result.length, 1);
    assert.equal(result[0].code, 'I10');
});

test('selectPrincipalDiagnoses: input assente o malformato torna vuoto', () => {
    assert.deepEqual(selectPrincipalDiagnoses(undefined), []);
    assert.deepEqual(selectPrincipalDiagnoses('{"broken"'), []);
});

test('normalizeExemptionCodes: trim, maiuscolo, dedup, non vuoti', () => {
    assert.deepEqual(
        normalizeExemptionCodes([' e01 ', 'E01', 'C02', '', '  ', 42, null]),
        ['E01', 'C02'],
    );
});

test('normalizeExemptionCodes: input non array torna vuoto', () => {
    assert.deepEqual(normalizeExemptionCodes(undefined), []);
    assert.deepEqual(normalizeExemptionCodes(null), []);
});

test('buildTherapyCopyFields: include farmaco e AIC solo se presenti', () => {
    const withAic = buildTherapyCopyFields(therapy('a', { aic: '123456789' }));
    assert.deepEqual(withAic.map((f) => f.label), ['Farmaco', 'AIC']);

    const withoutAic = buildTherapyCopyFields(therapy('b', { aic: undefined }));
    assert.deepEqual(withoutAic.map((f) => f.label), ['Farmaco']);

    const blankName = buildTherapyCopyFields(therapy('c', { drugName: '   ', aic: undefined }));
    assert.deepEqual(blankName, []);
});

test('buildServicePrescriptionCopyFields: descrizione prestazione se presente', () => {
    const withName = buildServicePrescriptionCopyFields(prescription('a'));
    assert.deepEqual(withName.map((f) => f.label), ['Prestazione']);

    const blank = buildServicePrescriptionCopyFields(prescription('b', { serviceName: '  ' }));
    assert.deepEqual(blank, []);
});

test('buildExemptionCopyFields: codice copiabile, vuoto torna array vuoto', () => {
    assert.deepEqual(buildExemptionCopyFields('E01'), [{ key: 'exemption:E01', label: 'Esenzione', value: 'E01' }]);
    assert.deepEqual(buildExemptionCopyFields('   '), []);
});
