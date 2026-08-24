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

    let accessorReads = 0;
    const accessorReceipt = { ...ollamaOcrInput().receipt };
    Object.defineProperty(accessorReceipt, 'provider', { enumerable: true, get: () => { accessorReads += 1; return 'ollama_ocr'; } });
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), receipt: accessorReceipt }), null);
    assert.equal(accessorReads, 0);

    const nonEnumerableReceipt = { ...ollamaOcrInput().receipt };
    Object.defineProperty(nonEnumerableReceipt, 'provider', { enumerable: false, value: 'ollama_ocr' });
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), receipt: nonEnumerableReceipt }), null);

    const prototypeReceipt = Object.assign(Object.create({ inherited: true }), ollamaOcrInput().receipt);
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), receipt: prototypeReceipt }), null);
});

test('rejects outer and nested proxies before executing reflection traps', () => {
    const trapCounters = { outer: 0, receipt: 0, provenance: 0 };
    const traps = (key: keyof typeof trapCounters): ProxyHandler<object> => ({
        get: () => { trapCounters[key] += 1; throw new Error('must not read'); },
        getOwnPropertyDescriptor: () => { trapCounters[key] += 1; throw new Error('must not reflect'); },
        getPrototypeOf: () => { trapCounters[key] += 1; throw new Error('must not reflect'); },
        ownKeys: () => { trapCounters[key] += 1; throw new Error('must not reflect'); },
    });
    assert.equal(resolveLocalOcrProvider(new Proxy(ollamaOcrInput(), traps('outer'))), null);
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), receipt: new Proxy(ollamaOcrInput().receipt, traps('receipt')) }), null);
    assert.equal(resolveLocalOcrProvider({ ...ollamaOcrInput(), provenance: new Proxy(ollamaOcrInput().provenance, traps('provenance')) }), null);
    assert.deepEqual(trapCounters, { outer: 0, receipt: 0, provenance: 0 });
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
