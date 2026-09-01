/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAbsentProviderLifecycleV2, transitionProviderLifecycleV2 } from './provider-lifecycle.ts';
import { poweredByFromProviderReceiptV2 } from './provider-operation-policy.ts';
import { createProviderSecretBrokerV2 } from './provider-secret-broker.ts';
import { AnthropicMessagesV2Error, executeAnthropicMessagesV2 } from './anthropic-messages-adapter.ts';

const SECRET = 'sk-ant-api03-SYNTHETIC_ANTHROPIC_SENTINEL_0123456789';
const BINDING = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-binding.v2', operation: 'document_synthesis', providerId: 'anthropic',
    kind: 'cloud', venue: 'cloud', model: 'claude-sonnet-4-6', dataClass: 'synthetic_nonclinical',
    egressProfileRef: 'egress.synthetic.v1', retentionProfileRef: 'retention.standard.v1', consentRef: null,
    timeoutMs: 1_000, maxInputBytes: 4_096, maxOutputBytes: 16_384, fallback: 'none',
});
const EVIDENCE = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-policy-evidence.v2', egressProfileRef: BINDING.egressProfileRef,
    retentionProfileRef: BINDING.retentionProfileRef, consentRef: null, egressPromoted: false,
    retentionEligible: false, consentCurrent: false, redactionReceiptSha256: null,
});
const SECRET_REF = Object.freeze({ scheme: 'env', name: 'ANTHROPIC_API_KEY' });
const RESPONSE = Object.freeze({
    id: 'msg_synthetic_1', type: 'message', role: 'assistant', model: BINDING.model,
    content: [Object.freeze({ type: 'text', text: 'Synthetic response.' })], stop_reason: 'end_turn',
    stop_sequence: null, usage: Object.freeze({ input_tokens: 9, output_tokens: 4 }),
});

function enabled(binding: unknown = BINDING) {
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding });
    return transitionProviderLifecycleV2(transitionProviderLifecycleV2(configured, { type: 'validate' }), { type: 'enable' });
}

test('esegue Messages official_api con modello host-owned e receipt solo dopo validazione', async () => {
    let envReads = 0; let transportCalls = 0; const ticks = [1_000, 1_025];
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } });
    const result = await executeAnthropicMessagesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker, input: 'Synthetic non-clinical request.', now: () => ticks.shift(), transport: async (request) => {
            transportCalls += 1;
            assert.equal(request.target, 'anthropic.messages.v1.official_api');
            assert.equal('url' in request, false);
            assert.equal(request.method, 'POST');
            assert.equal(request.headers.get('x-api-key'), SECRET);
            assert.equal(request.headers.get('anthropic-version'), '2023-06-01');
            assert.equal(request.headers.get('anthropic-beta'), null);
            assert.equal(request.headers.get('content-type'), 'application/json');
            assert.equal(JSON.stringify(request).includes(SECRET), false);
            assert.deepEqual(JSON.parse(request.body), {
                model: BINDING.model, max_tokens: 1_024,
                messages: [{ role: 'user', content: 'Synthetic non-clinical request.' }],
            });
            assert.equal(request.maxResponseBytes, 16_384);
            return { status: 200, body: JSON.stringify(RESPONSE) };
        } });

    assert.equal(result.outputText, 'Synthetic response.');
    assert.equal(result.receipt.providerId, 'anthropic');
    assert.equal(result.receipt.model, BINDING.model);
    assert.equal(result.receipt.vendorRequestId, 'msg_synthetic_1');
    assert.equal(result.receipt.tokensIn, 9);
    assert.equal(result.receipt.tokensOut, 4);
    assert.equal(result.receipt.latencyMs, 25);
    assert.equal(result.receipt.completedAt, '1970-01-01T00:00:01.025Z');
    assert.equal(poweredByFromProviderReceiptV2(result.receipt), 'Powered by Anthropic');
    const receiptJson = JSON.stringify(result.receipt);
    assert.equal(receiptJson.includes(SECRET), false);
    assert.equal(receiptJson.includes('Synthetic non-clinical request.'), false);
    assert.equal(receiptJson.includes('Synthetic response.'), false);
    assert.deepEqual([envReads, transportCalls], [1, 1]);
});

