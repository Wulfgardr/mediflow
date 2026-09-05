// @Codex MF085-002/003: production scoring and write seam; synthetic shared vectors only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { SCALES, LEGACY_TINETTI } from './scale-definitions.ts';
import { calculateScaleResult, ScaleValidationError, withValidatedScoring, type ScaleAnswers, type ScaleInstrumentProvenance } from './scale-validation.ts';
import { prepareScaleSubmission, submitScale } from './scale-submission.ts';
import { isSourceBoundTinetti, scaleHistoryNotice, LEGACY_TINETTI_NOTICE, SOURCE_BOUND_TINETTI_NOTICE } from './scale-history.ts';

interface Vectors {
    scaleId: string;
    instrument: ScaleInstrumentProvenance;
    nonclassification: string;
    components: { id: string; section: string; values: number[]; text: string; labels: string[] }[];
    sectionMaxima: Record<string, number>;
    totalMaximum: number;
    valid: { name: string; answers: Record<string, number>; score: number }[];
    invalid: { name: string; answers: Record<string, number> }[];
    legacy: Record<string, unknown> & { answers: Record<string, number> };
}
const vectors = JSON.parse(readFileSync(join(process.cwd(), 'scripts/fixtures/clinical-scales-v1.json'), 'utf8')) as Vectors;
const poma = SCALES[vectors.scaleId];
const zero = Object.fromEntries(poma.questions.map(question => [question.id, 0]));

async function assertNoWrite(scaleId: string, answers: unknown): Promise<void> {
    let writes = 0;
    await assert.rejects(submitScale(scaleId, answers, () => { writes++; }), ScaleValidationError);
    assert.equal(writes, 0, 'Invalid form answers must never reach the clinical write callback');
}

test('POMA source domains, maxima, new IDs and active library match the shared contract', () => {
    assert.deepEqual(Object.keys(SCALES), [vectors.scaleId, 'adl', 'iadl', 'mmse', 'gds']);
    assert.equal(poma.questions.length, 20);
    assert.ok(Object.isFrozen(SCALES) && Object.isFrozen(poma) && Object.isFrozen(poma.instrument));
    assert.ok(Object.isFrozen(poma.questions) && poma.questions.every(q => Object.isFrozen(q) && Object.isFrozen(q.options)));
    assert.deepEqual(poma.instrument, vectors.instrument);
    assert.deepEqual(poma.questions.map(q => ({ id: q.id, section: q.id.split('.')[1], values: q.options!.map(o => o.value), text: q.text, labels: q.options!.map(o => o.label) })), vectors.components);
    for (const [section, maximum] of Object.entries(vectors.sectionMaxima)) {
        const sum = poma.questions.filter(q => q.id.split('.')[1] === section).reduce((total, q) => total + Math.max(...q.options!.map(o => o.value)), 0);
        assert.equal(sum, maximum);
    }
    assert.equal(Object.values(vectors.sectionMaxima).reduce((sum, value) => sum + value, 0), 28);
    assert.equal(vectors.totalMaximum, 28);
    assert.equal(LEGACY_TINETTI.questions.length, 17);
    assert.equal(LEGACY_TINETTI.questions.reduce((total, q) => total + Math.max(...q.options!.map(o => o.value)), 0), 24);
    assert.ok(poma.questions.every(q => !LEGACY_TINETTI.questions.some(old => old.id === q.id)));
});

