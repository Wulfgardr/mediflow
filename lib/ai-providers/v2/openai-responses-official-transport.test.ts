/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAbsentProviderLifecycleV2, transitionProviderLifecycleV2 } from './provider-lifecycle.ts';
import { createProviderSecretBrokerV2 } from './provider-secret-broker.ts';
import { executeOpenAIResponsesV2, OpenAIResponsesV2Error } from './openai-responses-adapter.ts';
import {
    createOpenAIResponsesOfficialHttpsTransport,
    OPENAI_RESPONSES_OFFICIAL_MAX_REQUEST_BYTES,
    OPENAI_RESPONSES_OFFICIAL_URL,
} from './openai-responses-official-transport.ts';

const SECRET = 'sk-proj-SYNTHETIC_OPENAI_SENTINEL_0123456789';
const BINDING = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-binding.v2', operation: 'document_synthesis', providerId: 'openai',
    kind: 'cloud', venue: 'cloud', model: 'gpt-5.4-mini', dataClass: 'synthetic_nonclinical',
    egressProfileRef: 'egress.synthetic.v1', retentionProfileRef: 'retention.standard.v1', consentRef: null,
    timeoutMs: 1_000, maxInputBytes: 4_096, maxOutputBytes: 16_384, fallback: 'none',
});
const EVIDENCE = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-policy-evidence.v2', egressProfileRef: BINDING.egressProfileRef,
    retentionProfileRef: BINDING.retentionProfileRef, consentRef: null, egressPromoted: false,
    retentionEligible: false, consentCurrent: false, redactionReceiptSha256: null,
});
const RESPONSE = Object.freeze({
    id: 'resp_official_synthetic_1', object: 'response', status: 'completed', model: 'gpt-5.4-mini',
    output: [Object.freeze({
        id: 'msg_official_synthetic_1', type: 'message', status: 'completed', role: 'assistant',
        content: [Object.freeze({ type: 'output_text', text: 'Synthetic official response.', annotations: [] })],
    })],
    usage: Object.freeze({ input_tokens: 8, input_tokens_details: { cached_tokens: 0 }, output_tokens: 4,
        output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 12 }),
});

function enabled() {
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), {
        type: 'configure', binding: BINDING,
    });
    return transitionProviderLifecycleV2(
        transitionProviderLifecycleV2(configured, { type: 'validate' }),
        { type: 'enable' },
    );
}

function transportRequest(overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        target: 'openai.responses.v1.official_api', method: 'POST',
        headers: new Headers({
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/json',
            'User-Agent': 'MediFlow/0.8.5 provider-v2',
        }),
        body: JSON.stringify({
            model: 'gpt-5.4-mini', input: 'Synthetic transport request.', store: false, background: false,
        }),
        signal: new AbortController().signal,
        maxResponseBytes: 16_384,
        ...overrides,
    });
}

test('fissa URL, metodo, redirect e policy fetch senza accettare endpoint caller-supplied', async () => {
    let calls = 0;
    let retainedHeaders: Headers | undefined;
    const transport = createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
        fetch: async (url: string, init: RequestInit) => {
            calls += 1;
            assert.equal(url, OPENAI_RESPONSES_OFFICIAL_URL);
            assert.equal(init.method, 'POST');
            assert.equal(init.redirect, 'error');
            assert.equal(init.credentials, 'omit');
            assert.equal(init.cache, 'no-store');
            assert.equal(init.referrerPolicy, 'no-referrer');
            assert.equal(init.keepalive, false);
            assert.equal(init.signal instanceof AbortSignal, true);
            assert.equal(typeof init.body, 'string');
            retainedHeaders = init.headers as Headers;
            assert.equal(retainedHeaders.get('authorization'), `Bearer ${SECRET}`);
            assert.equal(retainedHeaders.get('content-type'), 'application/json');
            assert.equal(retainedHeaders.get('user-agent'), 'MediFlow/0.8.5 provider-v2');
            return new Response(JSON.stringify(RESPONSE), { status: 200 });
        },
    }));
    const request = transportRequest();
    const result = await transport(request as never);

    assert.deepEqual(result, { status: 200, body: JSON.stringify(RESPONSE) });
    assert.equal(calls, 1);
    assert.equal((request.headers as Headers).get('authorization'), null);
    assert.equal(retainedHeaders?.get('authorization'), null);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('compone Responses con il transport ufficiale e deriva receipt soltanto dal successo validato', async () => {
    let calls = 0;
    const transport = createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
        fetch: async () => {
            calls += 1;
            return new Response(JSON.stringify(RESPONSE), { status: 200 });
        },
    }));
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET });
    const ticks = [1_000, 1_021];
    const result = await executeOpenAIResponsesV2({
        lifecycle: enabled(), evidence: EVIDENCE, secretRef: Object.freeze({ scheme: 'env', name: 'OPENAI_API_KEY' }),
        broker, input: 'Synthetic non-clinical request.', now: () => ticks.shift(), transport,
    });

    assert.equal(result.outputText, 'Synthetic official response.');
    assert.equal(result.receipt.providerId, 'openai');
    assert.equal(result.receipt.vendorRequestId, 'resp_official_synthetic_1');
    assert.equal(result.receipt.latencyMs, 21);
    assert.equal(calls, 1);
});

