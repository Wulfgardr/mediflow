/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { MiniTransport } from './cli';
import { adaptMiniTransportToHeadlessRequest, HeadlessIntentAdapterError } from './headless-intent-adapter';

const transport = (command: string): MiniTransport => ({
    format: 'json',
    request: {
        command,
        args: {
            intent: 'synthetic: summarize the selected fixture',
            requestRef: 'req_opaque0001',
            idempotencyRef: 'idem_opaque0001',
        },
    },
});

test('maps the named chat transport command to a frozen P3 request', () => {
    const result = adaptMiniTransportToHeadlessRequest(transport('headless.intent.chat'));
    assert.deepEqual(result, {
        adapterKind: 'chat',
        intent: 'synthetic: summarize the selected fixture',
        requestRef: 'req_opaque0001',
        idempotencyRef: 'idem_opaque0001',
    });
    assert.equal(Object.isFrozen(result), true);
});

test('maps the named voice command without caller-supplied authority', () => {
    const result = adaptMiniTransportToHeadlessRequest(transport('headless.intent.voice'));
    assert.equal(result.adapterKind, 'voice');
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.deepEqual(Object.keys(result).sort(), ['adapterKind', 'idempotencyRef', 'intent', 'requestRef']);
});

test('detaches the frozen result from later opaque argument mutation', () => {
    const value = transport('headless.intent.chat') as any;
    const result = adaptMiniTransportToHeadlessRequest(value);
    value.request.args.intent = 'synthetic: later mutation';
    value.request.args.requestRef = 'req_opaque0002';
    assert.equal(result.intent, 'synthetic: summarize the selected fixture');
    assert.equal(result.requestRef, 'req_opaque0001');
    assert.throws(() => { (result as any).intent = 'synthetic: forged'; }, TypeError);
});

function rejects(value: unknown): void {
    assert.throws(() => adaptMiniTransportToHeadlessRequest(value as MiniTransport), HeadlessIntentAdapterError);
}

test('rejects unknown commands, duplicate kinds, and closed-record violations', () => {
    rejects(transport('headless.intent.other'));
    for (const kind of ['chat', 'voice']) {
        const duplicate = transport('headless.intent.chat') as any;
        duplicate.request.args.adapterKind = kind;
        rejects(duplicate);
    }
    const extra = transport('headless.intent.chat') as any;
    extra.request.args.extra = 'forged'; rejects(extra);
    const symbol = transport('headless.intent.chat') as any;
    symbol[Symbol('authority')] = true; rejects(symbol);
    const sparse = [] as unknown[]; sparse.length = 1; rejects(sparse);
    rejects(Promise.resolve(transport('headless.intent.chat')));
    const thenable = { ...transport('headless.intent.chat'), then: () => undefined };
    rejects(thenable);
    const accessor = transport('headless.intent.chat') as any; let reads = 0;
    Object.defineProperty(accessor.request.args, 'intent', { enumerable: true, get: () => { reads += 1; return 'synthetic: trapped'; } });
    rejects(accessor); assert.equal(reads, 0);
});

test('rejects hostile record boundaries without reading accessors', () => {
    const envelopeProxy = new Proxy(transport('headless.intent.chat'), {});
    rejects(envelopeProxy);
    const requestProxy = transport('headless.intent.chat') as any;
    requestProxy.request = new Proxy(requestProxy.request, {}); rejects(requestProxy);
    const argsProxy = transport('headless.intent.chat') as any;
    argsProxy.request.args = new Proxy(argsProxy.request.args, {}); rejects(argsProxy);
    const customPrototype = Object.create({ inherited: true });
    Object.assign(customPrototype, transport('headless.intent.chat')); rejects(customPrototype);
    const nullPrototype = Object.create(null);
    Object.assign(nullPrototype, transport('headless.intent.chat')); rejects(nullPrototype);
    const sparseArgs = transport('headless.intent.chat') as any;
    sparseArgs.request.args = new Array(3); rejects(sparseArgs);
    const requestThenable = transport('headless.intent.chat') as any;
    requestThenable.request = Promise.resolve(requestThenable.request); rejects(requestThenable);
});

