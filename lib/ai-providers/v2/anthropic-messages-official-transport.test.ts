/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeAnthropicMessagesV2 } from './anthropic-messages-adapter.ts';
import {
    ANTHROPIC_MESSAGES_OFFICIAL_MAX_REQUEST_BYTES,
    ANTHROPIC_MESSAGES_OFFICIAL_URL,
    createAnthropicMessagesOfficialHttpsTransport,
} from './anthropic-messages-official-transport.ts';
import { createAbsentProviderLifecycleV2, transitionProviderLifecycleV2 } from './provider-lifecycle.ts';
import { createProviderSecretBrokerV2 } from './provider-secret-broker.ts';

const SECRET = 'sk-ant-api03-SYNTHETIC_ANTHROPIC_SENTINEL_0123456789';
const INSTANCE_REF = 'pvi_0123456789abcdef0123456789abcdef';
const WORKSPACE_REF = 'pws_0123456789abcdef0123456789abcdef';
const WORKSPACE_ID = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';
const PROFILE = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-instance-profile.v2', providerType: 'anthropic',
    providerInstance: Object.freeze({ instanceRef: INSTANCE_REF, workspaceRef: WORKSPACE_REF }),
    auth: Object.freeze({ schemaVersion: 'mediflow.ai.provider-auth-policy.v2', credentialClass: 'api_key',
        authRef: 'par_0123456789abcdef0123456789abcdef' }),
    model: 'claude-sonnet-4-6', capabilities: Object.freeze(['document_synthesis']),
    groups: Object.freeze(['group.review-only.v1']),
    bindings: Object.freeze([Object.freeze({ operation: 'document_synthesis', groupRef: 'group.review-only.v1' })]),
    functionAllowlist: Object.freeze([]), venue: 'cloud', egress: 'official_provider_api',
    egressProfileRef: 'egress.synthetic.v1', residency: 'provider_managed',
    residencyProfileRef: 'residency.provider-managed.v1', retention: 'provider_declared',
    retentionProfileRef: 'retention.standard.v1', dataUse: 'synthetic_nonclinical',
    dataUseProfileRef: 'data-use.synthetic-nonclinical.v1',
});
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
const RESPONSE = Object.freeze({
    id: 'msg_official_synthetic_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
    content: [Object.freeze({ type: 'text', text: 'Synthetic official response.' })],
    stop_reason: 'end_turn', stop_sequence: null,
    usage: Object.freeze({ input_tokens: 8, output_tokens: 4 }),
});

function enabled(binding: unknown = BINDING) {
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), {
        type: 'configure', binding,
    });
    return transitionProviderLifecycleV2(
        transitionProviderLifecycleV2(configured, { type: 'validate' }),
        { type: 'enable' },
    );
}

function instanceBinding(profile: unknown = PROFILE, lifecycle: unknown = enabled()) {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.provider-instance-lifecycle-binding.v2',
        providerInstanceRef: INSTANCE_REF, profile, lifecycle,
    });
}

function workspaceAuthority(overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.anthropic-workspace-authority.v1', workspaceRef: WORKSPACE_REF,
        keyScope: 'workspace_scoped', workspaceId: WORKSPACE_ID, ...overrides,
    });
}

function headerFacade() {
    const values = new Map([
        ['x-api-key', SECRET], ['anthropic-version', '2023-06-01'],
        ['content-type', 'application/json'], ['user-agent', 'MediFlow/0.8.5 provider-v2'],
    ]);
    return Object.freeze({ get(name: string) { return values.get(name.toLowerCase()) ?? null; } });
}

function transportRequest(overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        target: 'anthropic.messages.v1.official_api', method: 'POST', headers: headerFacade(),
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1_024,
            messages: [{ role: 'user', content: 'Synthetic transport request.' }] }),
        signal: new AbortController().signal, maxResponseBytes: 16_384, ...overrides,
    });
}

function factory(fetch: (url: string, init: RequestInit) => Promise<Response>, overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        instanceBinding: instanceBinding(), workspaceAuthority: workspaceAuthority(), fetch, ...overrides,
    });
}

function response(body = JSON.stringify(RESPONSE), status = 200, workspaceId = WORKSPACE_ID) {
    return new Response(body, { status, headers: { 'anthropic-workspace-id': workspaceId } });
}

test('lega la key workspace-scoped al profilo host-owned e verifica il workspace osservato', async () => {
    let retainedHeaders: Headers | undefined;
    const transport = createAnthropicMessagesOfficialHttpsTransport(factory(async (url, init) => {
        assert.equal(url, ANTHROPIC_MESSAGES_OFFICIAL_URL);
        assert.equal(init.method, 'POST');
        assert.equal(init.redirect, 'error');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.cache, 'no-store');
        assert.equal(init.referrerPolicy, 'no-referrer');
        retainedHeaders = init.headers as Headers;
        assert.equal(retainedHeaders.get('x-api-key'), SECRET);
        assert.equal(retainedHeaders.get('anthropic-version'), '2023-06-01');
        assert.equal(retainedHeaders.get('anthropic-workspace-id'), null);
        return response();
    }));
    const result = await transport(transportRequest() as never);
    assert.deepEqual(result, { status: 200, body: JSON.stringify(RESPONSE) });
    assert.equal(retainedHeaders?.get('x-api-key'), null);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(JSON.stringify(result).includes(WORKSPACE_ID), false);
});

