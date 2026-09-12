void import.meta.url; // @Codex: explicit ESM for top-level mock setup.
/* @Codex — synthetic content, mock local NER only; no authority or runtime proof. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockOrdinaryModule } from './ordinary-module.test-support.ts';
import { createHash } from 'node:crypto';
import { createPatientInsightOrdinaryTaskProfile, createSmartImportOrdinaryTaskProfile, createDocumentSynthesisOrdinaryTaskProfile,
    createTreatmentReasoningOrdinaryTaskProfile, readOrdinaryTaskProfile } from './ordinary-task-profile';
import { captureDocumentSynthesisSourceSet } from '../ai-providers/fabric/document-synthesis-source-set-contract';
import { renderEmissionPlan } from './ordinary-emission-plan';
import { buildPatientInsightExtractionPrompt } from '../ai-task-contracts';
import { buildPatientSmartImportCapabilityPrompt } from '../domain/documents/patient-smart-import-capability-contract';
import { buildChatGptTreatmentReasoningPrompt, buildTreatmentReasoningPrompt, type TreatmentReasoningPromptInput } from '../treatment-reasoning-contract';
import { buildDocumentSynthesisMultiSourcePrompt } from '../ai-providers/fabric/document-synthesis-multi-source-prompt';

let calls: string[] = [], closes = 0;
let detection = 'Bea Riva';
let behavior: 'normal' | 'cross' | 'surrogate' | 'fail' | 'late' | 'dense' | 'close-fail' = 'normal';
let release: (() => void) | undefined;
mockOrdinaryModule(import.meta.url, '../gliner-redaction-runner', { namedExports: { createGlinerRedactionRunner: () => ({
    async extract(text: string) {
        calls.push(text);
        if (behavior === 'fail') throw new Error('private diagnostics must not leak');
        if (behavior === 'late') await new Promise<void>(resolve => { release = resolve; });
        if (behavior === 'dense') return Array.from(text.matchAll(/PERSON\d{5}/gu), match => ({ type: 'person', start: match.index, end: match.index + match[0].length, text: match[0], confidence: 1 }));
        if (behavior === 'cross') return [{ type: 'person', start: 0, end: text.length, text, confidence: 1 }];
        if (behavior === 'surrogate') { const start = text.indexOf('😀'); return [{ type: 'person', start, end: start + 1, text: text.slice(start, start + 1), confidence: 1 }]; }
        return Array.from(text.matchAll(new RegExp(detection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu')),
            match => ({ type: 'person', start: match.index, end: match.index + match[0].length, text: match[0], confidence: 1 }));
    }, async close() { closes++; if (behavior === 'close-fail') throw new Error('private runner close diagnostic'); },
}) } });
const { createOrdinaryPreparation, readPreparedOrdinaryProfile, isPreparedOrdinaryProfileCurrent } = await import('./ordinary-preparation');
const configuration = { pythonExecutable: '/synthetic/python', workerPath: '/synthetic/worker', modelDirectory: '/synthetic/model' };
const PI = { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'Bea Riva in controllo', activeConditions: ['Condizione di Bea Riva'], currentTherapies: [], recentClinicalEvents: [] } as const;
const SI = { schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import', patientRef: 'patient_synthetic', selectionEpoch: 1, patientRevision: 1, sourceRevision: 1, capturedAt: '2026-09-12T10:00:00.000Z', currentDiagnoses: [], currentActiveTherapies: [], therapyCandidateHints: [], sources: [{ id: 'source_synthetic', kind: 'clinical-entry', label: 'Bea Riva', date: '2026-09-12T10:00:00.000Z', content: 'Bea Riva in controllo' }] } as const;
const TR: TreatmentReasoningPromptInput = { question: 'Bea Riva?', patientContext: 'Bea Riva in controllo', diagnoses: ['Ipertensione'], sources: [{ id: 'source_synthetic', sourceKind: 'clinical-entry', label: 'Bea Riva', excerpt: 'Bea Riva in controllo', date: '12/09/2026' }] };
function sourceSet(text = 'Bea Riva in controllo.', count = 1) {
    const result = captureDocumentSynthesisSourceSet({ sources: Array.from({ length: count }, (_, index) => ({ documentSourceRef: `doc-synthetic-${index}`, documentRevision: BigInt(1), documentFreshnessEpoch: BigInt(1), sourceText: text })), sourceSetEpoch: BigInt(1), revocationGeneration: BigInt(1) });
    assert.equal(result.status, 'available'); return result.sourceSet;
}
function outputs() {
    return [
        { schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight', summary: 'Bea Riva [S1]', data: { currentState: ['Bea Riva [S1]'], alerts: [], nextSteps: [], gaps: [] } },
        { schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import', summary: 'Bea Riva', data: { diagnoses: [{ label: 'Ipertensione', icdQuery: 'Hypertension', confidence: 'high', evidence: 'Bea Riva in controllo', sourceId: 'source_synthetic' }], therapies: [], servicePrescriptions: [] } },
        { schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2', output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Bea Riva', data: { qualityLevel: 'yellow', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } }, citations: [{ label: 'S1', quote: 'Bea Riva in controllo.' }], claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S1'] }] },
        { schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning', summary: 'Bea Riva', data: { recommendation: 'Bea Riva in controllo', keyEvidence: [], reasoning: [], caveats: [], safetyFlags: [], suggestedActions: [], trace: { mode: 'chatgpt_subscription', toolsUsed: [], limitations: [] } }, sourceBindings: [{ claimPath: 'summary', claim: 'Bea Riva', evidenceRefs: ['source_synthetic'] }, { claimPath: 'data.recommendation', claim: 'Bea Riva in controllo', evidenceRefs: ['source_synthetic'] }] },
    ];
}
function profiles() { return [createPatientInsightOrdinaryTaskProfile(PI), createSmartImportOrdinaryTaskProfile({ projection: SI, generatedAt: SI.capturedAt }), createDocumentSynthesisOrdinaryTaskProfile(sourceSet()), createTreatmentReasoningOrdinaryTaskProfile(TR)]; }
const tokenFrom = (text: string) => { const token = text.match(/\{\{MF_PII_[a-f0-9]{32}_\d+\}\}/u)?.[0]; assert.ok(token); return token; };
function reset() { calls = []; closes = 0; detection = 'Bea Riva'; behavior = 'normal'; release = undefined; }

test('four named builders emit exactly their canonical prompt bytes and classify dynamic fields', () => {
    const ds = sourceSet();
    const pairs = [
        [createPatientInsightOrdinaryTaskProfile(PI), buildPatientInsightExtractionPrompt('[S1] Bea Riva in controllo\n[S2] Condizione attiva: Condizione di Bea Riva')],
        [createSmartImportOrdinaryTaskProfile({ projection: SI, generatedAt: SI.capturedAt }), buildPatientSmartImportCapabilityPrompt(SI)],
        [createDocumentSynthesisOrdinaryTaskProfile(ds), buildDocumentSynthesisMultiSourcePrompt(ds).prompt],
        [createTreatmentReasoningOrdinaryTaskProfile(TR), buildChatGptTreatmentReasoningPrompt(TR)],
    ] as const;
    for (const [profile, prompt] of pairs) {
        const read = readOrdinaryTaskProfile(profile);
        assert.equal(read.prompt, prompt); assert.equal(renderEmissionPlan(read.emissionPlan), prompt);
    }
    const plan = readOrdinaryTaskProfile(pairs[1][0]).emissionPlan;
    assert.ok(plan.some(value => typeof value !== 'string' && value.kind === 'data' && value.value === SI.sources[0].date));
    assert.ok(!plan.some(value => typeof value !== 'string' && value.kind === 'data' && value.value === SI.sources[0].id));
    assert.match(buildTreatmentReasoningPrompt(TR), /lane locale/u);
    assert.doesNotMatch(buildChatGptTreatmentReasoningPrompt(TR), /lane locale/u);
});

test('four roundtrips retain complete canonical output and original DS citations', async () => {
    reset();
    const ps = profiles(), expected = outputs();
    for (let index = 0; index < ps.length; index++) {
        const job = createOrdinaryPreparation(ps[index], configuration);
        try {
            const handle = await job.ready, read = readPreparedOrdinaryProfile(handle);
            const token = tokenFrom(read.content.input[0].text);
            assert.ok(!read.content.input[0].text.includes('Bea Riva'));
            const wire = JSON.stringify(expected[index]).replaceAll('Bea Riva', token);
            assert.deepEqual(read.parseOutput(wire), readOrdinaryTaskProfile(ps[index]).parseOutput(JSON.stringify(expected[index])));
            assert.equal(createHash('sha256').update(read.payload, 'utf8').digest('hex'), read.payloadSha256);
            assert.equal(JSON.stringify(read.content), read.payload);
            assert.equal(Buffer.byteLength(read.payload, 'utf8'), read.payloadBytes);
            assert.ok(Object.isFrozen(read.content.input));
            assert.equal(isPreparedOrdinaryProfileCurrent(handle), true);
        } finally { await job.close(); }
    }
});

test('DS 32 complete 12000 UTF16 units fit 32 batches, bytes computed on redacted JSON text', async () => {
    reset(); const text = 'Bea Riva ' + 'a'.repeat(11_991); assert.equal(text.length, 12_000);
    const job = createOrdinaryPreparation(createDocumentSynthesisOrdinaryTaskProfile(sourceSet(text, 32)), configuration);
    try {
        const read = readPreparedOrdinaryProfile(await job.ready);
        assert.equal(calls.length, 32); assert.ok(calls.every(value => value.length === 12_000));
        for (const match of read.content.input[0].text.matchAll(/SOURCE S\d+ UTF8_BYTES (\d+) JSON_TEXT (.+)/gu)) {
            assert.equal(Number(match[1]), Buffer.byteLength(JSON.parse(match[2]), 'utf8'));
        }
    } finally { await job.close(); }
});

test('literal escaping, emoji, quotes, backslashes and newlines restore exact DS source', async () => {
    reset(); detection = 'Bea "Riva" \\ 😀';
    const text = `${detection}\nseconda riga.`;
    const profile = createDocumentSynthesisOrdinaryTaskProfile(sourceSet(text));
    const job = createOrdinaryPreparation(profile, configuration);
    try {
        const read = readPreparedOrdinaryProfile(await job.ready), token = tokenFrom(read.content.input[0].text);
        const output = outputs()[2]; assert.ok(output.citations); output.citations[0].quote = text;
        const expected = JSON.stringify(output);
        output.citations[0].quote = text.replace(detection, token);
        assert.deepEqual(read.parseOutput(JSON.stringify(output)), readOrdinaryTaskProfile(profile).parseOutput(expected));
    } finally { await job.close(); }
});

for (const bad of ['duplicate', 'escaped-duplicate', 'nonfinite', 'trailing', 'incomplete', 'surrogate']) test(`lexical denial precedes rehydration: ${bad}`, async () => {
    reset(); const job = createOrdinaryPreparation(profiles()[0], configuration);
    try {
        const read = readPreparedOrdinaryProfile(await job.ready), token = tokenFrom(read.content.input[0].text);
        let wire = JSON.stringify(outputs()[0]).replaceAll('Bea Riva', token);
        if (bad === 'duplicate') wire = wire.replace('"summary":', '"summary":"discarded","summary":');
        if (bad === 'escaped-duplicate') wire = wire.replace('"summary":', '"summary":"discarded","summ\\u0061ry":');
        if (bad === 'nonfinite') wire = wire.replace('"summary":', '"number":1e999,"summary":');
        if (bad === 'trailing') wire += '{}';
        if (bad === 'incomplete') wire = wire.slice(0, -1);
        if (bad === 'surrogate') wire = wire.replace('[S1]', '\\ud800');
        assert.throws(() => read.parseOutput(wire));
    } finally { await job.close(); }
});

for (const bad of ['foreign', 'truncated', 'unknown', 'key', 'sourceId', 'claimPath', 'mode']) test(`tokens cannot cross isolation/structural boundaries: ${bad}`, async () => {
    reset(); const profile = profiles()[bad === 'sourceId' ? 1 : ['claimPath', 'mode'].includes(bad) ? 3 : 0];
    const one = createOrdinaryPreparation(profile, configuration), two = createOrdinaryPreparation(profile, configuration);
    try {
        const a = readPreparedOrdinaryProfile(await one.ready), b = readPreparedOrdinaryProfile(await two.ready);
        const token = tokenFrom(a.content.input[0].text), other = tokenFrom(b.content.input[0].text);
        let wire = JSON.stringify(outputs()[bad === 'sourceId' ? 1 : ['claimPath','mode'].includes(bad) ? 3 : 0]).replaceAll('Bea Riva', token);
        if (bad === 'foreign') wire = wire.replaceAll(token, other);
        if (bad === 'truncated') wire = wire.replaceAll(token, token.slice(0, -1));
        if (bad === 'unknown') wire = wire.replaceAll(token, token.replace(/_\d+\}\}$/u, '_4096}}'));
        if (bad === 'key') wire = wire.replace('"summary":', `"${token}":`);
        if (bad === 'sourceId') wire = wire.replace('"source_synthetic"', JSON.stringify(token));
        if (bad === 'claimPath') wire = wire.replace('"claimPath":"summary"', `"claimPath":"${token}"`);
        if (bad === 'mode') wire = wire.replace('"chatgpt_subscription"', JSON.stringify(token));
        assert.throws(() => a.parseOutput(wire));
    } finally { await one.close(); await two.close(); }
});

for (const mode of ['cross', 'surrogate', 'fail'] as const) test(`invalid local runner result fails closed and closes: ${mode}`, async () => {
    reset(); behavior = mode;
    const job = createOrdinaryPreparation(createPatientInsightOrdinaryTaskProfile({ ...PI, clinicalFocus: 'Bea Riva 😀' }), configuration);
    await assert.rejects(job.ready, /ordinary_preparation_invalid/u);
    assert.ok(closes >= 1); await job.close();
});

test('abort while neural work is pending rejects late completion and closes all state', async () => {
    reset(); behavior = 'late'; const controller = new AbortController();
    const job = createOrdinaryPreparation(profiles()[0], configuration, controller.signal);
    await new Promise(resolve => setImmediate(resolve)); assert.ok(release);
    controller.abort(); release!();
    await assert.rejects(job.ready); await job.close(); assert.ok(closes >= 1);
});

test('closed preparation rejects cached decoder and forged handles, even after successful decode', async () => {
    reset(); const job = createOrdinaryPreparation(profiles()[0], configuration);
    const handle = await job.ready, read = readPreparedOrdinaryProfile(handle);
    const wire = JSON.stringify(outputs()[0]).replaceAll('Bea Riva', tokenFrom(read.content.input[0].text));
    read.parseOutput(wire); await job.close();
    assert.equal(isPreparedOrdinaryProfileCurrent(handle), false);
    for (const value of [handle, {}, new Proxy(handle, {})]) assert.throws(() => readPreparedOrdinaryProfile(value));
    assert.throws(() => read.parseOutput(wire));
});

test('schema expansion derives from emitted tokens and canonical limits are still enforced', async () => {
    reset(); const job = createOrdinaryPreparation(profiles()[0], configuration);
    try {
        const read = readPreparedOrdinaryProfile(await job.ready), token = tokenFrom(read.content.input[0].text);
        const schema = read.content.outputSchema as { properties: { summary: {maxLength:number}; task: {const:string} } };
        assert.equal(schema.properties.summary.maxLength, Math.ceil(220 * token.length / 'Bea Riva'.length));
        assert.equal(schema.properties.task.const, 'patient_insight');
        const out = outputs()[0]; out.summary = Array(30).fill(token).join(' ') + ' [S1]';
        assert.throws(() => read.parseOutput(JSON.stringify(out)));
    } finally { await job.close(); }
});

test('DS altered quotation or source label is not repaired by rehydration', async () => {
    reset(); const job = createOrdinaryPreparation(profiles()[2], configuration);
    try {
        const read = readPreparedOrdinaryProfile(await job.ready), token = tokenFrom(read.content.input[0].text);
        const base = JSON.stringify(outputs()[2]).replaceAll('Bea Riva', token);
        assert.throws(() => read.parseOutput(base.replace('in controllo.', 'in controllo diverso.')));
        assert.throws(() => read.parseOutput(base.replace('"label":"S1"', '"label":"S2"')));
    } finally { await job.close(); }
});

test('deterministic Layer1 crossing unit boundaries is rejected as well', async () => {
    reset(); detection = 'no-match';
    const job = createOrdinaryPreparation(profiles()[0], configuration, undefined, { names: ['Bea Riva in controllo\n␞\nCondizione di Bea Riva'] });
    await assert.rejects(job.ready); await job.close();
});


test('4096 distinct values across all emitted batches succeed; value 4097 denies without reset', async () => {
    const dataset = (count: number) => {
        const sources = Array.from({ length: count }, (_, index) => ({ documentSourceRef: `doc-budget-${index}`, documentRevision: BigInt(1), documentFreshnessEpoch: BigInt(1),
            sourceText: Array.from({ length: index === 8 ? 1 : 512 }, (_, n) => `PERSON${String(index * 512 + n).padStart(5, '0')}`).join(' ').padEnd(12_000, 'x') }));
        const result = captureDocumentSynthesisSourceSet({ sources, sourceSetEpoch: BigInt(1), revocationGeneration: BigInt(1) });
        assert.equal(result.status, 'available'); return createDocumentSynthesisOrdinaryTaskProfile(result.sourceSet);
    };
    reset(); behavior = 'dense';
    const accepted = createOrdinaryPreparation(dataset(8), configuration);
    try {
        const read = readPreparedOrdinaryProfile(await accepted.ready);
        assert.equal(read.entityCounts.person, 4096); assert.equal(calls.length, 8);
        assert.ok(read.payloadBytes < 2_000_000); // fixture observation, NOT a new runtime budget
    } finally { await accepted.close(); }
    const denied = createOrdinaryPreparation(dataset(9), configuration);
    await assert.rejects(denied.ready, /ordinary_preparation_invalid/); await denied.close(); reset();
});

test('unchanged session permits 64 preparations and rejects the 65th; no budget reset', async () => {
    const { createRedactionSession } = await import('../ai-redaction-session');
    const session = createRedactionSession();
    try {
        for (let i = 0; i < 64; i++) session.prepare({ text: 'Bounded synthetic text', entities: [] });
        assert.throws(() => session.prepare({ text: '65th', entities: [] }), /budget/);
    } finally { session.close(); }
});

test('malformed/lowercase tokens and aggregate output overflow are denied, not repaired', async () => {
    reset(); const job = createOrdinaryPreparation(profiles()[0], configuration);
    try {
        const read = readPreparedOrdinaryProfile(await job.ready), token = tokenFrom(read.content.input[0].text);
        const base = JSON.stringify(outputs()[0]).replaceAll('Bea Riva', token);
        for (const bad of [token.toLowerCase(), token.replace('MF_PII_', 'MF_PII_!'), '{{MF_PII_broken}}']) assert.throws(() => read.parseOutput(base.replaceAll(token, bad)));
        assert.throws(() => read.parseOutput(JSON.stringify({text: 'x'.repeat(262_145)})));
    } finally { await job.close(); }
});

test('runner cleanup failure never yields a usable preparation and is sanitized', async () => {
    reset(); behavior = 'close-fail';
    const job = createOrdinaryPreparation(profiles()[0], configuration);
    await assert.rejects(job.ready, error => (error as Error).message === 'ordinary_preparation_invalid');
    await assert.rejects(job.close(), error => (error as Error).message === 'ordinary_cleanup_unconfirmed'); reset();
});

test('abort already signalled never invokes the neural extractor or issues a preparation', async () => {
    reset(); const controller = new AbortController(); controller.abort();
    const job = createOrdinaryPreparation(profiles()[0], configuration, controller.signal);
    await assert.rejects(job.ready); await job.close(); assert.equal(calls.length, 0);
});
