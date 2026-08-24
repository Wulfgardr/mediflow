/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostLocalOcrAdmissionService } from './local-ocr-host-admission.ts';
import { createHostLocalOcrReceiptProvenanceComposer } from './local-ocr-receipt-provenance-composer.ts';

type Provider = 'ollama_ocr' | 'apple_vision';

const venue = (provider: Provider) => provider === 'ollama_ocr' ? 'local_process' : 'on_device';
const policy = (provider: Provider) => ({ provider, venue: venue(provider), egress: 'none', authority: 'review_only', applyPolicy: 'none' });
const readiness = (provider: Provider, state: 'available' | 'unavailable' = 'available') => ({ provider, venue: venue(provider), state });
const receipt = (provider: Provider) => ({
    schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1', provider, venue: venue(provider), egress: 'none',
    authority: 'review_only', applyPolicy: 'none', writesPerformed: 0,
});
const provenance = (provider: Provider) => ({
    schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1', provider, venue: venue(provider), egress: 'none', receiptProvider: provider,
});
const admit = (provider: Provider, state: 'available' | 'unavailable' = 'available') => createHostLocalOcrAdmissionService({
    readPolicy: async () => policy(provider), readReadiness: async () => readiness(provider, state),
}).admit();
const deny = (code: string) => ({ status: 'denied', code, binding: null, receipt: null, provenance: null,
    fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0 });

test('composes independently frozen receipt and provenance bound to each admitted provider and venue', async () => {
    const composer = createHostLocalOcrReceiptProvenanceComposer();
    for (const provider of ['ollama_ocr', 'apple_vision'] as const) {
        const result = composer.compose({ admission: await admit(provider), receipt: receipt(provider), provenance: provenance(provider) });
        assert.deepEqual(result, {
            status: 'composed', code: null, binding: { provider, venue: venue(provider), egress: 'none' },
            receipt: receipt(provider), provenance: provenance(provider),
            fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0,
        });
        assert.ok(Object.isFrozen(result));
        assert.ok(Object.isFrozen(result.binding));
        assert.ok(Object.isFrozen(result.receipt));
        assert.ok(Object.isFrozen(result.provenance));
    }
});

test('denies unavailable or denied packet-A results and never accepts a caller provider or fallback', async () => {
    const composer = createHostLocalOcrReceiptProvenanceComposer();
    const unavailable = await admit('ollama_ocr', 'unavailable');
    assert.deepEqual(composer.compose({ admission: unavailable, receipt: receipt('ollama_ocr'), provenance: provenance('ollama_ocr') }), deny('admission_denied'));
    assert.deepEqual((composer.compose as (input: unknown) => unknown)({
        admission: await admit('ollama_ocr'), provider: 'apple_vision', receipt: receipt('ollama_ocr'), provenance: provenance('ollama_ocr'),
    }), deny('composition_invalid'));
});

test('denies mismatched, malformed, hostile, and cross-provider evidence without fallback', async () => {
    const composer = createHostLocalOcrReceiptProvenanceComposer();
    const admission = await admit('ollama_ocr');
    let accessorReads = 0;
    const hostile = { ...receipt('ollama_ocr') };
    Object.defineProperty(hostile, 'provider', { enumerable: true, get: () => { accessorReads += 1; return 'ollama_ocr'; } });
    for (const evidence of [
        { receipt: receipt('apple_vision'), provenance: provenance('ollama_ocr') },
        { receipt: receipt('ollama_ocr'), provenance: provenance('apple_vision') },
        { receipt: { ...receipt('ollama_ocr'), venue: 'on_device' }, provenance: provenance('ollama_ocr') },
        { receipt: hostile, provenance: provenance('ollama_ocr') },
        { receipt: receipt('ollama_ocr'), provenance: { ...provenance('ollama_ocr'), extra: true } },
    ]) {
        assert.deepEqual(composer.compose({ admission, ...evidence }), deny('evidence_invalid'));
    }
    assert.equal(accessorReads, 0);
});

