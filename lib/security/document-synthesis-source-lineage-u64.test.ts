// @Codex
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    advanceDocumentSynthesisRevocationGeneration,
    advanceDocumentSynthesisSourceSetEpoch,
    allocateDocumentSynthesisSourceSetEpoch,
    createDocumentSynthesisSourceLineageState,
    DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX,
    observeDocumentSynthesisRevocation,
} from './document-synthesis-source-lineage-u64.ts';

function assertFrozenNull(value: object): void { assert.equal(Object.isFrozen(value), true); assert.equal(Object.getPrototypeOf(value), null); }
const ZERO = BigInt(0); const ONE = BigInt(1); const TWO = BigInt(2); const THREE = BigInt(3);
function stateAt(nextSourceSetEpoch: bigint, revocationGeneration = ZERO) {
    return Object.freeze(Object.assign(Object.create(null), { nextSourceSetEpoch, exhausted: false,
        revocationGeneration, seenRevocationEvents: Object.freeze([]) }));
}

test('starts at one and permits caller-managed gaps without reuse', () => {
    const first = allocateDocumentSynthesisSourceSetEpoch(createDocumentSynthesisSourceLineageState());
    assert.equal(first.status, 'allocated'); if (first.status !== 'allocated') return;
    assert.equal(first.sourceSetEpoch, ONE); assertFrozenNull(first); assertFrozenNull(first.state);
    const skipped = allocateDocumentSynthesisSourceSetEpoch(first.state);
    assert.equal(skipped.status, 'allocated'); if (skipped.status !== 'allocated') return;
    const third = allocateDocumentSynthesisSourceSetEpoch(skipped.state);
    assert.equal(third.status, 'allocated'); if (third.status !== 'allocated') return;
    assert.equal(third.sourceSetEpoch, THREE);
});

test('emits u64 max once and then becomes terminal', () => {
    const max = advanceDocumentSynthesisSourceSetEpoch(DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX);
    assert.equal(max.status, 'advanced'); if (max.status !== 'advanced') return;
    assert.equal(max.value, DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX); assert.equal(max.next, DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX);
    assert.equal(max.exhausted, true); assertFrozenNull(max);
    assert.equal(advanceDocumentSynthesisSourceSetEpoch(DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX + ONE).status, 'invalid');
    const final = allocateDocumentSynthesisSourceSetEpoch(stateAt(DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX));
    assert.equal(final.status, 'allocated'); if (final.status !== 'allocated') return;
    assert.equal(final.sourceSetEpoch, DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX);
    assert.equal(allocateDocumentSynthesisSourceSetEpoch(final.state).status, 'exhausted');
});

test('starts revocation at zero and increments only distinct identity events', () => {
    const alpha = Object.freeze(Object.create(null)); const beta = Object.freeze(Object.create(null));
    const initial = createDocumentSynthesisSourceLineageState(); assert.equal(initial.revocationGeneration, ZERO);
    const one = observeDocumentSynthesisRevocation(initial, alpha); assert.equal(one.status, 'advanced'); if (one.status !== 'advanced') return;
    assert.equal(one.state.revocationGeneration, ONE);
    const repeated = observeDocumentSynthesisRevocation(one.state, alpha); assert.equal(repeated.status, 'repeated'); if (repeated.status !== 'repeated') return;
    assert.equal(repeated.state, one.state);
    const two = observeDocumentSynthesisRevocation(repeated.state, beta); assert.equal(two.status, 'advanced'); if (two.status !== 'advanced') return;
    assert.equal(two.state.revocationGeneration, TWO);
});

test('denies revocation overflow without wrap', () => {
    assert.equal(advanceDocumentSynthesisRevocationGeneration(DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX).status, 'exhausted');
    assert.equal(advanceDocumentSynthesisRevocationGeneration(-ONE).status, 'invalid');
    const overflow = observeDocumentSynthesisRevocation(stateAt(ONE, DOCUMENT_SYNTHESIS_LINEAGE_U64_MAX), Object.freeze(Object.create(null)));
    assert.equal(overflow.status, 'exhausted'); if (overflow.status !== 'exhausted') return;
    assert.equal(allocateDocumentSynthesisSourceSetEpoch(overflow.state).status, 'exhausted');
});

test('rejects hostile input without property reads or thenable observation', () => {
    let reads = 0;
    const proxy = new Proxy(Object.freeze({}), { get() { reads += 1; throw new Error('synthetic trap'); }, ownKeys() { reads += 1; throw new Error('synthetic trap'); } });
    const accessor = Object.freeze(Object.defineProperty({}, 'nextSourceSetEpoch', { enumerable: true, get() { reads += 1; return ONE; } }));
    const thenable = Object.freeze(Object.defineProperty(Object.create(null), 'then', { enumerable: true, get() { reads += 1; return () => undefined; } }));
    const sparse = Object.freeze([Object.freeze(Object.create(null)), , Object.freeze(Object.create(null))]);
    const symbolic = Object.freeze(Object.assign(Object.create(null), { ...stateAt(ONE), [Symbol('synthetic')]: true }));
    const hidden = Object.freeze(Object.defineProperty(Object.assign(Object.create(null), stateAt(ONE)), 'hidden', { value: true }));
    for (const value of [proxy, accessor, thenable, sparse, symbolic, hidden, Object.freeze({}), Object.freeze({ nextSourceSetEpoch: ONE })]) {
        assert.equal(allocateDocumentSynthesisSourceSetEpoch(value).status, 'invalid');
        assert.equal(observeDocumentSynthesisRevocation(createDocumentSynthesisSourceLineageState(), value).status, 'invalid');
    }
    assert.equal(reads, 0);
});
