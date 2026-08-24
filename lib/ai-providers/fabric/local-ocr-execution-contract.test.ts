/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostLocalOcrAdmissionService } from './local-ocr-host-admission.ts';
import { createHostLocalOcrReceiptProvenanceComposer } from './local-ocr-receipt-provenance-composer.ts';
import { createLocalOcrExecutionContract } from './local-ocr-execution-contract.ts';

type Provider = 'ollama_ocr' | 'apple_vision';

const venue = (provider: Provider) => provider === 'ollama_ocr' ? 'local_process' : 'on_device';
const policy = (provider: Provider) => ({ provider, venue: venue(provider), egress: 'none', authority: 'review_only', applyPolicy: 'none' });
const readiness = (provider: Provider) => ({ provider, venue: venue(provider), state: 'available' });
const receipt = (provider: Provider) => ({ schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1', provider, venue: venue(provider), egress: 'none', authority: 'review_only', applyPolicy: 'none', writesPerformed: 0 });
const provenance = (provider: Provider) => ({ schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1', provider, venue: venue(provider), egress: 'none', receiptProvider: provider });

async function composed(provider: Provider) {
    const admission = await createHostLocalOcrAdmissionService({
        readPolicy: async () => policy(provider), readReadiness: async () => readiness(provider),
    }).admit();
    return createHostLocalOcrReceiptProvenanceComposer().compose({ admission, receipt: receipt(provider), provenance: provenance(provider) });
}

const image = (overrides: Record<string, unknown> = {}) => ({ source: 'host_attachment', mimeType: 'image/png', payload: 'c3ludGhldGljLW9jci1pbWFnZQ==', ...overrides });
const success = (text = 'synthetic OCR text') => ({ kind: 'success', text });
const failure = () => ({ kind: 'failure' });
const request = async (provider: Provider, overrides: Record<string, unknown> = {}) => ({
    evidence: await composed(provider), image: image(), mode: 'full', outcome: success(), ...overrides,
});
const denied = (code: string) => ({ status: 'denied', code, binding: null, mode: null, output: null, receipt: null, provenance: null, fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0 });
const failed = () => ({ status: 'failed', code: 'provider_failure', binding: null, mode: null, output: null, receipt: null, provenance: null, fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0 });

test('freezes a provider- and venue-bound minimal OCR result from exact composed OCR-B evidence', async () => {
    const contract = createLocalOcrExecutionContract();
    for (const provider of ['ollama_ocr', 'apple_vision'] as const) {
        const input = await request(provider, { mode: 'labs' });
        const result = contract.freeze(input);
        assert.deepEqual(result, {
            status: 'succeeded', code: null, binding: { provider, venue: venue(provider), egress: 'none' }, mode: 'labs',
            output: { kind: 'plain_text', text: 'synthetic OCR text' }, receipt: receipt(provider), provenance: provenance(provider),
            fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0,
        });
        assert.ok(Object.isFrozen(result));
        assert.ok(Object.isFrozen(result.binding));
        assert.ok(Object.isFrozen(result.output));
        assert.ok(Object.isFrozen(result.receipt));
        assert.ok(Object.isFrozen(result.provenance));
    }
});

test('allows only full, patient, and labs modes with PNG, JPEG, or WebP payloads under the canonical byte limit', async () => {
    const contract = createLocalOcrExecutionContract();
    assert.deepEqual(image(), { source: 'host_attachment', mimeType: 'image/png', payload: 'c3ludGhldGljLW9jci1pbWFnZQ==' });
    for (const mode of ['full', 'patient', 'labs']) assert.equal(contract.freeze(await request('ollama_ocr', { mode })).status, 'succeeded');
    for (const mimeType of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(contract.freeze(await request('ollama_ocr', { image: image({ mimeType }) })).status, 'succeeded');
    for (const badImage of [image({ source: 'synthetic_fixture' }), image({ source: 'caller_source' }), image({ attachmentId: 'synthetic-id' }), image({ sourceMetadata: { documentId: 'synthetic-id' } }), image({ payload: '' }), image({ payload: 'not-base64' }), image({ payload: 'ENC:abc=:def=' }), image({ mimeType: 'application/pdf' }), image({ payload: 'A'.repeat(26 * 1024 * 1024) })]) {
        assert.deepEqual(contract.freeze(await request('ollama_ocr', { image: badImage })), denied('request_invalid'));
    }
    assert.deepEqual(contract.freeze(await request('ollama_ocr', { mode: 'other' })), denied('request_invalid'));
});

test('denies non-composed or mutable OCR-B evidence, cross-provider evidence, caller authority, and hostile descriptors', async () => {
    const contract = createLocalOcrExecutionContract();
    const valid = await request('ollama_ocr');
    const mutableEvidence = { ...valid.evidence, binding: { ...valid.evidence.binding }, receipt: { ...valid.evidence.receipt }, provenance: { ...valid.evidence.provenance } };
    let accessorReads = 0;
    const accessor = { ...valid };
    Object.defineProperty(accessor, 'mode', { enumerable: true, get: () => { accessorReads += 1; return 'full'; } });
    const nonEnumerable = { ...valid };
    Object.defineProperty(nonEnumerable, 'mode', { enumerable: false, value: 'full' });
    const symbolInput = { ...valid, [Symbol('provider')]: 'apple_vision' };
    const proxy = new Proxy(valid, {});
    const prototypeInput = Object.assign(Object.create({ inherited: true }), valid);
    const sparse: unknown[] = [];
    sparse[1] = 'synthetic';
    const crossProviderEvidence = Object.freeze({
        ...valid.evidence,
        receipt: Object.freeze({ ...valid.evidence.receipt, provider: 'apple_vision' }),
    });
    assert.deepEqual(contract.freeze({ ...valid, evidence: mutableEvidence }), denied('evidence_invalid'));
    assert.deepEqual(contract.freeze({ ...valid, evidence: crossProviderEvidence }), denied('evidence_invalid'));
    for (const input of [
        { ...valid, provider: 'apple_vision' },
        { ...valid, model: 'caller-selected' },
        { ...valid, url: 'http://localhost' },
        { ...valid, prompt: 'caller text' },
        { ...valid, patientId: 'synthetic-patient' },
        { ...valid, authority: 'apply' },
        { ...valid, role: 'physician' },
        { ...valid, venue: 'on_device' },
        { ...valid, egress: 'network' },
        { ...valid, fallback: 'apple_vision' },
        { ...valid, writesPerformed: 1 },
        { ...valid, applyPolicy: 'apply' },
        { ...valid, abort: true },
        accessor,
        nonEnumerable,
        symbolInput,
        proxy,
        prototypeInput,
        sparse,
    ]) assert.deepEqual(contract.freeze(input), denied('request_invalid'));
    assert.equal(accessorReads, 0);
});

test('rejects transparent and throwing request or nested evidence proxies before traps', async () => {
    const contract = createLocalOcrExecutionContract();
    const valid = await request('ollama_ocr');
    const composedEvidence = valid.evidence;
    if (composedEvidence.status !== 'composed') assert.fail('expected composed synthetic evidence');
    const counters = { request: 0, evidence: 0, binding: 0, receipt: 0, provenance: 0, image: 0, outcome: 0 };
    const wrap = <T extends object>(value: T, key: keyof typeof counters, throwing: boolean) => new Proxy(value, {
        get: (target, property, receiver) => { counters[key] += 1; if (throwing) throw new Error('must not read'); return Reflect.get(target, property, receiver); },
        getOwnPropertyDescriptor: (target, property) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.getOwnPropertyDescriptor(target, property); },
        getPrototypeOf: (target) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.getPrototypeOf(target); },
        isExtensible: (target) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.isExtensible(target); },
        ownKeys: (target) => { counters[key] += 1; if (throwing) throw new Error('must not reflect'); return Reflect.ownKeys(target); },
    });
    for (const throwing of [false, true]) {
        assert.deepEqual(contract.freeze(wrap(valid, 'request', throwing)), denied('request_invalid'));
        assert.deepEqual(contract.freeze({ ...valid, evidence: wrap(composedEvidence, 'evidence', throwing) }), denied('evidence_invalid'));
        for (const key of ['binding', 'receipt', 'provenance'] as const) {
            const nestedEvidence: Readonly<Record<string, unknown>> = Object.freeze({ ...composedEvidence, [key]: wrap(composedEvidence[key], key, throwing) });
            assert.deepEqual(contract.freeze({ ...valid, evidence: nestedEvidence }), denied('evidence_invalid'));
        }
        assert.deepEqual(contract.freeze({ ...valid, image: wrap(valid.image, 'image', throwing) }), denied('request_invalid'));
        assert.deepEqual(contract.freeze({ ...valid, outcome: wrap(valid.outcome, 'outcome', throwing) }), denied('outcome_invalid'));
    }
    assert.deepEqual(counters, { request: 0, evidence: 0, binding: 0, receipt: 0, provenance: 0, image: 0, outcome: 0 });
});

test('uses fixed sanitized failure and provider-specific output ceilings without structured extraction or fallback', async () => {
    const contract = createLocalOcrExecutionContract();
    assert.deepEqual(contract.freeze(await request('apple_vision', { outcome: failure() })), failed());
    assert.deepEqual(contract.freeze(await request('apple_vision', { outcome: { kind: 'success', text: 'text', fields: [{ name: 'diagnosis' }] } })), denied('outcome_invalid'));
    assert.equal(contract.freeze(await request('ollama_ocr', { outcome: success('a'.repeat(64 * 1024)) })).status, 'succeeded');
    assert.deepEqual(contract.freeze(await request('ollama_ocr', { outcome: success('a'.repeat(64 * 1024 + 1)) })), denied('outcome_invalid'));
    assert.equal(contract.freeze(await request('apple_vision', { outcome: success('a'.repeat(32 * 1024)) })).status, 'succeeded');
    assert.deepEqual(contract.freeze(await request('apple_vision', { outcome: success('a'.repeat(32 * 1024 + 1)) })), denied('outcome_invalid'));
});

test('copies accepted OCR output and evidence identity so later input mutation cannot change a frozen result', async () => {
    const contract = createLocalOcrExecutionContract();
    const input = await request('ollama_ocr');
    const result = contract.freeze(input);
    assert.equal(result.status, 'succeeded');
    input.outcome.text = 'changed';
    assert.equal(result.status === 'succeeded' && result.output.text, 'synthetic OCR text');
    assert.equal(result.status === 'succeeded' && result.receipt.provider, 'ollama_ocr');
    assert.throws(() => { (result as { status: string }).status = 'failed'; }, TypeError);
});
