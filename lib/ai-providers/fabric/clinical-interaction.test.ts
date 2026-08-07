/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CLINICAL_REVIEW_STATES,
    ClinicalInteractionError,
    advanceClinicalReview,
    buildInputCompleteness,
    createClinicalProposal,
    declareUncertainty,
    uncertaintyFromNumeric,
    type ClinicalInteractionErrorCode,
    type ClinicalProposal,
    type ClinicalReviewEvent,
    type ClinicalReviewState,
} from './clinical-interaction.ts';

function expectCode(code: ClinicalInteractionErrorCode, run: () => unknown): void {
    assert.throws(run, (error) => error instanceof ClinicalInteractionError && error.code === code);
}

function proposal(provenanceRef: string | null = 'synthetic-provenance'): ClinicalProposal {
    return createClinicalProposal({
        capability: 'patient_insight',
        provenanceRef,
        uncertainty: declareUncertainty('medium'),
        completeness: {
            unreadableFields: ['synthetic.locked'],
            missingFields: ['synthetic.missing'],
        },
        pendingWork: [{
            kind: 'results_pending',
            sourceRef: { type: 'synthetic_result', id: 'result-1' },
        }],
    });
}

function proposalAt(state: Extract<ClinicalReviewState, 'pending' | 'clarification_requested' | 'previewed'>): ClinicalProposal {
    const initial = proposal();
    if (state === 'pending') return initial;
    if (state === 'clarification_requested') {
        return advanceClinicalReview(initial, { type: 'request_clarification', actor: 'application' });
    }
    return advanceClinicalReview(initial, { type: 'preview', actor: 'physician' });
}

test('dichiara o degrada l incertezza con origine esplicita', () => {
    assert.deepEqual(declareUncertainty(' High '), { level: 'high', source: 'declared' });
    assert.deepEqual(declareUncertainty(''), { level: 'low', source: 'degraded_default' });
    assert.deepEqual(declareUncertainty(undefined), { level: 'low', source: 'degraded_default' });
    assert.deepEqual(uncertaintyFromNumeric(0.8), { level: 'high', source: 'declared' });
    assert.deepEqual(uncertaintyFromNumeric(0.45), { level: 'medium', source: 'declared' });
    assert.deepEqual(uncertaintyFromNumeric(0.44), { level: 'low', source: 'declared' });
    assert.deepEqual(uncertaintyFromNumeric(Number.NaN), { level: 'low', source: 'degraded_default' });
    assert.deepEqual(uncertaintyFromNumeric(1.1), { level: 'low', source: 'degraded_default' });
});

test('separa illeggibili e assenti e respinge overlap, duplicati e valori vuoti', () => {
    const completeness = buildInputCompleteness({
        unreadableFields: ['synthetic.locked'],
        missingFields: ['synthetic.missing'],
    });
    assert.deepEqual(completeness, {
        unreadableFields: ['synthetic.locked'],
        missingFields: ['synthetic.missing'],
    });
    assert.equal(Object.isFrozen(completeness), true);
    assert.equal(Object.isFrozen(completeness.unreadableFields), true);
    assert.equal(Object.isFrozen(completeness.missingFields), true);

    expectCode('completeness_invalid', () => buildInputCompleteness({
        unreadableFields: ['synthetic.same'],
        missingFields: ['synthetic.same'],
    }));
    expectCode('completeness_invalid', () => buildInputCompleteness({
        unreadableFields: ['synthetic.duplicate', 'synthetic.duplicate'],
        missingFields: [],
    }));
    expectCode('completeness_invalid', () => buildInputCompleteness({
        unreadableFields: [],
        missingFields: [' '],
    }));
    // Falsificatore S4: lo stesso campo logico circondato da spazi non deve
    // aggirare il controllo di overlap; la normalizzazione trim lo pareggia.
    expectCode('completeness_invalid', () => buildInputCompleteness({
        unreadableFields: ['synthetic.same'],
        missingFields: [' synthetic.same '],
    }));
    const trimmed = buildInputCompleteness({
        unreadableFields: [' synthetic.padded '],
        missingFields: [],
    });
    assert.deepEqual(trimmed.unreadableFields, ['synthetic.padded']);
});

test('crea sempre una proposta pending, valida il catalogo e congela in profondita', () => {
    const created = proposal();
    assert.equal(created.schemaVersion, 'mediflow.ai.clinical-interaction.v1');
    assert.equal(created.review, 'pending');
    assert.equal(Object.isFrozen(created), true);
    assert.equal(Object.isFrozen(created.uncertainty), true);
    assert.equal(Object.isFrozen(created.completeness), true);
    assert.equal(Object.isFrozen(created.pendingWork), true);
    assert.equal(Object.isFrozen(created.pendingWork[0]), true);
    assert.equal(Object.isFrozen(created.pendingWork[0].sourceRef), true);

    expectCode('proposal_invalid', () => createClinicalProposal({
        ...created,
        capability: 'unknown_capability',
    }));
    expectCode('proposal_invalid', () => createClinicalProposal({
        ...created,
        review: 'previewed',
    }));
    expectCode('proposal_invalid', () => createClinicalProposal({
        ...created,
        uncertainty: { level: 'high', source: 'degraded_default' },
    }));
});

