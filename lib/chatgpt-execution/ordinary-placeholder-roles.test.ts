void import.meta.url;
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mockOrdinaryModule } from './ordinary-module.test-support.ts';
import { createSmartImportOrdinaryTaskProfile } from './ordinary-task-profile';

const NEURAL: readonly (readonly [string, 'person' | 'organization'])[] = [['Bea Riva', 'person'], ['Ugo Lenti', 'person'], ['Ospedale Demo', 'organization']];
mockOrdinaryModule(import.meta.url, '../gliner-redaction-runner', { namedExports: {
    readGlinerRuntimeObservation: () => null,
    createGlinerRedactionRunner: () => ({
        async extract(text: string) {
            return NEURAL.flatMap(([value, type]) => [...text.matchAll(new RegExp(value, 'gu'))]
                .map(match => ({ type, start: match.index, end: match.index + value.length, text: value, confidence: 1 })));
        },
        async close() {},
    }),
} });
const { createOrdinaryPreparation, readPreparedOrdinaryProfile } = await import('./ordinary-preparation');
const { createRedactionSession } = await import('../ai-redaction-session');

const configuration = { pythonExecutable: '/synthetic/python', workerPath: '/synthetic/worker', modelDirectory: '/synthetic/model' };
const known = { names: ['Ada Sintetica'], birthDates: ['17/04/1972'] };
const SENTINEL = 'Ada Sintetica, CF RSSMRA80A01H501U, nata il 17/04/1972, tel. 347 123 4567, ada.sintetica@example.invalid, indirizzo: Via Fittizia 3. '
    + 'Accompagnata dalla figlia Bea Riva. Visita del 12/03/2026 presso Ospedale Demo con Ugo Lenti; ecografia prescritta il 02/03/2026. Ada Sintetica riferisce dolore.';
const IDENTITIES = ['Ada Sintetica', 'RSSMRA80A01H501U', '17/04/1972', '347 123 4567', 'ada.sintetica@example.invalid', 'Via Fittizia', 'Bea Riva', 'Ugo Lenti', 'Ospedale Demo', '12/03/2026', '02/03/2026'];

function projection(content = SENTINEL) {
    return { schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import', patientRef: 'patient_synthetic', selectionEpoch: 1, patientRevision: 1, sourceRevision: 1,
        capturedAt: '2026-09-12T10:00:00.000Z', currentDiagnoses: [], currentActiveTherapies: [], therapyCandidateHints: [],
        sources: [{ id: 'source_synthetic', kind: 'clinical-entry', label: 'Referto sintetico', date: '2026-09-12T10:00:00.000Z', content }] } as const;
}
const profile = (content?: string) => { const value = projection(content); return createSmartImportOrdinaryTaskProfile({ projection: value, generatedAt: value.capturedAt }); };
function token(payload: string, before: string, role: string): string {
    const found = payload.match(new RegExp(`${before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\[\\[MF_${role}[1-9][0-9]*_[a-z2-7]{8}\\]\\])`, 'u'))?.[1];
    assert.ok(found, `${role} after ${before}`);
    return found;
}
function output(prescribedAt: string, summary = 'Sintesi sintetica', extra: Record<string, unknown> = {}) {
    return JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import', summary, data: { diagnoses: [], therapies: [],
        servicePrescriptions: [{ serviceName: 'Ecografia addome', confidence: 'high', evidence: 'ecografia prescritta', sourceId: 'source_synthetic', prescribedAt, ...extra }] } });
}
async function prepared(content?: string) {
    const job = createOrdinaryPreparation(profile(content), configuration, undefined, known);
    return { job, read: readPreparedOrdinaryProfile(await job.ready) };
}

test('I1 and I2: exact payload bytes carry no identity and every placeholder names its role', async () => {
    const { job, read } = await prepared();
    try {
        for (const value of IDENTITIES) assert.ok(!read.payload.includes(value), value);
        const patient = token(read.payload, '', 'PAZ');
        assert.equal(read.payload.split(patient).length - 1, 2);
        const relative = token(read.payload, 'dalla figlia ', 'PER');
        const doctor = token(read.payload, 'con ', 'PER');
        assert.notEqual(relative, doctor);
        assert.notEqual(relative.replace(/_[a-z2-7]{8}\]\]$/u, ''), patient.replace(/_[a-z2-7]{8}\]\]$/u, ''));
        token(read.payload, 'CF ', 'CF');
        token(read.payload, 'tel. ', 'TEL');
        token(read.payload, ', ', 'EML');
        token(read.payload, 'indirizzo: ', 'IND');
        token(read.payload, 'presso ', 'ORG');
        const nonces = new Set([...read.payload.matchAll(/\[\[MF_[A-Z]+[0-9+-]+_([a-z2-7]{8})\]\]/gu)].map(match => match[1]));
        assert.equal(nonces.size, 1);
        assert.ok(!/\{\{|MF_PII/u.test(read.payload));
    } finally { await job.close(); }
});