test('rejects request, admission, receipt, and provenance proxies before executing any traps', async () => {
    const composer = createHostLocalOcrReceiptProvenanceComposer();
    const admission = await admit('ollama_ocr');
    const counters = { request: 0, admission: 0, receipt: 0, provenance: 0 };
    const wrap = <T extends object>(value: T, key: keyof typeof counters, throwing: boolean) => new Proxy(value, {
        get: (target, property, receiver) => { counters[key] += 1; if (throwing) throw new Error('must not read'); return Reflect.get(target, property, receiver); },
        getOwnPropertyDescriptor: (target, property) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.getOwnPropertyDescriptor(target, property); },
        getPrototypeOf: (target) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.getPrototypeOf(target); },
        isExtensible: (target) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.isExtensible(target); },
        ownKeys: (target) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.ownKeys(target); },
        preventExtensions: (target) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.preventExtensions(target); },
    });
    const evidence = { receipt: receipt('ollama_ocr'), provenance: provenance('ollama_ocr') };
    for (const throwing of [false, true]) {
        assert.deepEqual(composer.compose(wrap({ admission, ...evidence }, 'request', throwing)), deny('composition_invalid'));
        assert.deepEqual(composer.compose({ admission: wrap(admission, 'admission', throwing), ...evidence }), deny('admission_invalid'));
        assert.deepEqual(composer.compose({ admission, receipt: wrap(evidence.receipt, 'receipt', throwing), provenance: evidence.provenance }), deny('evidence_invalid'));
        assert.deepEqual(composer.compose({ admission, receipt: evidence.receipt, provenance: wrap(evidence.provenance, 'provenance', throwing) }), deny('evidence_invalid'));
    }
    assert.deepEqual(counters, { request: 0, admission: 0, receipt: 0, provenance: 0 });
});

test('rejects non-enumerable, symbol, extra, accessor, and prototype request shapes without reads', async () => {
    const composer = createHostLocalOcrReceiptProvenanceComposer();
    const admission = await admit('ollama_ocr');
    const evidence = { receipt: receipt('ollama_ocr'), provenance: provenance('ollama_ocr') };
    let reads = 0;
    const accessor = { admission, ...evidence };
    Object.defineProperty(accessor, 'receipt', { enumerable: true, get: () => { reads += 1; return evidence.receipt; } });
    const nonEnumerable = { admission, ...evidence };
    Object.defineProperty(nonEnumerable, 'receipt', { enumerable: false, value: evidence.receipt });
    const inherited = Object.assign(Object.create({ inherited: true }), { admission, ...evidence });
    for (const input of [
        nonEnumerable,
        accessor,
        { admission, ...evidence, extra: true },
        { admission, ...evidence, [Symbol('authority')]: 'apply' },
        inherited,
    ]) assert.deepEqual(composer.compose(input), deny('composition_invalid'));
    assert.equal(reads, 0);
});

test('requires the frozen packet-A admitted binding and snapshots results independently of host evidence', async () => {
    const composer = createHostLocalOcrReceiptProvenanceComposer();
    const admission = await admit('ollama_ocr');
    const mutableAdmission = { ...admission, binding: { ...admission.binding }, readiness: { ...admission.readiness } };
    assert.deepEqual(composer.compose({ admission: mutableAdmission, receipt: receipt('ollama_ocr'), provenance: provenance('ollama_ocr') }), deny('admission_invalid'));

    const hostReceipt = receipt('ollama_ocr');
    const hostProvenance = provenance('ollama_ocr');
    const result = composer.compose({ admission, receipt: hostReceipt, provenance: hostProvenance });
    assert.equal(result.status, 'composed');
    hostReceipt.provider = 'apple_vision';
    hostProvenance.receiptProvider = 'apple_vision';
    assert.equal(result.status === 'composed' && result.receipt.provider, 'ollama_ocr');
    assert.equal(result.status === 'composed' && result.provenance.receiptProvider, 'ollama_ocr');
});
