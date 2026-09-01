/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAbsentProviderLifecycleV2, transitionProviderLifecycleV2 } from './provider-lifecycle.ts';
import { poweredByFromProviderReceiptV2 } from './provider-operation-policy.ts';
import { createProviderSecretBrokerV2 } from './provider-secret-broker.ts';
import { executeOpenAIResponsesV2, OpenAIResponsesV2Error } from './openai-responses-adapter.ts';
const SECRET = 'sk-proj-SYNTHETIC_OPENAI_SENTINEL_0123456789';
const BINDING = Object.freeze({ schemaVersion: 'mediflow.ai.provider-binding.v2', operation: 'document_synthesis',
    providerId: 'openai', kind: 'cloud', venue: 'cloud', model: 'gpt-5.4-mini', dataClass: 'synthetic_nonclinical',
    egressProfileRef: 'egress.synthetic.v1', retentionProfileRef: 'retention.standard.v1', consentRef: null,
    timeoutMs: 1_000, maxInputBytes: 4_096, maxOutputBytes: 16_384, fallback: 'none' });
const EVIDENCE = Object.freeze({ schemaVersion: 'mediflow.ai.provider-policy-evidence.v2',
    egressProfileRef: BINDING.egressProfileRef, retentionProfileRef: BINDING.retentionProfileRef, consentRef: null,
    egressPromoted: false, retentionEligible: false, consentCurrent: false, redactionReceiptSha256: null });
const SECRET_REF = Object.freeze({ scheme: 'env', name: 'OPENAI_API_KEY' });
const RESPONSE = Object.freeze({ id: 'resp_synthetic_1', object: 'response', status: 'completed', model: 'gpt-5.4-mini',
    output: [Object.freeze({ id: 'rs_synthetic_1', type: 'reasoning', summary: [], status: 'completed' }),
        Object.freeze({ id: 'msg_synthetic_1', type: 'message', status: 'completed', role: 'assistant',
        content: [Object.freeze({ type: 'output_text', text: 'Synthetic response.', annotations: [] })] })],
    usage: Object.freeze({ input_tokens: 9, input_tokens_details: { cached_tokens: 0 }, output_tokens: 4,
        output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 13 }) });

function enabled(binding: unknown = BINDING) {
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding });
    return transitionProviderLifecycleV2(transitionProviderLifecycleV2(configured, { type: 'validate' }), { type: 'enable' });
}
test('esegue Responses official_api con modello host-owned e receipt dopo validazione', async () => {
    let envReads = 0; let transportCalls = 0; const ticks = [1_000, 1_025];
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } });
    const result = await executeOpenAIResponsesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker, input: 'Synthetic non-clinical request.', now: () => ticks.shift(), transport: async (request) => {
            transportCalls += 1;
            assert.equal(request.target, 'openai.responses.v1.official_api');
            assert.equal('url' in request, false);
            assert.equal(request.method, 'POST');
            assert.equal(request.headers.get('authorization'), `Bearer ${SECRET}`);
            assert.equal(request.headers.get('content-type'), 'application/json');
            assert.equal(JSON.stringify(request).includes(SECRET), false);
            assert.deepEqual(JSON.parse(request.body), { model: 'gpt-5.4-mini', input: 'Synthetic non-clinical request.',
                store: false, background: false });
            assert.equal(request.maxResponseBytes, 16_384);
            return { status: 200, body: JSON.stringify(RESPONSE) };
        } });

    assert.equal(result.outputText, 'Synthetic response.');
    assert.equal(result.receipt.providerId, 'openai');
    assert.equal(result.receipt.model, 'gpt-5.4-mini');
    assert.equal(result.receipt.vendorRequestId, 'resp_synthetic_1');
    assert.equal(result.receipt.tokensIn, 9);
    assert.equal(result.receipt.tokensOut, 4);
    assert.equal(result.receipt.latencyMs, 25);
    assert.equal(result.receipt.completedAt, '1970-01-01T00:00:01.025Z');
    assert.equal(poweredByFromProviderReceiptV2(result.receipt), 'Powered by OpenAI');
    assert.deepEqual([envReads, transportCalls], [1, 1]);
});