test('nega policy, lifecycle e provider invalidi prima di leggere il secret', async () => {
    let envReads = 0; let transportCalls = 0;
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } });
    const run = (lifecycle: unknown, evidence: unknown = EVIDENCE) => executeAnthropicMessagesV2({
        lifecycle, evidence, secretRef: SECRET_REF, broker, input: 'Synthetic request.', now: () => 1_000,
        transport: async () => { transportCalls += 1; return { status: 500, body: '' }; },
    });

    await assert.rejects(run(enabled({ ...BINDING, dataClass: 'clinical_identifiable' })),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'data_class_forbidden');
    await assert.rejects(run(enabled({ ...BINDING, providerId: 'openai' })),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'provider_disabled');
    await assert.rejects(run({ status: 'enabled' }),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    await assert.rejects(run(enabled(), { ...EVIDENCE, retentionProfileRef: 'retention.mismatch.v1' }),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'retention_profile_unsatisfied');
    assert.deepEqual([envReads, transportCalls], [0, 0]);
});

test('rifiuta input accessor, Proxy e Proxy revocati senza eseguire trap, getter o secret', async () => {
    let getterReads = 0; let proxyTraps = 0; let envReads = 0;
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } });
    const base = { lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF, broker,
        input: 'Synthetic hostile input.', now: () => 1_000,
        transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) };
    const accessor = Object.defineProperties({}, {
        lifecycle: { enumerable: true, get() { getterReads += 1; return base.lifecycle; } },
        evidence: { enumerable: true, value: base.evidence }, secretRef: { enumerable: true, value: base.secretRef },
        broker: { enumerable: true, value: base.broker }, input: { enumerable: true, value: base.input },
        now: { enumerable: true, value: base.now }, transport: { enumerable: true, value: base.transport },
    });
    await assert.rejects(executeAnthropicMessagesV2(accessor as never),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    assert.equal(getterReads, 0);

    const proxy = new Proxy(base, { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
    await assert.rejects(executeAnthropicMessagesV2(proxy),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    assert.equal(proxyTraps, 0);

    const revoked = Proxy.revocable(base, {}); revoked.revoke();
    await assert.rejects(executeAnthropicMessagesV2(revoked.proxy as never),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    assert.equal(envReads, 0);
});

test('rifiuta proprieta input richieste non-enumerable prima di secret e transport', async () => {
    let envReads = 0; let transportCalls = 0;
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } });
    const hiddenRequiredInput = Object.defineProperties({}, {
        lifecycle: { enumerable: false, value: enabled() },
        evidence: { enumerable: true, value: EVIDENCE }, secretRef: { enumerable: true, value: SECRET_REF },
        broker: { enumerable: true, value: broker }, input: { enumerable: true, value: 'Synthetic hidden input.' },
        now: { enumerable: true, value: () => 1_000 },
        transport: { enumerable: true, value: async () => {
            transportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) };
        } },
    });
    await assert.rejects(executeAnthropicMessagesV2(hiddenRequiredInput as never),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    assert.deepEqual([envReads, transportCalls], [0, 0]);
});