test('inietta anthropic-workspace-id solo per una key multi-workspace host-owned', async () => {
    let observedWorkspace: string | null = null;
    let retainedHeaders: Headers | undefined;
    const transport = createAnthropicMessagesOfficialHttpsTransport(factory(async (_url, init) => {
        retainedHeaders = init.headers as Headers;
        observedWorkspace = retainedHeaders.get('anthropic-workspace-id');
        return response();
    }, { workspaceAuthority: workspaceAuthority({ keyScope: 'multi_workspace' }) }));
    await transport(transportRequest() as never);
    assert.equal(observedWorkspace, WORKSPACE_ID);
    assert.equal(retainedHeaders?.get('anthropic-workspace-id'), null);
    assert.equal(retainedHeaders?.get('x-api-key'), null);
});

test('compone Messages e deriva receipt soltanto dopo transport e workspace validati', async () => {
    let calls = 0;
    const transport = createAnthropicMessagesOfficialHttpsTransport(factory(async () => {
        calls += 1; return response();
    }));
    const result = await executeAnthropicMessagesV2({
        lifecycle: enabled(), evidence: EVIDENCE, secretRef: Object.freeze({ scheme: 'env', name: 'ANTHROPIC_API_KEY' }),
        broker: createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SECRET }),
        input: 'Synthetic non-clinical request.', now: (() => { const ticks = [1_000, 1_019]; return () => ticks.shift(); })(),
        transport,
    });
    assert.equal(result.outputText, 'Synthetic official response.');
    assert.equal(result.receipt.providerId, 'anthropic');
    assert.equal(result.receipt.vendorRequestId, 'msg_official_synthetic_1');
    assert.equal(result.receipt.latencyMs, 19);
    assert.equal(calls, 1);
});

test('nega mismatch profile, workspace, key scope e vendor ID prima di creare il transport', () => {
    const openAIProfile = Object.freeze({ ...PROFILE, providerType: 'openai', model: 'gpt-5.4-mini' });
    const invalidFactories = [
        factory(async () => response(), { instanceBinding: instanceBinding(openAIProfile) }),
        factory(async () => response(), { workspaceAuthority: workspaceAuthority({ workspaceRef: 'pws_ffffffffffffffffffffffffffffffff' }) }),
        factory(async () => response(), { workspaceAuthority: workspaceAuthority({ keyScope: 'caller_chosen' }) }),
        factory(async () => response(), { workspaceAuthority: workspaceAuthority({ workspaceId: 'workspace-caller' }) }),
        Object.freeze({ ...factory(async () => response()), endpoint: ['https:', '', 'caller.invalid'].join('/') }),
    ];
    for (const value of invalidFactories) {
        assert.throws(() => createAnthropicMessagesOfficialHttpsTransport(value),
            /Anthropic official HTTPS transport rejected/u);
    }
});

test('nega request ostili e workspace response mismatch senza propagare dettagli', async () => {
    let calls = 0;
    const transport = createAnthropicMessagesOfficialHttpsTransport(factory(async () => {
        calls += 1; return response(JSON.stringify(RESPONSE), 200, 'wrkspc_01JAAAAAAAAAAAAAAAAAAAAAAAAAA');
    }));
    await assert.rejects(transport(transportRequest() as never), /Anthropic official HTTPS transport rejected/u);
    assert.equal(calls, 1);

    const clean = createAnthropicMessagesOfficialHttpsTransport(factory(async () => {
        calls += 1; return response();
    }));
    const extraHeaders = Object.freeze({ get(name: string) {
        if (name.toLowerCase() === 'anthropic-beta') return 'caller-beta';
        return headerFacade().get(name);
    } });
    const oversizedBody = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1_024,
        messages: [{ role: 'user', content: 'x'.repeat(ANTHROPIC_MESSAGES_OFFICIAL_MAX_REQUEST_BYTES) }] });
    for (const request of [
        transportRequest({ target: 'caller.endpoint' }), transportRequest({ method: 'GET' }),
        transportRequest({ url: ['https:', '', 'caller.invalid'].join('/') }), transportRequest({ headers: extraHeaders }),
        transportRequest({ body: JSON.stringify({ model: 'caller-model', max_tokens: 1_024,
            messages: [{ role: 'user', content: 'Synthetic.' }] }) }),
        transportRequest({ body: oversizedBody }), transportRequest({ maxResponseBytes: 262_145 }),
        new Proxy(transportRequest(), {}),
    ]) await assert.rejects(clean(request as never), /Anthropic official HTTPS transport rejected/u);
    assert.equal(calls, 1);
});

test('mantiene lo stream bounded e non richiede workspace header sui denial HTTP', async () => {
    const maximum = 64;
    const oversized = createAnthropicMessagesOfficialHttpsTransport(factory(async () => (
        response(new TextDecoder().decode(new Uint8Array(maximum + 2_048)), 200)
    )));
    const bounded = await oversized(transportRequest({ maxResponseBytes: maximum }) as never) as { status: number; body: string };
    assert.equal(Buffer.byteLength(bounded.body, 'utf8'), maximum + 1);

    const denied = createAnthropicMessagesOfficialHttpsTransport(factory(async () => (
        new Response('{"type":"error"}', { status: 401 })
    )));
    assert.deepEqual(await denied(transportRequest() as never), { status: 401, body: '{"type":"error"}' });
});