test('nega policy e lifecycle invalidi prima di leggere il secret', async () => {
    let envReads = 0; let transportCalls = 0;
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } });
    const run = (lifecycle: unknown) => executeOpenAIResponsesV2({ lifecycle, evidence: EVIDENCE, secretRef: SECRET_REF,
        broker, input: 'Synthetic request.', now: () => 1_000,
        transport: async () => { transportCalls += 1; return { status: 500, body: '' }; } });

    await assert.rejects(run(enabled({ ...BINDING, dataClass: 'clinical_identifiable' })),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'data_class_forbidden');
    await assert.rejects(run({ ...enabled(), binding: { ...BINDING, providerId: 'anthropic' } }),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'provider_disabled');
    await assert.rejects(run({ status: 'enabled' }),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'input_invalid');
    assert.deepEqual([envReads, transportCalls], [0, 0]);
});

test('termina bounded distinguendo timeout e cancellation senza receipt', async () => {
    const makeBroker = () => createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET });
    const stalled = async () => new Promise<never>(() => undefined);
    await assert.rejects(executeOpenAIResponsesV2({ lifecycle: enabled({ ...BINDING, timeoutMs: 1 }), evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: makeBroker(), input: 'Synthetic timeout.', now: () => 1_000, transport: stalled }),
    (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'request_timeout');

    const controller = new AbortController();
    const cancelled = executeOpenAIResponsesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: makeBroker(), input: 'Synthetic cancellation.', now: () => 1_000, transport: stalled, signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled,
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'request_cancelled');
    const boundaryController = new AbortController();
    await assert.rejects(executeOpenAIResponsesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: makeBroker(), input: 'Synthetic late completion.', now: () => 1_000, signal: boundaryController.signal,
        transport: async () => { boundaryController.abort(); return { status: 200, body: JSON.stringify(RESPONSE) }; } }),
    (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'request_cancelled');
    assert.equal(poweredByFromProviderReceiptV2({ status: 'cancelled' }), null);
});

test('mappa status e failure transport senza body, header o secret negli errori', async () => {
    const run = async (transport: Parameters<typeof executeOpenAIResponsesV2>[0]['transport']) => {
        const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET });
        try {
            await executeOpenAIResponsesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
                broker, input: 'Synthetic error request.', now: () => 1_000, transport });
            assert.fail('expected a sanitized failure');
        } catch (error) {
            assert.equal(error instanceof OpenAIResponsesV2Error, true);
            assert.equal(JSON.stringify(error).includes(SECRET), false);
            return (error as OpenAIResponsesV2Error).code;
        }
    };
    for (const [status, code] of [[401, 'auth_rejected'], [429, 'rate_limited'], [500, 'provider_unavailable'],
        [400, 'response_invalid']] as const) {
        assert.equal(await run(async () => ({ status, body: `SYNTHETIC_VENDOR_BODY_${SECRET}` })), code);
    }
    assert.equal(await run(async () => { throw new Error(`transport ${SECRET}`); }), 'provider_unavailable');
});

test('nega input o response oversized, malformed e con chiavi extra senza receipt', async () => {
    let envReads = 0; let transportCalls = 0;
    const makeBroker = () => createProviderSecretBrokerV2({ now: () => 1_000,
        readEnv: () => { envReads += 1; return SECRET; } });
    const execute = (transportValue: unknown, binding: unknown = BINDING) => executeOpenAIResponsesV2({ lifecycle: enabled(binding),
        evidence: EVIDENCE, secretRef: SECRET_REF, broker: makeBroker(), input: 'Synthetic bounded input.', now: () => 1_000,
        transport: async () => { transportCalls += 1; return transportValue; } });
    for (const value of [
        { status: 200, body: 'not-json' },
        { status: 200, body: JSON.stringify({ ...RESPONSE, model: 'caller-model' }) },
        { status: 200, body: JSON.stringify({ ...RESPONSE, rawOutput: 'must-not-cross' }) },
        { status: 200, body: JSON.stringify({ ...RESPONSE, output: [{ ...RESPONSE.output[0], rawText: 'extra' }] }) },
        { status: 200, body: JSON.stringify(RESPONSE), headers: { 'x-request-id': 'forged' } },
    ]) await assert.rejects(execute(value),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'response_invalid');
    await assert.rejects(execute({ status: 200, body: JSON.stringify(RESPONSE) }, { ...BINDING, maxOutputBytes: 32 }),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'response_too_large');

    await assert.rejects(executeOpenAIResponsesV2({ lifecycle: enabled({ ...BINDING, maxInputBytes: 8 }), evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: makeBroker(), input: 'too many synthetic bytes', now: () => 1_000,
        transport: async () => { transportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) }; } }),
    (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'input_invalid');
    assert.deepEqual([envReads, transportCalls], [6, 6]);
    assert.equal(poweredByFromProviderReceiptV2(RESPONSE), null);
});