test('rifiuta accessor annidati in lifecycle, evidence e secretRef prima del secret', async () => {
    let getterReads = 0; let envReads = 0;
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } });
    const state = enabled();
    const lifecycleAccessor = Object.defineProperties({}, {
        schemaVersion: { enumerable: true, value: state.schemaVersion }, generation: { enumerable: true, value: state.generation },
        status: { enumerable: true, value: state.status },
        binding: { enumerable: true, get() { getterReads += 1; return state.binding; } },
    });
    const evidenceAccessor = Object.defineProperties({}, Object.fromEntries(Object.entries(EVIDENCE).map(([key, value]) => [key,
        key === 'retentionProfileRef' ? { enumerable: true, get() { getterReads += 1; return value; } }
            : { enumerable: true, value }]))) as unknown;
    const secretAccessor = Object.defineProperties({}, {
        scheme: { enumerable: true, value: 'env' },
        name: { enumerable: true, get() { getterReads += 1; return 'ANTHROPIC_API_KEY'; } },
    });
    const run = (lifecycle: unknown, evidence: unknown, secretRef: unknown) => executeAnthropicMessagesV2({
        lifecycle, evidence, secretRef, broker, input: 'Synthetic nested-hostile input.', now: () => 1_000,
        transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }),
    });
    for (const values of [
        [lifecycleAccessor, EVIDENCE, SECRET_REF], [state, evidenceAccessor, SECRET_REF], [state, EVIDENCE, secretAccessor],
    ]) await assert.rejects(run(...values as [unknown, unknown, unknown]),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    assert.deepEqual([getterReads, envReads], [0, 0]);
});

test('rifiuta broker accessor o Proxy revocato senza invocare metodi ostili', async () => {
    let getterReads = 0;
    const real = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET });
    const accessor = Object.defineProperties({}, {
        issue: { enumerable: true, get() { getterReads += 1; return real.issue; } },
        snapshot: { enumerable: true, value: real.snapshot }, revoke: { enumerable: true, value: real.revoke },
        consume: { enumerable: true, value: real.consume },
    });
    const base = { lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        input: 'Synthetic broker-boundary request.', now: () => 1_000,
        transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) };
    await assert.rejects(executeAnthropicMessagesV2({ ...base, broker: accessor as never }),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    assert.equal(getterReads, 0);
    const revoked = Proxy.revocable(real, {}); revoked.revoke();
    await assert.rejects(executeAnthropicMessagesV2({ ...base, broker: revoked.proxy }),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
});

test('nega il commit tardivo se transport o clock mutano lifecycle o policy evidence', async () => {
    const mutableLifecycle = structuredClone(enabled()) as unknown as { status: string };
    const mutableEvidence = structuredClone(EVIDENCE) as unknown as { retentionProfileRef: string };
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET });
    await assert.rejects(executeAnthropicMessagesV2({ lifecycle: mutableLifecycle, evidence: mutableEvidence,
        secretRef: SECRET_REF, broker, input: 'Synthetic mutable-state request.', now: () => 1_000,
        transport: async () => {
            mutableLifecycle.status = 'disabled'; mutableEvidence.retentionProfileRef = 'retention.changed.v1';
            return { status: 200, body: JSON.stringify(RESPONSE) };
        } }), (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'provider_disabled');

    const clockLifecycle = structuredClone(enabled()) as unknown as { status: string }; const ticks = [1_000, 1_025];
    await assert.rejects(executeAnthropicMessagesV2({ lifecycle: clockLifecycle, evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic clock-mutation request.', now: () => {
            const value = ticks.shift()!; if (ticks.length === 0) clockLifecycle.status = 'disabled'; return value;
        }, transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) }),
    (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'provider_disabled');
});

test('nega mutazioni da clock iniziale o callback broker prima del transport', async () => {
    let envReads = 0; let transportCalls = 0;
    const clockLifecycle = structuredClone(enabled()) as unknown as { status: string };
    await assert.rejects(executeAnthropicMessagesV2({ lifecycle: clockLifecycle, evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000,
            readEnv: () => { envReads += 1; return SECRET; } }), input: 'Synthetic initial-clock request.',
        now: () => { clockLifecycle.status = 'disabled'; return 1_000; },
        transport: async () => { transportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) }; } }),
    (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'provider_disabled');
    assert.deepEqual([envReads, transportCalls], [0, 0]);

    const brokerLifecycle = structuredClone(enabled()) as unknown as { status: string };
    await assert.rejects(executeAnthropicMessagesV2({ lifecycle: brokerLifecycle, evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000,
            readEnv: () => { envReads += 1; brokerLifecycle.status = 'disabled'; return SECRET; } }),
        input: 'Synthetic broker-callback request.', now: () => 1_000,
        transport: async () => { transportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) }; } }),
    (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'provider_disabled');
    assert.deepEqual([envReads, transportCalls], [1, 0]);

    const consumeLifecycle = structuredClone(enabled()) as unknown as { status: string }; let brokerTicks = 0;
    await assert.rejects(executeAnthropicMessagesV2({ lifecycle: consumeLifecycle, evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => {
            brokerTicks += 1; if (brokerTicks === 2) consumeLifecycle.status = 'disabled'; return 1_000;
        }, readEnv: () => { envReads += 1; return SECRET; } }), input: 'Synthetic consume-clock request.',
        now: () => 1_000, transport: async () => {
            transportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) };
        } }), (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'provider_disabled');
    assert.deepEqual([envReads, transportCalls], [2, 0]);
});