for (const vector of vectors.valid) {
    test(`shared valid: ${vector.name}`, async () => {
        const result = calculateScaleResult(poma, vector.answers);
        assert.equal(poma.scoringLogic(vector.answers), vector.score);
        assert.equal(result.score, vector.score);
        assert.equal(result.interpretation, vectors.nonclassification);
        let writes = 0;
        await submitScale(vectors.scaleId, vector.answers, submission => {
            writes++;
            assert.equal(submission.metadata.score, vector.score);
            assert.equal(submission.metadata.scaleId, vectors.scaleId);
            assert.deepEqual(submission.metadata.instrument, vectors.instrument);
            assert.deepEqual(submission.metadata.answers, vector.answers);
            assert.equal(submission.metadata.interpretation, vectors.nonclassification);
            assert.ok(submission.content.includes(`Punteggio: ${vector.score}`));
        });
        assert.equal(writes, 1);
    });
}
for (const vector of vectors.invalid) {
    test(`shared invalid: ${vector.name}`, async () => {
        assert.throws(() => poma.scoringLogic(vector.answers), ScaleValidationError);
        assert.throws(() => calculateScaleResult(poma, vector.answers), ScaleValidationError);
        await assertNoWrite(vectors.scaleId, vector.answers);
    });
}

for (const definition of Object.values(SCALES)) {
    test(`${definition.id}: all required items explicit, zero legitimate, invalid inputs produce zero writes`, async () => {
        const complete = Object.fromEntries(definition.questions.map(q => [q.id, 0]));
        assert.equal(calculateScaleResult(definition, complete).score, 0);
        assert.equal(prepareScaleSubmission(definition.id, complete).metadata.score, 0);
        await assertNoWrite(definition.id, {});
        for (const question of definition.questions) {
            const partial = { ...complete };
            delete partial[question.id];
            assert.throws(() => definition.scoringLogic(partial), ScaleValidationError);
            await assertNoWrite(definition.id, partial);
            await assertNoWrite(definition.id, { ...complete, [question.id]: -1 });
            await assertNoWrite(definition.id, { ...complete, [question.id]: Math.max(...question.options!.map(o => o.value)) + 1 });
        }
        await assertNoWrite(definition.id, { ...complete, foreignQuestion: 0 });
    });
}

test('Web rejects coercion, nonfinite values, fractional choices and non-object answers before writing', async () => {
    for (const value of [undefined, null, '', '0', true, false, NaN, Infinity, -Infinity, 0.5, [], {}]) {
        await assertNoWrite(poma.id, { ...zero, [poma.questions[0].id]: value });
    }
    for (const value of [null, undefined, [], '', 0, true]) await assertNoWrite(poma.id, value);
});

test('Retired/unknown IDs are never active aliases and historic answer semantics remain untouched', async () => {
    assert.throws(() => LEGACY_TINETTI.scoringLogic(vectors.legacy.answers), ScaleValidationError);
    await assertNoWrite('tinetti', vectors.legacy.answers);
    await assertNoWrite('scale-not-in-catalog', zero);
    const before = JSON.stringify(vectors.legacy);
    assert.equal(scaleHistoryNotice(vectors.legacy), LEGACY_TINETTI_NOTICE);
    assert.equal(isSourceBoundTinetti(vectors.legacy), false);
    assert.equal(JSON.stringify(vectors.legacy), before);
    assert.equal(vectors.legacy.score, 24);
    assert.equal(vectors.legacy.interpretation, 'MEDIO Rischio di Caduta (19-24)');
    assert.equal(scaleHistoryNotice(undefined, 'Scala Tinetti (Balance & Gait)'), LEGACY_TINETTI_NOTICE);
    assert.equal(scaleHistoryNotice({ title: '' }, 'Tinetti'), LEGACY_TINETTI_NOTICE);
});

test('Source-bound display requires every known provenance field; no historical recalculation', () => {
    const metadata = prepareScaleSubmission(poma.id, zero).metadata;
    assert.equal(scaleHistoryNotice(metadata), SOURCE_BOUND_TINETTI_NOTICE);
    for (const key of Object.keys(vectors.instrument)) {
        const incomplete = { ...vectors.instrument } as Record<string, unknown>;
        delete incomplete[key];
        assert.equal(isSourceBoundTinetti({ ...metadata, instrument: incomplete }), false);
        assert.equal(scaleHistoryNotice({ ...metadata, instrument: incomplete }), LEGACY_TINETTI_NOTICE);
    }
    assert.equal(scaleHistoryNotice({ ...metadata, instrument: 'unbound' }), LEGACY_TINETTI_NOTICE);
    assert.equal(scaleHistoryNotice({ ...metadata, scaleId: 'tinetti' }), LEGACY_TINETTI_NOTICE);
    assert.equal(scaleHistoryNotice({ scaleId: 'adl', score: 0 }), null);
});

