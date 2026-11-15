import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { validateGenerativeJson } from '../generative-json-validation';
import { claimFidelityFinding } from './patient-insight-fidelity';

const observed = 'Cefalea lieve riferita in episodi recenti con intensità variabile tra 1/10 e 3/10 (Sx). Terapia sintomatica sospesa con necessità di rivalutazione clinica da concordare (Sx). Nessun segno neurologico focale riferito (Sx). [DATI-INCOMPLETI]';
const envelope = (claim: string) => ({ schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight',
    summary: 'Cefalea lieve riferita [S1]', data: { currentState: [claim], alerts: [], nextSteps: [], gaps: [] } });
const validate = (value: unknown) => validateGenerativeJson('patient_insight', JSON.stringify(value));
const diagnosis = () => JSON.parse(fs.readFileSync(new URL('../../../docs/quality/intelligence/2026-11-14-ollama/rejections.json', import.meta.url), 'utf8'));

test('real rejected Patient Insight field exceeds the transmitted string limit, with a valid short control', () => {
    assert.equal(observed.length, 239);
    const operation = diagnosis().operations.find((r: { case: string }) => r.case === 'load-100-30-10/cold/11');
    assert.equal(operation.responses.at(-1).contentSha256, '1f66ea27cbfbeff2d1d14a7846d8bcd7df2c45bdc5b511f219d81d3b8dcf8920');
    const finding = operation.responses.at(-1).findings.find((f: { path?: unknown[] }) => JSON.stringify(f.path) === JSON.stringify(['data', 'currentState', 0]));
    assert.equal(finding.actualLength, observed.length);
    assert.equal(finding.fieldSha256, createHash('sha256').update(observed).digest('hex'));
    assert.throws(() => validate(envelope(observed)), (error: unknown) => {
        const issues = (error as { issues?: { code: string; path: unknown[]; maximum?: number }[] }).issues;
        return Array.isArray(issues) && issues.some(issue => issue.code === 'too_big' && issue.maximum === 220
            && JSON.stringify(issue.path) === JSON.stringify(['data', 'currentState', 0]));
    });
    assert.doesNotThrow(() => validate(envelope('Cefalea lieve; terapia sospesa, rivalutazione da concordare [S1]')));
});

test('schema citation matching distinguishes a literal placeholder from its coexistence with a valid incomplete-data marker', () => {
    const missing = envelope('Cefalea lieve riferita [Sx]');
    assert.throws(() => validate(missing));
    assert.doesNotThrow(() => validate(envelope('Cefalea lieve riferita [Sx]. [DATI-INCOMPLETI]')));
});

test('real fragile-case rejection applies the urgency marker also inside a conditional information gap', () => {
    const claim = "Mancanza di valutazione clinica completa per determinare se l'aumento di peso richiede modifica terapeutica immediata [S30].";
    const source = 'Evento clinico recente: Contatto breve 11: Scompenso: peso salito di 1 kg in una settimana, senza dispnea a riposo. Da rivalutare clinicamente, nessun aumento diuretico gia deciso.';
    const operation = diagnosis().operations.find((r: { case: string }) => r.case === 'fragile-realistic/cold/5');
    assert.equal(operation.code, 'proposal_unfaithful');
    assert.ok(operation.responses.at(-1).findings.some((f: { rule: string; claim?: string }) => f.rule === 'fidelity_urgency' && f.claim === claim));
    assert.deepEqual(claimFidelityFinding(claim, [source]), { rule: 'urgency', claimMarker: 'immediata', sourceMarker: null });
    assert.equal(claimFidelityFinding(claim.replace('modifica terapeutica immediata', 'modifica terapeutica'), [source]), null);
});