test('nega reentrancy e thenable ostili da transport o broker senza invocarli', async () => {
    let nested: Promise<unknown> | null = null; let ticks = 0;
    const nestedInput = { lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }), input: 'Synthetic nested request.',
        now: () => 1_000, transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) };
    const result = await executeAnthropicMessagesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }), input: 'Synthetic outer request.',
        now: () => { ticks += 1; if (!nested) { nested = executeAnthropicMessagesV2(nestedInput); void nested.catch(() => undefined); }
            return 1_000 + ticks; },
        transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) });
    assert.equal(result.outputText, 'Synthetic response.');
    await assert.rejects(nested!,
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');

    let thenCalls = 0;
    const thenable = Object.freeze({ then(resolve: (value: unknown) => void) {
        thenCalls += 1; resolve({ status: 200, body: JSON.stringify(RESPONSE) });
    } });
    await assert.rejects(executeAnthropicMessagesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }), input: 'Synthetic thenable request.',
        now: () => 1_000, transport: (() => thenable) as never }),
    (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'response_invalid');
    assert.equal(thenCalls, 0);

    let promiseAccessorReads = 0;
    const hostilePromise = Object.defineProperty(Promise.resolve({ status: 200, body: JSON.stringify(RESPONSE) }),
        'constructor', { get() { promiseAccessorReads += 1; return Promise; } });
    await assert.rejects(executeAnthropicMessagesV2({ ...nestedInput, transport: (() => hostilePromise) as never }),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'response_invalid');
    assert.equal(promiseAccessorReads, 0);

    let brokerThenCalls = 0; let brokerTransportCalls = 0;
    const realBroker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET });
    const hostileBroker = Object.freeze({ issue: realBroker.issue, snapshot: realBroker.snapshot, revoke: realBroker.revoke,
        consume: () => Object.freeze({ then(resolve: (value: unknown) => void) {
            brokerThenCalls += 1; resolve({ ok: true, value: { status: 200, body: JSON.stringify(RESPONSE) } });
        } }) });
    await assert.rejects(executeAnthropicMessagesV2({ ...nestedInput, broker: hostileBroker as never,
        transport: async () => { brokerTransportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) }; } }),
    (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'secret_unavailable');
    assert.deepEqual([brokerThenCalls, brokerTransportCalls], [0, 0]);
});

test('rifiuta signal accessor o Proxy revocato senza getter e prima del secret', async () => {
    let getterReads = 0; let envReads = 0;
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } });
    const base = { lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF, broker,
        input: 'Synthetic signal request.', now: () => 1_000,
        transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) };
    const accessorSignal = Object.defineProperty({}, 'aborted', {
        enumerable: true, get() { getterReads += 1; return false; },
    });
    await assert.rejects(executeAnthropicMessagesV2({ ...base, signal: accessorSignal as never }),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    const revoked = Proxy.revocable(new AbortController().signal, {}); revoked.revoke();
    await assert.rejects(executeAnthropicMessagesV2({ ...base, signal: revoked.proxy }),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'input_invalid');
    assert.deepEqual([getterReads, envReads], [0, 0]);
});