test('rifiuta accessor transport e clock fuori range senza eseguire getter', async () => {
    let getterReads = 0;
    const accessorEnvelope = Object.defineProperties({}, {
        status: { value: 200, enumerable: true },
        body: { enumerable: true, get: () => { getterReads += 1; return JSON.stringify(RESPONSE); } },
    });
    const run = (transport: Parameters<typeof executeOpenAIResponsesV2>[0]['transport'], now: () => number) => (
        executeOpenAIResponsesV2({ lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
            broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
            input: 'Synthetic hostile-boundary request.', now, transport })
    );

    await assert.rejects(run(async () => accessorEnvelope, () => 1_000),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'response_invalid');
    assert.equal(getterReads, 0);

    const ticks = [1_000, 8_640_000_000_000_001];
    await assert.rejects(run(async () => ({ status: 200, body: JSON.stringify(RESPONSE) }), () => ticks.shift()!),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'response_invalid');
});

test('nega il commit tardivo se transport o clock mutano lifecycle o policy evidence', async () => {
    const mutableLifecycle = structuredClone(enabled()) as unknown as { status: string };
    const mutableEvidence = structuredClone(EVIDENCE) as unknown as { retentionProfileRef: string };
    await assert.rejects(executeOpenAIResponsesV2({ lifecycle: mutableLifecycle, evidence: mutableEvidence,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic mutable-state request.', now: () => 1_000, transport: async () => {
            mutableLifecycle.status = 'disabled'; mutableEvidence.retentionProfileRef = 'retention.changed.v1';
            return { status: 200, body: JSON.stringify(RESPONSE) };
        } }), (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'provider_disabled');

    const clockLifecycle = structuredClone(enabled()) as unknown as { status: string };
    const ticks = [1_000, 1_025];
    await assert.rejects(executeOpenAIResponsesV2({ lifecycle: clockLifecycle, evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic clock-mutation request.', now: () => {
            const value = ticks.shift()!; if (ticks.length === 0) clockLifecycle.status = 'disabled'; return value;
        }, transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) }),
    (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'provider_disabled');
});

test('ritira Authorization su timeout anche se il transport resta pending', async () => {
    let retainedHeaders: Headers | undefined;
    await assert.rejects(executeOpenAIResponsesV2({ lifecycle: enabled({ ...BINDING, timeoutMs: 1 }), evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic timeout request.', now: () => 1_000, transport: async (request) => {
            retainedHeaders = request.headers;
            return new Promise<never>(() => { /* intentionally ignores abort */ });
        } }), (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'request_timeout');
    assert.equal(retainedHeaders?.get('authorization'), null);
});

test('materializza input, lifecycle, evidence, secretRef e broker senza accessor o Proxy', async () => {
    let getterReads = 0; let envReads = 0; let transportCalls = 0;
    const state = enabled();
    const lifecycleAccessor = Object.defineProperties({}, {
        schemaVersion: { enumerable: true, value: state.schemaVersion },
        generation: { enumerable: true, value: state.generation }, status: { enumerable: true, value: state.status },
        binding: { enumerable: true, get() { getterReads += 1; return state.binding; } },
    });
    const evidenceAccessor = Object.defineProperties({}, Object.fromEntries(Object.entries(EVIDENCE).map(([key, value]) => [key,
        key === 'retentionProfileRef' ? { enumerable: true, get() { getterReads += 1; return value; } }
            : { enumerable: true, value }]))) as unknown;
    const secretAccessor = Object.defineProperties({}, {
        scheme: { enumerable: true, value: 'env' },
        name: { enumerable: true, get() { getterReads += 1; return 'OPENAI_API_KEY'; } },
    });
    const realBroker = createProviderSecretBrokerV2({ now: () => 1_000,
        readEnv: () => { envReads += 1; return SECRET; } });
    const brokerAccessor = Object.defineProperties({}, {
        issue: { enumerable: true, get() { getterReads += 1; return realBroker.issue; } },
        snapshot: { enumerable: true, value: realBroker.snapshot }, revoke: { enumerable: true, value: realBroker.revoke },
        consume: { enumerable: true, value: realBroker.consume },
    });
    const transport = async () => { transportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) }; };
    const run = (lifecycle: unknown, evidence: unknown, secretRef: unknown, broker: unknown = realBroker) => (
        executeOpenAIResponsesV2({ lifecycle, evidence, secretRef, broker: broker as never,
            input: 'Synthetic hostile input.', now: () => 1_000, transport })
    );
    const revoked = Proxy.revocable(state, {}); revoked.revoke();
    for (const values of [
        [lifecycleAccessor, EVIDENCE, SECRET_REF], [state, evidenceAccessor, SECRET_REF],
        [state, EVIDENCE, secretAccessor], [state, EVIDENCE, SECRET_REF, brokerAccessor],
        [revoked.proxy, EVIDENCE, SECRET_REF],
    ]) await assert.rejects(run(...values as [unknown, unknown, unknown, unknown]),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'input_invalid');
    assert.deepEqual([getterReads, envReads, transportCalls], [0, 0, 0]);
});

