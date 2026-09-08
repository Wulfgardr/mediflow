/* @Codex UI06: real pure validators/catalog/write seam; only the writer is a spy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScaleResult, isScaleAnswerValid, ScaleValidationError, type ScaleAnswers } from '../../lib/scale-validation';
import { prepareScaleSubmission, submitScale } from '../../lib/scale-submission';
import { SCALES } from '../../lib/scale-definitions';
import { scaleHistoryNotice, LEGACY_TINETTI_NOTICE, SOURCE_BOUND_TINETTI_NOTICE } from '../../lib/scale-history';
import { TINETTI_POMA28, TINETTI_POMA28_ID, TINETTI_POMA28_INSTRUMENT, TINETTI_NONCLASSIFICATION } from '../../lib/scales/tinetti-poma28-v1';
import { syntheticScale } from './synthetic-scale';

const complete = (): ScaleAnswers => ({ choice: 0, boolean: 0, number: 0 });
const poma = (maximum: boolean): ScaleAnswers => Object.fromEntries(TINETTI_POMA28.questions.map(q => [
    q.id, maximum ? Math.max(...q.options!.map(option => option.value)) : 0,
]));

for (const question of syntheticScale.questions.filter(q => !q.optional)) {
    test(`${question.type}: missing is not an implicit zero`, () => {
        assert.equal(isScaleAnswerValid(question, undefined, false), false);
        assert.equal(isScaleAnswerValid(question, 0, true), true);
        const answers = complete(); delete answers[question.id];
        assert.throws(() => calculateScaleResult(syntheticScale, answers), ScaleValidationError);
    });
}

test('blank numeric input differs from a stored numeric zero', () => {
    const question = syntheticScale.questions[2];
    assert.equal(isScaleAnswerValid(question, '', true), false);
    assert.equal(isScaleAnswerValid(question, undefined, false), false);
    assert.equal(isScaleAnswerValid(question, 0, true), true);
    assert.equal(calculateScaleResult(syntheticScale, complete()).score, 0);
});

test('choice, boolean and numeric bounds remain exact', () => {
    for (const [key, value] of [['choice', 2], ['boolean', 2], ['number', 6], ['number', -1], ['number', Number.NaN]] as const) {
        assert.throws(() => calculateScaleResult(syntheticScale, { ...complete(), [key]: value }), ScaleValidationError);
    }
});

test('an optional note can remain absent, and does not add a value to the answers', () => {
    const result = calculateScaleResult(syntheticScale, complete());
    assert.equal(Object.hasOwn(result.answers, 'note'), false);
    assert.equal(result.interpretation, 'Esito sintetico: 0');
});

test('an explicit note, including whitespace, is preserved rather than coerced to points', () => {
    const note = '  testo sintetico con spazi  ';
    const result = calculateScaleResult(syntheticScale, { ...complete(), note });
    assert.equal(result.answers.note, note);
    assert.equal(result.score, 0);
});

test('a required text response still needs non-whitespace content', () => {
    const question = { ...syntheticScale.questions[3], optional: false };
    assert.equal(isScaleAnswerValid(question, '  ', true), false);
    assert.equal(isScaleAnswerValid(question, 'testo', true), true);
});

test('calculation returns a distinct answer snapshot without changing the draft', () => {
    const draft = complete(); const before = structuredClone(draft);
    const result = calculateScaleResult(syntheticScale, draft);
    assert.notEqual(result.answers, draft);
    result.answers.number = 3;
    assert.deepEqual(draft, before);
});

test('catalog question order and values survive repeated calculations', () => {
    const before = JSON.stringify(TINETTI_POMA28.questions);
    calculateScaleResult(TINETTI_POMA28, poma(false));
    calculateScaleResult(TINETTI_POMA28, poma(true));
    assert.equal(JSON.stringify(TINETTI_POMA28.questions), before);
    assert.equal(Object.isFrozen(TINETTI_POMA28.questions), true);
    assert.equal(TINETTI_POMA28.questions.every(q => Object.isFrozen(q) && Object.isFrozen(q.options)), true);
});

test('current POMA endpoints preserve the catalog total and non-classification', () => {
    // The active catalog deliberately re-wraps validated definitions; identity is not its contract.
    assert.deepEqual(SCALES[TINETTI_POMA28_ID].questions, TINETTI_POMA28.questions);
    assert.deepEqual(SCALES[TINETTI_POMA28_ID].instrument, TINETTI_POMA28.instrument);
    assert.equal(SCALES[TINETTI_POMA28_ID].scoringLogic(poma(true)), 28);
    assert.equal(TINETTI_POMA28.questions.length, 20);
    assert.equal(calculateScaleResult(TINETTI_POMA28, poma(false)).score, 0);
    const maximum = calculateScaleResult(TINETTI_POMA28, poma(true));
    assert.equal(maximum.score, 28);
    assert.equal(maximum.interpretation, TINETTI_NONCLASSIFICATION);
});

test('incomplete ordinary submissions never reach the writer', async () => {
    let writes = 0;
    const draft = poma(false); delete draft[TINETTI_POMA28.questions[0].id];
    await assert.rejects(submitScale(TINETTI_POMA28_ID, draft, () => { writes += 1; }), ScaleValidationError);
    assert.equal(writes, 0);
});

test('an explicit all-zero submission reaches the writer exactly once with original provenance', async () => {
    let writes = 0;
    const result = await submitScale(TINETTI_POMA28_ID, poma(false), submission => {
        writes += 1;
        assert.equal(submission.metadata.score, 0);
        assert.deepEqual(submission.metadata.instrument, TINETTI_POMA28_INSTRUMENT);
        assert.equal(submission.metadata.interpretation, TINETTI_NONCLASSIFICATION);
        return 'synthetic-receipt';
    });
    assert.equal(writes, 1); assert.equal(result, 'synthetic-receipt');
});

test('the prepared submission copies both draft and provenance, leaving the catalog untouched', () => {
    const answers = poma(true);
    const prepared = prepareScaleSubmission(TINETTI_POMA28_ID, answers);
    assert.notEqual(prepared.metadata.answers, answers);
    assert.notEqual(prepared.metadata.instrument, TINETTI_POMA28_INSTRUMENT);
    assert.equal(TINETTI_POMA28_INSTRUMENT.translationStatus, 'local-unvalidated');
    assert.equal(TINETTI_POMA28_INSTRUMENT.riskClassification, 'not-classified');
});

test('a rejected writer does not retry implicitly or mutate the draft', async () => {
    const draft = poma(false); const before = structuredClone(draft);
    const failure = new Error('synthetic storage failure'); let calls = 0;
    await assert.rejects(submitScale(TINETTI_POMA28_ID, draft, () => { calls += 1; throw failure; }), error => error === failure);
    assert.equal(calls, 1); assert.deepEqual(draft, before);
});

for (const id of ['tinetti', 'ui06-unknown']) {
    test(`${id}: retired/unknown instruments remain unavailable for new writes`, async () => {
        let writes = 0;
        await assert.rejects(submitScale(id, poma(false), () => { writes += 1; }), ScaleValidationError);
        assert.equal(writes, 0);
    });
}

test('historical Tinetti is described as stored, without rescoring or adding provenance', () => {
    const stored = { scaleId: 'tinetti', score: 17, interpretation: 'Testo storico sintetico', answers: { b1: 0 } };
    const before = structuredClone(stored);
    assert.equal(scaleHistoryNotice(stored), LEGACY_TINETTI_NOTICE);
    assert.deepEqual(stored, before); assert.equal(Object.hasOwn(stored, 'instrument'), false);
});

test('only the exact source-bound metadata receives the current source notice', () => {
    const metadata = { scaleId: TINETTI_POMA28_ID, instrument: { ...TINETTI_POMA28_INSTRUMENT } };
    assert.equal(scaleHistoryNotice(metadata), SOURCE_BOUND_TINETTI_NOTICE);
    const changed = { ...metadata, instrument: { ...metadata.instrument, sourceDocumentVersion: 'versione diversa sintetica' } };
    assert.equal(scaleHistoryNotice(changed), LEGACY_TINETTI_NOTICE);
    assert.equal(scaleHistoryNotice({ title: 'Questionario sintetico' }), null);
});
