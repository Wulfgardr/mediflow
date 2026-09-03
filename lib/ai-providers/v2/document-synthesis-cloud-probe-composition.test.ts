/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    createDocumentSynthesisCloudProbeCompositionForTest,
    createDocumentSynthesisCloudProbeFromHostEnvironment,
} from './document-synthesis-cloud-probe-composition.ts';
import { createAbsentProviderLifecycleV2, transitionProviderLifecycleV2 } from './provider-lifecycle.ts';

const OPENAI_SECRET = 'sk-proj-SYNTHETIC_COMPOSITION_SENTINEL_0123456789';
const ANTHROPIC_SECRET = 'sk-ant-api03-SYNTHETIC_COMPOSITION_SENTINEL_0123456789';
const WORKSPACE_ID = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';
const OUTPUT = JSON.stringify({
    schemaVersion: 'mediflow.ai.cloud-document-synthesis-probe.v1',
    task: 'document_synthesis',
    dataClass: 'synthetic_nonclinical',
    summary: 'Synthetic non-clinical document summary.',
});

type Provider = 'openai' | 'anthropic';

function hostConfiguration(provider: Provider, overrides: Record<string, unknown> = {}) {
    const openAI = provider === 'openai';
    const instanceRef = openAI
        ? 'pvi_11111111111111111111111111111111'
        : 'pvi_22222222222222222222222222222222';
    const workspaceRef = openAI
        ? 'pws_11111111111111111111111111111111'
        : 'pws_22222222222222222222222222222222';
    const model = openAI ? 'gpt-5.4-mini' : 'claude-sonnet-4-6';
    const binding = Object.freeze({
        schemaVersion: 'mediflow.ai.provider-binding.v2', operation: 'document_synthesis', providerId: provider,
        kind: 'cloud', venue: 'cloud', model, dataClass: 'synthetic_nonclinical',
        egressProfileRef: 'egress.synthetic.v1', retentionProfileRef: 'retention.standard.v1', consentRef: null,
        timeoutMs: 1_000, maxInputBytes: 4_096, maxOutputBytes: 16_384, fallback: 'none',
    });
    let lifecycle = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding });
    lifecycle = transitionProviderLifecycleV2(lifecycle, { type: 'validate' });
    lifecycle = transitionProviderLifecycleV2(lifecycle, { type: 'enable' });
    const profile = Object.freeze({
        schemaVersion: 'mediflow.ai.provider-instance-profile.v2', providerType: provider,
        providerInstance: Object.freeze({ instanceRef, workspaceRef }),
        auth: Object.freeze({ schemaVersion: 'mediflow.ai.provider-auth-policy.v2', credentialClass: 'api_key',
            authRef: openAI ? 'par_11111111111111111111111111111111' : 'par_22222222222222222222222222222222' }),
        model, capabilities: Object.freeze(['document_synthesis']), groups: Object.freeze(['group.review-only.v1']),
        bindings: Object.freeze([Object.freeze({ operation: 'document_synthesis', groupRef: 'group.review-only.v1' })]),
        functionAllowlist: Object.freeze([]), venue: 'cloud', egress: 'official_provider_api',
        egressProfileRef: 'egress.synthetic.v1', residency: 'provider_managed',
        residencyProfileRef: 'residency.provider-managed.v1', retention: 'provider_declared',
        retentionProfileRef: 'retention.standard.v1', dataUse: 'synthetic_nonclinical',
        dataUseProfileRef: 'data-use.synthetic-nonclinical.v1',
    });
    return Object.freeze({
        enabled: true,
        networkAllowed: true,
        instanceBinding: Object.freeze({
            schemaVersion: 'mediflow.ai.provider-instance-lifecycle-binding.v2', providerInstanceRef: instanceRef,
            profile, lifecycle,
        }),
        evidence: Object.freeze({
            schemaVersion: 'mediflow.ai.provider-policy-evidence.v2', egressProfileRef: 'egress.synthetic.v1',
            retentionProfileRef: 'retention.standard.v1', consentRef: null, egressPromoted: false,
            retentionEligible: false, consentCurrent: false, redactionReceiptSha256: null,
        }),
        secretRef: Object.freeze({ scheme: 'env', name: openAI ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY' }),
        workspaceAuthority: openAI ? null : Object.freeze({
            schemaVersion: 'mediflow.ai.anthropic-workspace-authority.v1', workspaceRef,
            keyScope: 'workspace_scoped', workspaceId: WORKSPACE_ID,
        }),
        ...overrides,
    });
}

function openAIResponse() {
    return Object.freeze({
        id: 'resp_cloud_composition_synthetic_1', object: 'response', status: 'completed', model: 'gpt-5.4-mini',
        output: [Object.freeze({
            id: 'msg_cloud_composition_synthetic_1', type: 'message', status: 'completed', role: 'assistant',
            content: [Object.freeze({ type: 'output_text', text: OUTPUT, annotations: [] })],
        })],
        usage: Object.freeze({ input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 8,
            output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 20 }),
    });
}

function anthropicResponse() {
    return Object.freeze({
        id: 'msg_cloud_composition_synthetic_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
        content: [Object.freeze({ type: 'text', text: OUTPUT })], stop_reason: 'end_turn', stop_sequence: null,
        usage: Object.freeze({ input_tokens: 12, output_tokens: 8 }),
    });
}

function dependencies(provider: Provider, inspect?: (url: string, init: RequestInit) => void) {
    let tick = 1_000;
    return Object.freeze({
        now: () => { tick += 1; return tick; },
        readEnv: (name: string) => name === 'OPENAI_API_KEY' ? OPENAI_SECRET
            : name === 'ANTHROPIC_API_KEY' ? ANTHROPIC_SECRET : undefined,
        fetch: async (url: string, init: RequestInit) => {
            inspect?.(url, init);
            return provider === 'openai'
                ? new Response(JSON.stringify(openAIResponse()), { status: 200 })
                : new Response(JSON.stringify(anthropicResponse()), {
                    status: 200, headers: { 'anthropic-workspace-id': WORKSPACE_ID },
                });
        },
    });
}

for (const provider of ['openai', 'anthropic'] as const) {
    test(`compone ${provider} da authority host-owned e pubblica solo una projection review-only`, async () => {
        let calls = 0;
        const composition = createDocumentSynthesisCloudProbeCompositionForTest(
            hostConfiguration(provider),
            dependencies(provider, (_url, init) => {
                calls += 1;
                const body = JSON.parse(init.body as string) as { input?: string; messages?: { content: string }[] };
                const prompt = body.input ?? body.messages?.[0]?.content;
                assert.match(prompt ?? '', /synthetic non-clinical fixture/iu);
                assert.doesNotMatch(prompt ?? '', /patient|diagnos|therapy/iu);
            }),
        );
        assert.ok(composition);
        assert.deepEqual(Reflect.ownKeys(composition), ['execute']);
        assert.equal(composition.execute.length, 0);

        const result = await composition.execute();
        assert.ok(result);
        assert.equal(Object.isFrozen(result), true);
        assert.deepEqual(Reflect.ownKeys(result), [
            'schemaVersion', 'operation', 'stage', 'dataClass', 'summary', 'receipt', 'poweredBy',
            'reviewRequired', 'applyPolicy', 'writesPerformed',
        ]);
        assert.equal(result.receipt.providerId, provider);
        assert.equal(result.poweredBy, provider === 'openai' ? 'Powered by OpenAI' : 'Powered by Anthropic');
        assert.equal(result.reviewRequired, true);
        assert.equal(result.applyPolicy, 'none');
        assert.equal(result.writesPerformed, 0);
        assert.equal(calls, 1);
        assert.equal(await composition.execute(), null);
        assert.equal(calls, 1);
    });
}

test('nega default OFF, egress, retention, lifecycle e campi caller-supplied prima della rete', async () => {
    let calls = 0;
    const deps = dependencies('openai', () => { calls += 1; });
    const valid = hostConfiguration('openai');
    const binding = valid.instanceBinding.lifecycle.binding!;
    const mismatchedLifecycle = Object.freeze({
        ...valid.instanceBinding.lifecycle,
        binding: Object.freeze({ ...binding, egressProfileRef: 'egress.other.v1' }),
    });
    const invalid = [
        hostConfiguration('openai', { enabled: false }),
        hostConfiguration('openai', { networkAllowed: false }),
        Object.freeze({ ...valid, callerProvider: 'anthropic' }),
        Object.freeze({ ...valid, endpoint: ['https:', '', 'caller.invalid'].join('/') }),
        Object.freeze({ ...valid, evidence: Object.freeze({ ...valid.evidence, retentionProfileRef: 'retention.other.v1' }) }),
        Object.freeze({ ...valid, instanceBinding: Object.freeze({ ...valid.instanceBinding, lifecycle: mismatchedLifecycle }) }),
    ];
    for (const value of invalid) {
        assert.equal(createDocumentSynthesisCloudProbeCompositionForTest(value, deps), null);
    }
    assert.equal(calls, 0);
});

test('nega output non conforme senza receipt proiettata, fallback o secondo provider', async () => {
    let calls = 0;
    const deps = Object.freeze({
        ...dependencies('openai'),
        fetch: async () => {
            calls += 1;
            const response = openAIResponse();
            return new Response(JSON.stringify({
                ...response,
                output: [{ ...response.output[0], content: [{ type: 'output_text', text: '{"summary":"forged"}', annotations: [] }] }],
            }), { status: 200 });
        },
    });
    const composition = createDocumentSynthesisCloudProbeCompositionForTest(hostConfiguration('openai'), deps);
    assert.ok(composition);
    assert.equal(await composition.execute(), null);
    assert.equal(calls, 1);
    assert.equal(await composition.execute(), null);
    assert.equal(calls, 1);
});

test('la factory production resta OFF senza i due opt-in host e non osserva credenziali', () => {
    const names = ['MEDIFLOW_PROVIDER_V2_ENABLED', 'MEDIFLOW_PROVIDER_V2_NETWORK', 'MEDIFLOW_PROVIDER_V2_SELECTION'];
    const previous = names.map((name) => process.env[name]);
    try {
        for (const name of names) delete process.env[name];
        assert.equal(createDocumentSynthesisCloudProbeFromHostEnvironment(), null);
        process.env.MEDIFLOW_PROVIDER_V2_SELECTION = 'openai';
        process.env.MEDIFLOW_PROVIDER_V2_ENABLED = '1';
        assert.equal(createDocumentSynthesisCloudProbeFromHostEnvironment(), null);
        delete process.env.MEDIFLOW_PROVIDER_V2_ENABLED;
        process.env.MEDIFLOW_PROVIDER_V2_NETWORK = '1';
        assert.equal(createDocumentSynthesisCloudProbeFromHostEnvironment(), null);
    } finally {
        names.forEach((name, index) => {
            const value = previous[index];
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        });
    }
});

test('la factory production raggiunge entrambi i transport ufficiali solo attraverso fetch intercettata', { concurrency: false }, async () => {
    const names = [
        'MEDIFLOW_PROVIDER_V2_ENABLED', 'MEDIFLOW_PROVIDER_V2_NETWORK', 'MEDIFLOW_PROVIDER_V2_SELECTION',
        'MEDIFLOW_ANTHROPIC_KEY_SCOPE', 'MEDIFLOW_ANTHROPIC_WORKSPACE_ID',
        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    ] as const;
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    const nativeFetch = globalThis.fetch;
    try {
        for (const name of names) delete process.env[name];
        for (const provider of ['openai', 'anthropic'] as const) {
            let calls = 0;
            const secret = provider === 'openai' ? OPENAI_SECRET : ANTHROPIC_SECRET;
            globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
                calls += 1;
                const url = String(input);
                const headers = init?.headers as Headers;
                const body = String(init?.body ?? '');
                assert.equal(url, provider === 'openai'
                    ? 'https://api.openai.com/v1/responses'
                    : 'https://api.anthropic.com/v1/messages');
                assert.equal(headers.get(provider === 'openai' ? 'authorization' : 'x-api-key'),
                    provider === 'openai' ? `Bearer ${secret}` : secret);
                assert.match(body, /synthetic non-clinical fixture/iu);
                assert.doesNotMatch(body, /patient|diagnos|therapy/iu);
                assert.equal(body.includes(secret), false);
                return provider === 'openai'
                    ? new Response(JSON.stringify(openAIResponse()), { status: 200 })
                    : new Response(JSON.stringify(anthropicResponse()), {
                        status: 200, headers: { 'anthropic-workspace-id': WORKSPACE_ID },
                    });
            }) as typeof fetch;
            process.env.MEDIFLOW_PROVIDER_V2_ENABLED = '1';
            process.env.MEDIFLOW_PROVIDER_V2_NETWORK = '1';
            process.env.MEDIFLOW_PROVIDER_V2_SELECTION = provider;
            process.env[provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'] = secret;
            if (provider === 'anthropic') {
                process.env.MEDIFLOW_ANTHROPIC_KEY_SCOPE = 'workspace_scoped';
                process.env.MEDIFLOW_ANTHROPIC_WORKSPACE_ID = WORKSPACE_ID;
            }

            const probe = createDocumentSynthesisCloudProbeFromHostEnvironment();
            assert.ok(probe);
            const result = await probe.execute();
            assert.ok(result);
            assert.equal(result.receipt.providerId, provider);
            assert.equal(result.receipt.outcome, 'complete');
            assert.equal(result.writesPerformed, 0);
            assert.equal(result.receipt.fallbackCount, 0);
            assert.equal(JSON.stringify(result).includes(secret), false);
            assert.equal(calls, 1);
            assert.equal(await probe.execute(), null);
            assert.equal(calls, 1);
        }
    } finally {
        for (const name of names) {
            const value = previous.get(name);
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
        globalThis.fetch = nativeFetch;
    }
});

test('il callsite production accetta solo un gesto admin esplicito e non riceve provider, modello, prompt o segreti', () => {
    const route = readFileSync(new URL('../../../app/api/system/cloud-provider-probe/route.ts', import.meta.url), 'utf8');
    assert.match(route, /requireSession\(\)/u);
    assert.match(route, /isWebAdminSession\(session\)/u);
    assert.match(route, /run_synthetic_nonclinical_probe/u);
    assert.match(route, /createDocumentSynthesisCloudProbeFromHostEnvironment\(\)/u);
    assert.doesNotMatch(route, /requireSessionOrLocalToken|OPENAI_API_KEY|ANTHROPIC_API_KEY/u);
    const acceptedBody = route.slice(route.indexOf('function exactIntent'), route.indexOf('async function readIntent'));
    assert.doesNotMatch(acceptedBody, /\b(?:provider|model|prompt|secret)\b/u);
});

test('la seam di test non e disponibile fuori dal Node test runner', () => {
    const moduleUrl = new URL('./document-synthesis-cloud-probe-composition.ts', import.meta.url).href;
    const inherited = process.execArgv.filter((argument) => argument !== '--test'
        && !argument.startsWith('--test=') && !argument.startsWith('--test-'));
    const program = `import { createDocumentSynthesisCloudProbeCompositionForTest as create } from ${JSON.stringify(moduleUrl)}; let reads = 0; const config = Object.freeze(Object.defineProperty({}, 'enabled', { enumerable: true, get() { reads += 1; return true; } })); const deps = new Proxy({}, { get() { reads += 1; throw new Error('trap'); } }); if (create(config, deps) !== null || reads !== 0) process.exitCode = 1;`;
    const result = spawnSync(process.execPath, [...inherited, '--input-type=module', '--eval', program], { encoding: 'utf8' });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