test('I3: live preparations never share a nonce, even when the random source repeats', async () => {
    const randomBytes = mock.method(crypto, 'randomBytes', () => Buffer.alloc(16, 0x42));
    syncBuiltinESMExports();
    try {
        const first = await prepared(), second = await prepared();
        try {
            const mine = token(first.read.payload, 'dalla figlia ', 'PER');
            const theirs = token(second.read.payload, 'dalla figlia ', 'PER');
            assert.notEqual(mine, theirs);
            assert.equal(mine.replace(/_[a-z2-7]{8}\]\]$/u, ''), theirs.replace(/_[a-z2-7]{8}\]\]$/u, ''));
            assert.equal(first.read.parseOutput(output('marzo', `Accompagnata da ${mine}`)).summary, 'Accompagnata da Bea Riva');
            assert.throws(() => first.read.parseOutput(output('marzo', `Accompagnata da ${theirs}`)));
            assert.throws(() => second.read.parseOutput(output('marzo', `Accompagnata da ${mine}`)));
        } finally { await first.job.close(); await second.job.close(); }
        const one = createRedactionSession(), two = createRedactionSession();
        try {
            const ada = one.prepare({ text: 'Ada', entities: [{ type: 'person', start: 0, end: 3, text: 'Ada', confidence: 1 }] });
            const bea = two.prepare({ text: 'Bea', entities: [{ type: 'person', start: 0, end: 3, text: 'Bea', confidence: 1 }] });
            assert.notEqual(ada.redactedText, bea.redactedText);
            assert.equal(one.resolve(ada.redactedText).value, 'Ada');
            assert.throws(() => two.resolve(ada.redactedText));
            assert.equal(bea.rehydrate(ada.redactedText), ada.redactedText);
        } finally { one.close(); two.close(); }
    } finally { randomBytes.mock.restore(); syncBuiltinESMExports(); }
});

test('I4: the reserved placeholder form is refused before preparation, ordinary MF_ text is not', async () => {
    for (const forged of ['[[MF_PER1_abcdefgh]]', 'paziente [[ mf_paz1_abcdefgh]]', 'valore MF_PAZ 1 alterato', 'scostamento MF_GG+12', 'testo [[MF_qualunque']) {
        assert.throws(() => createOrdinaryPreparation(profile(`${SENTINEL} ${forged}`), configuration, undefined, known), forged);
    }
    for (const legitimate of ['Allegato Referto_MF_2024.pdf', 'sigla MF_ nel referto', 'micofenolato MMF_dose 500 mg', 'campione MF_A2']) {
        const { job } = await prepared(`${SENTINEL} ${legitimate}`);
        await job.close();
    }
});

test('I5: a role outside the field contract, a forged or a keyed placeholder rejects the whole response', async () => {
    const { job, read } = await prepared();
    try {
        const patient = token(read.payload, '', 'PAZ');
        const relative = token(read.payload, 'dalla figlia ', 'PER');
        const date = token(read.payload, 'ecografia prescritta il ', 'DAT');
        const fiscal = token(read.payload, 'CF ', 'CF');
        const accepted = read.parseOutput(output(date, `${patient} con ${relative}`));
        assert.equal(accepted.summary, 'Ada Sintetica con Bea Riva');
        assert.equal((accepted as unknown as { servicePrescriptions: { prescribedAt?: string }[] }).servicePrescriptions[0].prescribedAt, '02/03/2026');
        for (const wire of [
            output(patient), output(`il ${relative}`), output(date, 'Sintesi', { requestReference: fiscal }),
            output(date, `${patient.replace(/PAZ1/u, 'PAZ9')}`), output(date, patient.replace(/_[a-z2-7]{8}\]\]$/u, '_aaaaaaaa]]')),
            output(date, patient.replace('[[', '[')), output(date).replace('"summary":', `"${patient}":`),
        ]) assert.throws(() => read.parseOutput(wire), wire);
    } finally { await job.close(); }
});
