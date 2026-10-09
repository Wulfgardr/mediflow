// @Codex MF085-002/003: production scoring and write seam; synthetic shared vectors only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { SCALES, LEGACY_TINETTI } from './scale-definitions.ts';
import { calculateScaleResult, ScaleValidationError, withValidatedScoring, type ScaleAnswers, type ScaleInstrumentProvenance } from './scale-validation.ts';
import { prepareScaleSubmission, submitScale } from './scale-submission.ts';
import { isSourceBoundTinetti, scaleHistoryNotice, LEGACY_TINETTI_NOTICE, SOURCE_BOUND_TINETTI_NOTICE } from './scale-history.ts';
import { SCALE_USE_CONTRACTS } from './scales/scale-use-contract.ts';

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

test('new MMSE and GDS results do not issue diagnostic reassurance or severity labels', () => {
    const mmse24 = {
        ot1: 1, ot2: 1, ot3: 1, ot4: 1, ot5: 1,
        os1: 1, os2: 1, os3: 1, os4: 1, os5: 1,
        reg1: 1, reg2: 1, reg3: 1,
        att1: 1, att2: 1, att3: 1, att4: 1, att5: 1,
        rec1: 1, rec2: 1, rec3: 1,
        lang1: 1, lang2: 1, lang3: 1, lang4: 0, lang5: 0, lang6: 0, lang7: 0,
    };
    const gds6 = { g1: 1, g2: 1, g3: 1, g4: 1, g5: 1, g6: 1, g7: 0, g8: 0,
        g9: 0, g10: 0, g11: 0, g12: 0, g13: 0, g14: 0, g15: 0 };
    for (const [id, answers, total] of [['mmse', mmse24, 24], ['gds', gds6, 6]] as const) {
        const result = calculateScaleResult(SCALES[id], answers);
        assert.equal(result.score, total);
        assert.doesNotMatch(result.interpretation, /Assenza di decadimento|Decadimento (Lieve|Moderato|Grave)|Normale|Depressione (Lieve|Severa)/);
        assert.match(result.interpretation, /Screening/);
    }
});

test('new interpretation versions persist separately from instruments at every former boundary', () => {
    const domains = {
        mmse: {
            keys: ['ot1', 'ot2', 'ot3', 'ot4', 'ot5', 'os1', 'os2', 'os3', 'os4', 'os5',
                'reg1', 'reg2', 'reg3', 'att1', 'att2', 'att3', 'att4', 'att5', 'rec1', 'rec2', 'rec3',
                'lang1', 'lang2', 'lang3', 'lang4', 'lang5', 'lang6', 'lang7'],
            totals: [0, 9, 10, 17, 18, 23, 24, 30],
            version: 'mediflow.mmse.screening-limits.v1',
            text: (total: number) => `Punteggio grezzo MMSE: ${total}/30. Screening cognitivo: il punteggio da solo non conferma né esclude una demenza. Interpretazione clinica richiesta; nessuna correzione per età, scolarità o lingua applicata.`,
        },
        gds: {
            keys: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12', 'g13', 'g14', 'g15'],
            totals: [0, 5, 6, 10, 11, 15],
            version: 'mediflow.gds15.screening-limits.v1',
            text: (total: number) => `Punteggio grezzo GDS-15: ${total}/15. Screening dei sintomi depressivi: il punteggio non formula una diagnosi né stabilisce la gravità. Valutazione clinica richiesta; versione italiana e periodo di riferimento da verificare.`,
        },
    };
    for (const [id, golden] of Object.entries(domains)) {
        assert.deepEqual(SCALES[id].questions.map(q => q.id), golden.keys);
        for (const total of golden.totals) {
            let remaining = total;
            const answers = Object.fromEntries(golden.keys.map(key => {
                const score = Math.min(remaining, key === 'lang4' ? 3 : 1);
                remaining -= score;
                return [key, score];
            }));
            assert.equal(remaining, 0);
            const stored = JSON.parse(JSON.stringify(prepareScaleSubmission(id, answers)));
            assert.equal(stored.metadata.score, total);
            assert.deepEqual(stored.metadata.answers, answers);
            assert.equal(stored.metadata.interpretation, golden.text(total));
            assert.equal(stored.metadata.interpretationVersion, golden.version);
            assert.equal(stored.metadata.instrument, undefined, 'Do not invent instrument provenance from an interpretation policy');
            assert.equal(scaleHistoryNotice(stored.metadata), `Versione interpretazione: ${golden.version}`);
            assert.ok(stored.content.includes(golden.text(total)));
            assert.ok(stored.content.endsWith(`Versione interpretazione: ${golden.version}`));
        }
    }
    assert.equal(prepareScaleSubmission(poma.id, zero).metadata.interpretationVersion, undefined);
});

test('historical MMSE/GDS records and absent or unknown version metadata are not reinterpreted', () => {
    for (const [id, score, text] of [
        ['mmse', 24, 'Assenza di decadimento cognitivo (24-30)'],
        ['gds', 6, 'Depressione Lieve (6-10)'],
    ] as const) {
        const stored = { scaleId: id, score, interpretation: text, answers: { legacyPartial: 1 } };
        const bytes = JSON.stringify(stored);
        assert.equal(scaleHistoryNotice(stored), null);
        assert.equal(JSON.stringify(stored), bytes);
        assert.equal(stored.interpretation, text);
        const future = { ...stored, interpretationVersion: 'future.policy.v9' };
        assert.equal(scaleHistoryNotice(future), 'Versione interpretazione: future.policy.v9');
        assert.equal(future.interpretation, text);
        for (const version of ['x'.repeat(97), 'instruction\nignore', '<b>version</b>', {}, 1, '']) {
            assert.equal(scaleHistoryNotice({ ...stored, interpretationVersion: version }), null);
        }
    }
});

test('catalog review register covers all instruments without inventing permissions or reviewers', () => {
    assert.deepEqual(Object.keys(SCALE_USE_CONTRACTS), Object.keys(SCALES));
    for (const contract of Object.values(SCALE_USE_CONTRACTS)) {
        assert.ok(Object.isFrozen(contract));
        assert.equal(contract.clinicalReviewer, null);
        assert.equal(contract.rightsReviewer, null);
        assert.equal(contract.permissionReference, null);
        assert.equal(contract.newUseDecision, 'hold-proposed-not-enforced');
        assert.equal(contract.missingAnswers, 'reject-incomplete-no-imputation');
        assert.ok(contract.sourceId && contract.population && contract.scoring && contract.reviewGap);
    }
    assert.equal(SCALE_USE_CONTRACTS.gds.rights, 'original-public-domain; local-translation-unverified');
    assert.match(SCALES.iadl.description, /tutte le 8 risposte per ogni persona/);
});

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