test('nega request ostili, modello e header extra prima di invocare fetch', async () => {
    let calls = 0;
    const transport = createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
        fetch: async () => { calls += 1; return new Response('{}', { status: 200 }); },
    }));
    const extraHeaders = new Headers((transportRequest().headers as Headers));
    const callerEndpoint = ['https:', '', 'synthetic.invalid'].join('/');
    extraHeaders.set('x-caller-endpoint', callerEndpoint);
    const badBody = JSON.stringify({
        model: 'caller-model', input: 'Synthetic.', store: false, background: false,
    });
    const oversizedBody = JSON.stringify({
        model: 'gpt-5.4-mini', input: 'x'.repeat(OPENAI_RESPONSES_OFFICIAL_MAX_REQUEST_BYTES),
        store: false, background: false,
    });
    const badRequests = [
        transportRequest({ target: 'caller.endpoint' }),
        transportRequest({ method: 'GET' }),
        transportRequest({ url: callerEndpoint }),
        transportRequest({ headers: extraHeaders }),
        transportRequest({ body: badBody }),
        transportRequest({ body: oversizedBody }),
        transportRequest({ maxResponseBytes: 262_145 }),
        new Proxy(transportRequest(), {}),
    ];
    for (const request of badRequests) {
        await assert.rejects(transport(request as never), /OpenAI official HTTPS transport rejected/u);
    }
    assert.equal(calls, 0);
});

test('limita lo stream di risposta a maxResponseBytes piu un solo byte sentinel', async () => {
    const maxResponseBytes = 64;
    const transport = createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
        fetch: async () => new Response(new Uint8Array(maxResponseBytes + 2_048), { status: 200 }),
    }));
    const result = await transport(transportRequest({ maxResponseBytes }) as never) as { status: number; body: string };
    assert.equal(result.status, 200);
    assert.equal(Buffer.byteLength(result.body, 'utf8'), maxResponseBytes + 1);
});

test('nega abort, risposte non native e failure fetch con errore sanitizzato', async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const transport = createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
        fetch: async () => { calls += 1; throw new Error(`vendor failure ${SECRET}`); },
    }));
    await assert.rejects(transport(transportRequest({ signal: controller.signal }) as never),
        (error: unknown) => error instanceof Error && !error.message.includes(SECRET));
    assert.equal(calls, 0);

    const failing = createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
        fetch: async () => { calls += 1; throw new Error(`vendor failure ${SECRET}`); },
    }));
    const failingRequest = transportRequest();
    await assert.rejects(failing(failingRequest as never),
        (error: unknown) => error instanceof Error && !error.message.includes(SECRET));
    assert.equal((failingRequest.headers as Headers).get('authorization'), null);
    const malformed = createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
        fetch: async () => ({ status: 200, body: '{}' } as never),
    }));
    await assert.rejects(malformed(transportRequest() as never), /OpenAI official HTTPS transport rejected/u);
});

test('l adapter nega lifecycle non enabled senza egress implicito', async () => {
    let calls = 0;
    const transport = createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
        fetch: async (_url: string, init: RequestInit) => {
            calls += 1;
            await new Promise<void>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
            throw new Error('unreachable');
        },
    }));
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET });
    await assert.rejects(executeOpenAIResponsesV2({
        lifecycle: transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding: BINDING }),
        evidence: EVIDENCE, secretRef: Object.freeze({ scheme: 'env', name: 'OPENAI_API_KEY' }), broker,
        input: 'Synthetic disabled.', now: () => 1_000, transport,
    }), (error: unknown) => error instanceof OpenAIResponsesV2Error && error.code === 'provider_disabled');
    assert.equal(calls, 0);
});
