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