test('esegue tutte e sole le transizioni felici con gli attori previsti', () => {
    for (const actor of ['physician', 'application'] as const) {
        assert.equal(advanceClinicalReview(proposal(), {
            type: 'request_clarification',
            actor,
        }).review, 'clarification_requested');
    }
    for (const state of ['pending', 'clarification_requested'] as const) {
        assert.equal(advanceClinicalReview(proposalAt(state), {
            type: 'preview',
            actor: 'physician',
        }).review, 'previewed');
    }
    assert.equal(advanceClinicalReview(proposalAt('previewed'), {
        type: 'accept',
        actor: 'physician',
        uncertaintyAcknowledged: true,
    }).review, 'accepted');
    for (const state of ['pending', 'clarification_requested', 'previewed'] as const) {
        assert.equal(advanceClinicalReview(proposalAt(state), {
            type: 'reject',
            actor: 'physician',
        }).review, 'rejected');
        assert.equal(advanceClinicalReview(proposalAt(state), {
            type: 'supersede',
            actor: 'application',
        }).review, 'superseded');
    }
});

test('applica l ordine errori congelato per accept', () => {
    expectCode('actor_forbidden', () => advanceClinicalReview(proposalAt('previewed'), {
        type: 'accept',
        actor: 'application',
        uncertaintyAcknowledged: true,
    }));
    expectCode('uncertainty_not_acknowledged', () => advanceClinicalReview(proposalAt('previewed'), {
        type: 'accept',
        actor: 'physician',
    }));
    const noProvenance = advanceClinicalReview(proposal(null), {
        type: 'preview',
        actor: 'physician',
    });
    expectCode('provenance_missing', () => advanceClinicalReview(noProvenance, {
        type: 'accept',
        actor: 'physician',
        uncertaintyAcknowledged: true,
    }));
    expectCode('transition_invalid', () => advanceClinicalReview(proposalAt('pending'), {
        type: 'accept',
        actor: 'application',
    }));
});

test('indurimenti runtime: ref vuoto e attore fuori vocabolario', () => {
    // Una stringa vuota o di soli spazi non e' un riferimento di provenienza.
    expectCode('proposal_invalid', () => createClinicalProposal({
        capability: 'document_synthesis',
        provenanceRef: '   ',
        uncertainty: declareUncertainty('low'),
        completeness: { unreadableFields: [], missingFields: [] },
        pendingWork: [],
    }));
    // Difesa in profondita all'accettazione: un ref svuotato a runtime oltre
    // i tipi non supera il gate di provenienza.
    const forged = { ...proposalAt('previewed'), provenanceRef: ' ' } as ReturnType<typeof proposalAt>;
    expectCode('provenance_missing', () => advanceClinicalReview(forged, {
        type: 'accept',
        actor: 'physician',
        uncertaintyAcknowledged: true,
    }));
    // Un attore runtime fuori vocabolario e' respinto anche dove la
    // transizione non vincola l'attore.
    expectCode('actor_forbidden', () => advanceClinicalReview(proposalAt('pending'), {
        type: 'request_clarification',
        actor: 'model',
    } as unknown as Parameters<typeof advanceClinicalReview>[1]));
});

test('blocca ogni evento dagli stati terminali e non espone applied', () => {
    const terminal = [
        advanceClinicalReview(proposalAt('previewed'), {
            type: 'accept',
            actor: 'physician',
            uncertaintyAcknowledged: true,
        }),
        advanceClinicalReview(proposal(), { type: 'reject', actor: 'physician' }),
        advanceClinicalReview(proposal(), { type: 'supersede', actor: 'application' }),
    ];
    const events: ClinicalReviewEvent[] = [
        { type: 'request_clarification', actor: 'application' },
        { type: 'preview', actor: 'physician' },
        { type: 'accept', actor: 'physician', uncertaintyAcknowledged: true },
        { type: 'reject', actor: 'physician' },
        { type: 'supersede', actor: 'application' },
    ];
    for (const item of terminal) {
        for (const event of events) {
            expectCode('transition_invalid', () => advanceClinicalReview(item, event));
        }
    }
    assert.equal(CLINICAL_REVIEW_STATES.includes('applied' as ClinicalReviewState), false);
    assert.equal(Object.isFrozen(CLINICAL_REVIEW_STATES), true);
});

test('advance restituisce una nuova proposta congelata senza mutare l originale', () => {
    const original = proposal();
    const advanced = advanceClinicalReview(original, {
        type: 'preview',
        actor: 'physician',
    });
    assert.notEqual(advanced, original);
    assert.equal(original.review, 'pending');
    assert.equal(advanced.review, 'previewed');
    assert.equal(Object.isFrozen(advanced), true);
    assert.equal(Object.isFrozen(advanced.pendingWork), true);
});

test('materializza pendingWork una sola volta contro iteratori stateful', () => {
    let iterations = 0;
    const pendingWork = [{
        kind: 'ocr_pending',
        sourceRef: { type: 'synthetic_document', id: null },
    }];
    Object.defineProperty(pendingWork, Symbol.iterator, {
        value: function* () {
            iterations += 1;
            yield iterations === 1
                ? { kind: 'ocr_pending', sourceRef: { type: 'synthetic_document', id: null } }
                : { kind: 'invalid_kind', sourceRef: { type: '', id: null } };
        },
    });

    const created = createClinicalProposal({
        capability: 'document_synthesis',
        provenanceRef: 'synthetic-provenance',
        uncertainty: declareUncertainty('low'),
        completeness: { unreadableFields: [], missingFields: [] },
        pendingWork,
    });
    assert.equal(iterations, 1);
    assert.deepEqual(created.pendingWork, [{
        kind: 'ocr_pending',
        sourceRef: { type: 'synthetic_document', id: null },
    }]);
});