test('rifiuta input root e signal ostili senza eseguire trap, getter o secret', async () => {
    let hostileReads = 0; let envReads = 0;
    const base = { lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { envReads += 1; return SECRET; } }),
        input: 'Synthetic root-boundary request.', now: () => 1_000,
        transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) };
    const proxy = new Proxy(base, {
        get() { hostileReads += 1; throw new Error('get'); },
        ownKeys() { hostileReads += 1; throw new Error('keys'); },
        getPrototypeOf() { hostileReads += 1; throw new Error('prototype'); },
    });
    const accessor = Object.defineProperty({ ...base }, 'input', {
        enumerable: true, get() { hostileReads += 1; return 'Synthetic accessor request.'; },
    });
    const hidden = Object.defineProperty({ ...base }, 'lifecycle', {
        enumerable: false, value: base.lifecycle,
    });
    const signalAccessor = Object.defineProperty({}, 'aborted', {
        enumerable: true, get() { hostileReads += 1; return false; },
    });
    const revoked = Proxy.revocable(new AbortController().signal, {}); revoked.revoke();
    for (const value of [proxy, accessor, hidden, { ...base, signal: signalAccessor }, { ...base, signal: revoked.proxy }]) {
        await assert.rejects(executeOpenAIResponsesV2(value as never),
            (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'input_invalid');
    }
    assert.deepEqual([hostileReads, envReads], [0, 0]);
});

test('nega mutazioni da clock iniziale o callback broker prima del transport', async () => {
    let envReads = 0; let transportCalls = 0;
    const clockLifecycle = structuredClone(enabled()) as unknown as { status: string };
    await assert.rejects(executeOpenAIResponsesV2({ lifecycle: clockLifecycle, evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000,
            readEnv: () => { envReads += 1; return SECRET; } }), input: 'Synthetic initial-clock request.',
        now: () => { clockLifecycle.status = 'disabled'; return 1_000; },
        transport: async () => { transportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) }; } }),
    (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'provider_disabled');
    assert.deepEqual([envReads, transportCalls], [0, 0]);

    const brokerLifecycle = structuredClone(enabled()) as unknown as { status: string };
    await assert.rejects(executeOpenAIResponsesV2({ lifecycle: brokerLifecycle, evidence: EVIDENCE,
        secretRef: SECRET_REF, broker: createProviderSecretBrokerV2({ now: () => 1_000,
            readEnv: () => { envReads += 1; brokerLifecycle.status = 'disabled'; return SECRET; } }),
        input: 'Synthetic broker-callback request.', now: () => 1_000,
        transport: async () => { transportCalls += 1; return { status: 200, body: JSON.stringify(RESPONSE) }; } }),
    (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'provider_disabled');
    assert.deepEqual([envReads, transportCalls], [1, 0]);
});

test('nega reentrancy e thenable transport ostili senza invocarli', async () => {
    const nestedInput = { lifecycle: enabled(), evidence: EVIDENCE, secretRef: SECRET_REF,
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic nested request.', now: () => 1_000,
        transport: async () => ({ status: 200, body: JSON.stringify(RESPONSE) }) };
    let nested: Promise<unknown> | null = null; let ticks = 0;
    const result = await executeOpenAIResponsesV2({ ...nestedInput, input: 'Synthetic outer request.',
        now: () => { ticks += 1; if (!nested) { nested = executeOpenAIResponsesV2(nestedInput); void nested.catch(() => undefined); }
            return 1_000 + ticks; } });
    assert.equal(result.outputText, 'Synthetic response.');
    await assert.rejects(nested!,
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'input_invalid');

    let thenCalls = 0;
    const thenable = Object.freeze({ then(resolve: (value: unknown) => void) {
        thenCalls += 1; resolve({ status: 200, body: JSON.stringify(RESPONSE) });
    } });
    await assert.rejects(executeOpenAIResponsesV2({ ...nestedInput, transport: (() => thenable) as never }),
        (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'response_invalid');
    assert.equal(thenCalls, 0);
});