test('rejects revoked and trap-only proxies before any proxy trap', () => {
    const revocable = Proxy.revocable(transport('headless.intent.chat'), {});
    revocable.revoke();
    rejects(revocable.proxy);

    let traps = 0;
    const trap = (): never => {
        traps += 1;
        throw new Error('proxy trap touched');
    };
    const throwingProxy = new Proxy(transport('headless.intent.chat'), {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
    });
    rejects(throwingProxy);
    assert.equal(traps, 0);
});

test('enforces the synthetic intent and opaque-reference P3 limits', () => {
    for (const intent of [
        'free prompt', 'patient summary', 'synthetic: access patient', 'synthetic: choose provider',
        'synthetic: use session role', 'synthetic: execute SQL', 'synthetic: write apply',
        `synthetic: ${'x'.repeat(150)}`,
    ]) {
        const value = transport('headless.intent.chat') as any;
        value.request.args.intent = intent;
        rejects(value);
    }
    for (const ref of ['', 'opaque0001', 'patient_opaque0001', 'clinical_opaque0001', 'req_x']) {
        const value = transport('headless.intent.chat') as any;
        value.request.args.requestRef = ref;
        rejects(value);
    }
    for (const key of ['authority', 'session', 'role', 'patient', 'provider', 'venue', 'egress', 'prompt', 'sql', 'sqlite', 'write', 'apply']) {
        const value = transport('headless.intent.chat') as any;
        value.request.args[key] = 'caller-choice';
        rejects(value);
    }
});

test('rejects forbidden intent tokens with case and underscore separators without substring false positives', () => {
    for (const intent of [
        'synthetic: clinical summary',
        'synthetic: clinical_summary',
        'synthetic: patient_summary',
        'synthetic: FREE_PROMPT',
        'synthetic: PROVIDER_STATUS',
    ]) {
        const value = transport('headless.intent.chat') as any;
        value.request.args.intent = intent;
        rejects(value);
    }
    for (const intent of [
        'synthetic: patiently providerish clinicality',
        'synthetic: riassumi la pressione arteriosa',
    ]) {
        const value = transport('headless.intent.chat') as any;
        value.request.args.intent = intent;
        assert.doesNotThrow(() => adaptMiniTransportToHeadlessRequest(value));
    }
});

test('requires stable NFKC Latin input with bounded punctuation and no controls or confusables', () => {
    const accepted = transport('headless.intent.chat') as any;
    accepted.request.args.intent = 'synthetic: riassumi l’anamnesi clinica – 2026';
    assert.equal(adaptMiniTransportToHeadlessRequest(accepted).intent, accepted.request.args.intent);

    for (const intent of [
        'synthetic: provіder',
        'synthetic: testo\u202E provider',
        'synthetic: ｒiassumi la fonte',
        'synthetic: riassum\u0065\u0301 la fonte',
    ]) {
        const value = transport('headless.intent.chat') as any;
        value.request.args.intent = intent;
        rejects(value);
    }
});

test('documents duplicate raw JSON keys as an upstream P4a parser boundary', () => {
    // P4b accepts an already-parsed object; raw duplicate-key detection belongs to P4a.
    const parsed = JSON.parse(`{"format":"json","request":{"command":"headless.intent.chat","args":{"intent":"synthetic: first","requestRef":"req_opaque0001","idempotencyRef":"idem_opaque0001"},"args":{"intent":"synthetic: riassumi la fonte","requestRef":"req_opaque0001","idempotencyRef":"idem_opaque0001"}}}`) as MiniTransport;
    assert.equal(adaptMiniTransportToHeadlessRequest(parsed).intent, 'synthetic: riassumi la fonte');
});