test('Optional and text items retain their declared semantics; required fields cannot be omitted', () => {
    const definition = withValidatedScoring({
        id: 'synthetic-optional-contract', title: 'Synthetic', description: 'Test only, never in active catalog',
        questions: [
            { id: 'scored', text: 'Explicit choice', type: 'choice', options: [{ label: 'Zero', value: 0 }] },
            { id: 'optionalScore', text: 'Optional', type: 'choice', optional: true, options: [{ label: 'Zero', value: 0 }] },
            { id: 'note', text: 'Required note', type: 'text' },
            { id: 'optionalNote', text: 'Optional note', type: 'text', optional: true },
            { id: 'number', text: 'Bounded number', type: 'number', minScore: 0, maxScore: 2, optional: true },
        ],
        scoringLogic: (answers: ScaleAnswers) => answers.scored as number,
        interpretation: () => 'Synthetic test only',
    });
    assert.equal(calculateScaleResult(definition, { scored: 0, note: 'Synthetic note' }).score, 0);
    assert.equal(calculateScaleResult(definition, { scored: 0, note: 'Synthetic note', optionalNote: '', number: 0.5 }).score, 0);
    for (const answers of [{ note: 'Synthetic note' }, { scored: 0 }, { scored: 0, note: ' ' }, { scored: 0, note: 0 }, { scored: 0, note: 'note', number: '0' }]) {
        assert.throws(() => calculateScaleResult(definition, answers), ScaleValidationError);
    }
});

test('Writer uses a snapshot and propagates storage failure without retry', async () => {
    const answers = { ...zero };
    await submitScale(poma.id, answers, submission => {
        answers[poma.questions[0].id] = 1;
        assert.equal(submission.metadata.score, 0);
        assert.equal(submission.metadata.answers[poma.questions[0].id], 0);
    });
    const failure = new Error('Synthetic storage unavailable');
    let writes = 0;
    await assert.rejects(submitScale(poma.id, zero, () => { writes++; throw failure; }), error => error === failure);
    assert.equal(writes, 1);
});

test('Production form and page are wired to the tested gates, not a parallel reference implementation', () => {
    const page = readFileSync('app/patients/[id]/scales/[scaleId]/page.tsx', 'utf8');
    const form = readFileSync('components/scale-engine.tsx', 'utf8');
    assert.match(page, /submitScale\(scaleId, result\.answers, submission => db\.entries\.add\(/);
    assert.doesNotMatch(page, /score:\s*result\.score/);
    assert.match(form, /calculateScaleResult\(scale, answers\)/);
    assert.match(form, /disabled=\{!currentAnswerValid \|\| isSubmitting\}/);
});

// @Codex: provenance survives the real submission/history seam with fetch denied.
test('POMA provenance stays metadata through submission and history without fetch', async (t) => {
    let fetches = 0;
    t.mock.method(globalThis, 'fetch', () => { fetches += 1; throw new Error('network forbidden in scale provenance test'); });
    let writes = 0;
    const metadata = await submitScale(vectors.scaleId, zero, (submission) => {
        writes += 1;
        return JSON.parse(JSON.stringify(submission.metadata)) as Record<string, unknown>;
    });
    assert.equal(writes, 1, 'only the explicit synthetic writer is called');
    assert.deepEqual(metadata.instrument, vectors.instrument);
    assert.equal(isSourceBoundTinetti(metadata), true);
    assert.equal(scaleHistoryNotice(metadata), SOURCE_BOUND_TINETTI_NOTICE);
    assert.equal(fetches, 0, 'no source URL retrieval, including a swallowed fetch failure');
});