test('termina per timeout e cancellation su Promise pendente, scarta late completion e ritira header secret', async () => {
    const captured = { headers: null as { get(name: string): string | null } | null };
    await assert.rejects(executeAnthropicMessagesV2({ lifecycle: enabled({ ...BINDING, timeoutMs: 1 }), evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic timeout request.', now: () => 1_000, transport: async (request) => {
            captured.headers = request.headers; return new Promise<never>(() => undefined);
        } }), (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'request_timeout');
    assert.equal(captured.headers?.get('x-api-key'), null);

    const controller = new AbortController();
    const cancelled = executeAnthropicMessagesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic cancellation request.', now: () => 1_000,
        transport: async () => new Promise<never>(() => undefined), signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled,
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'request_cancelled');

    const boundary = new AbortController();
    await assert.rejects(executeAnthropicMessagesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic late-completion request.', now: () => 1_000, signal: boundary.signal,
        transport: async () => { boundary.abort(); return { status: 200, body: JSON.stringify(RESPONSE) }; } }),
    (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'request_cancelled');
    assert.equal(poweredByFromProviderReceiptV2(RESPONSE), null);
});

test('mappa status e failure transport senza body, header o secret negli errori', async () => {
    const run = async (transport: Parameters<typeof executeAnthropicMessagesV2>[0]['transport']) => {
        try {
            await executeAnthropicMessagesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
                broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
                input: 'Synthetic error request.', now: () => 1_000, transport });
            assert.fail('expected sanitized failure');
        } catch (error) {
            assert.equal(error instanceof AnthropicMessagesV2Error, true);
            assert.equal(JSON.stringify(error).includes(SECRET), false);
            return (error as AnthropicMessagesV2Error).code;
        }
    };
    for (const [status, code] of [[401, 'auth_rejected'], [403, 'auth_rejected'], [408, 'request_timeout'],
        [429, 'rate_limited'], [529, 'provider_unavailable'], [400, 'response_invalid']] as const) {
        assert.equal(await run(async () => ({ status, body: `SYNTHETIC_VENDOR_BODY_${SECRET}` })), code);
    }
    assert.equal(await run(async () => { throw new Error(`transport ${SECRET}`); }), 'provider_unavailable');
});

test('rifiuta response Messages/content non stretta, oversized o con envelope accessor', async () => {
    let getterReads = 0;
    const execute = (value: unknown, binding: unknown = BINDING) => executeAnthropicMessagesV2({
        lifecycle: enabled(binding), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic strict-response request.', now: () => 1_000, transport: async () => value,
    });
    for (const value of [
        { status: 200, body: 'not-json' },
        { status: 200, body: JSON.stringify({ ...RESPONSE, model: 'caller-model' }) },
        { status: 200, body: JSON.stringify({ ...RESPONSE, rawOutput: 'must-not-cross' }) },
        { status: 200, body: JSON.stringify({ ...RESPONSE, content: [{ type: 'tool_use', id: 'tool_1', name: 'x', input: {} }] }) },
        { status: 200, body: JSON.stringify({ ...RESPONSE, content: [...RESPONSE.content, ...RESPONSE.content] }) },
        { status: 200, body: JSON.stringify({ ...RESPONSE, stop_reason: 'max_tokens' }) },
        { status: 200, body: JSON.stringify({ ...RESPONSE, usage: { input_tokens: 9, output_tokens: 4, authority: true } }) },
        { status: 200, body: JSON.stringify(RESPONSE), headers: { 'request-id': 'forged' } },
    ]) await assert.rejects(execute(value),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'response_invalid');
    await assert.rejects(execute({ status: 200, body: JSON.stringify(RESPONSE) }, { ...BINDING, maxOutputBytes: 32 }),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'response_too_large');
    const accessorEnvelope = Object.defineProperties({}, {
        status: { enumerable: true, value: 200 },
        body: { enumerable: true, get() { getterReads += 1; return JSON.stringify(RESPONSE); } },
    });
    await assert.rejects(execute(accessorEnvelope),
        (error: unknown) => error instanceof AnthropicMessagesV2Error && error.code === 'response_invalid');
    assert.equal(getterReads, 0);
});
