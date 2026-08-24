/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocalOcrProvider } from './local-ocr-provider-contract.ts';

function ollamaOcrInput() {
    return {
        provider: 'ollama_ocr',
        readiness: 'ready',
        receipt: {
            schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1',
            provider: 'ollama_ocr',
            venue: 'local_process',
            egress: 'none',
            authority: 'review_only',
            applyPolicy: 'none',
            writesPerformed: 0,
        },
        provenance: {
            schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1',
            provider: 'ollama_ocr',
            venue: 'local_process',
            egress: 'none',
            receiptProvider: 'ollama_ocr',
        },
    };
}

function appleVisionInput() {
    return {
        provider: 'apple_vision',
        readiness: 'ready',
        receipt: {
            schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1',
            provider: 'apple_vision',
            venue: 'on_device',
            egress: 'none',
            authority: 'review_only',
            applyPolicy: 'none',
            writesPerformed: 0,
        },
        provenance: {
            schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1',
            provider: 'apple_vision',
            venue: 'on_device',
            egress: 'none',
            receiptProvider: 'apple_vision',
        },
    };
}

test('resolves one explicit ready Ollama OCR provider into review-only metadata', () => {
    const result = resolveLocalOcrProvider(ollamaOcrInput());

    assert.deepEqual(result, {
        outcome: 'ready',
        provider: 'ollama_ocr',
        receipt: ollamaOcrInput().receipt,
        provenance: ollamaOcrInput().provenance,
        writesPerformed: 0,
        applyPolicy: 'none',
    });
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.receipt));
    assert.ok(Object.isFrozen(result.provenance));
});

test('resolves Apple Vision only from its independent ready receipt and provenance', () => {
    const result = resolveLocalOcrProvider(appleVisionInput());

    assert.deepEqual(result, {
        outcome: 'ready',
        provider: 'apple_vision',
        receipt: appleVisionInput().receipt,
        provenance: appleVisionInput().provenance,
        writesPerformed: 0,
        applyPolicy: 'none',
    });
});

test('fails closed for a missing or unready provider and for an implicit fallback', () => {
    assert.equal(resolveLocalOcrProvider(undefined), null);
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), readiness: 'unready' }), null);
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), provider: undefined }), null);
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), fallback: 'apple_vision' }), null);
});

test('rejects cross-provider evidence plus malformed venue, egress, authority, and apply metadata', () => {
    const cases = [
        { ...ollamaOcrInput(), receipt: { ...ollamaOcrInput().receipt, provider: 'apple_vision' } },
        { ...ollamaOcrInput(), provenance: { ...ollamaOcrInput().provenance, receiptProvider: 'apple_vision' } },
        { ...ollamaOcrInput(), receipt: { ...ollamaOcrInput().receipt, venue: 'cloud' } },
        { ...ollamaOcrInput(), receipt: { ...ollamaOcrInput().receipt, egress: 'redacted_explicit_consent' } },
        { ...ollamaOcrInput(), receipt: { ...ollamaOcrInput().receipt, authority: 'review_or_apply' } },
        { ...ollamaOcrInput(), receipt: { ...ollamaOcrInput().receipt, applyPolicy: 'propose' } },
        { ...ollamaOcrInput(), receipt: { ...ollamaOcrInput().receipt, writesPerformed: 1 } },
    ];
    for (const input of cases) assert.equal(resolveLocalOcrProvider(input), null);
});

test('rejects extra keys, accessors, and non-plain prototypes without reading hostile accessors', () => {
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), receipt: { ...ollamaOcrInput().receipt, extra: true } }), null);

    const accessorReceipt = { ...ollamaOcrInput().receipt };
    Object.defineProperty(accessorReceipt, 'provider', { enumerable: true, get: () => { throw new Error('must not read'); } });
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), receipt: accessorReceipt }), null);

    const prototypeReceipt = Object.assign(Object.create({ inherited: true }), ollamaOcrInput().receipt);
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), receipt: prototypeReceipt }), null);
});

test('snapshots accepted metadata so later input or result mutation cannot change the receipt', () => {
    const input = ollamaOcrInput();
    const result = resolveLocalOcrProvider(input);
    assert.ok(result);
    input.receipt.provider = 'apple_vision';
    input.provenance.receiptProvider = 'apple_vision';
    assert.equal(result.receipt.provider, 'ollama_ocr');
    assert.equal(result.provenance.receiptProvider, 'ollama_ocr');
    assert.throws(() => { (result as { provider: string }).provider = 'apple_vision'; }, TypeError);
});
