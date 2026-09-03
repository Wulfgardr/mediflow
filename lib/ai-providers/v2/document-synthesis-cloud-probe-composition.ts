/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { executeAnthropicMessagesV2 } from './anthropic-messages-adapter';
import {
    ANTHROPIC_WORKSPACE_AUTHORITY_V1_SCHEMA,
    createAnthropicMessagesOfficialHttpsTransport,
} from './anthropic-messages-official-transport';
import { executeOpenAIResponsesV2 } from './openai-responses-adapter';
import { createOpenAIResponsesOfficialHttpsTransport } from './openai-responses-official-transport';
import {
    bindProviderLifecycleToInstanceProfileV2,
    snapshotProviderInstanceProfileV2,
} from './provider-instance-profile';
import {
    createAbsentProviderLifecycleV2,
    snapshotProviderLifecycleV2,
    transitionProviderLifecycleV2,
} from './provider-lifecycle';
import { poweredByFromProviderReceiptV2, type ProviderOperationReceiptV2 } from './provider-operation-policy';
import { createProviderSecretBrokerV2 } from './provider-secret-broker';

export const DOCUMENT_SYNTHESIS_CLOUD_PROBE_RESULT_SCHEMA = 'mediflow.ai.document-synthesis-cloud-probe-result.v1' as const;
const OUTPUT_SCHEMA = 'mediflow.ai.cloud-document-synthesis-probe.v1' as const;
const INSTANCE_BINDING_SCHEMA = 'mediflow.ai.provider-instance-lifecycle-binding.v2' as const;
const PROFILE_SCHEMA = 'mediflow.ai.provider-instance-profile.v2' as const;
const AUTH_SCHEMA = 'mediflow.ai.provider-auth-policy.v2' as const;
const EVIDENCE_SCHEMA = 'mediflow.ai.provider-policy-evidence.v2' as const;
const BINDING_SCHEMA = 'mediflow.ai.provider-binding.v2' as const;
const PROMPT = [
    'Synthetic non-clinical fixture: a fictional community library extends its evening opening hours.',
    'Return only one JSON object with exact keys schemaVersion, task, dataClass, summary.',
    `Use schemaVersion ${OUTPUT_SCHEMA}, task document_synthesis, dataClass synthetic_nonclinical,`,
    'and a short factual summary of this fictional fixture. Do not add Markdown or extra keys.',
].join(' ');

const CONFIG_KEYS = ['enabled', 'networkAllowed', 'instanceBinding', 'evidence', 'secretRef', 'workspaceAuthority'] as const;
const DEPENDENCY_KEYS = ['now', 'readEnv', 'fetch'] as const;
const EVIDENCE_KEYS = ['schemaVersion', 'egressProfileRef', 'retentionProfileRef', 'consentRef', 'egressPromoted',
    'retentionEligible', 'consentCurrent', 'redactionReceiptSha256'] as const;
const SECRET_KEYS = ['scheme', 'name'] as const;
const WORKSPACE_KEYS = ['schemaVersion', 'workspaceRef', 'keyScope', 'workspaceId'] as const;
const OUTPUT_KEYS = ['schemaVersion', 'task', 'dataClass', 'summary'] as const;
const TEST_HARNESS = process.execArgv.some((argument) => argument === '--test'
    || argument.startsWith('--test=') || argument.startsWith('--test-'));
const ENCODER = new TextEncoder();

type CloudProvider = 'openai' | 'anthropic';
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Dependencies = Readonly<{ now(): unknown; readEnv(name: string): unknown; fetch: FetchLike }>;
type HostConfiguration = Readonly<{
    provider: CloudProvider;
    instanceBinding: Readonly<Record<string, unknown>>;
    lifecycle: ReturnType<typeof snapshotProviderLifecycleV2>;
    evidence: Readonly<Record<string, unknown>>;
    secretRef: Readonly<{ scheme: 'env'; name: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' }>;
    workspaceAuthority: Readonly<Record<string, unknown>> | null;
}>;
export type DocumentSynthesisCloudProbeResult = Readonly<{
    schemaVersion: typeof DOCUMENT_SYNTHESIS_CLOUD_PROBE_RESULT_SCHEMA;
    operation: 'document_synthesis'; stage: 'review'; dataClass: 'synthetic_nonclinical'; summary: string;
    receipt: ProviderOperationReceiptV2; poweredBy: 'Powered by OpenAI' | 'Powered by Anthropic';
    reviewRequired: true; applyPolicy: 'none'; writesPerformed: 0;
}>;
export type DocumentSynthesisCloudProbeComposition = Readonly<{
    execute(): Promise<DocumentSynthesisCloudProbeResult | null>;
}>;

function exact(value: unknown, keys: readonly string[], frozen = true): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
            || (frozen && !Object.isFrozen(value))) return null;
        const prototype = Object.getPrototypeOf(value); const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
            || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const copy: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function safeFunction(value: unknown): value is (...args: never[]) => unknown {
    try { return typeof value === 'function' && !types.isProxy(value); } catch { return false; }
}

function dependencies(value: unknown): Dependencies | null {
    const source = exact(value, DEPENDENCY_KEYS);
    if (!source || !safeFunction(source.now) || !safeFunction(source.readEnv) || !safeFunction(source.fetch)) return null;
    return Object.freeze({ now: source.now, readEnv: source.readEnv, fetch: source.fetch }) as Dependencies;
}

function hostConfiguration(value: unknown): HostConfiguration | null {
    const source = exact(value, CONFIG_KEYS);
    if (!source || source.enabled !== true || source.networkAllowed !== true) return null;
    let profile: ReturnType<typeof snapshotProviderInstanceProfileV2>;
    let lifecycle: ReturnType<typeof snapshotProviderLifecycleV2>;
    let link: ReturnType<typeof bindProviderLifecycleToInstanceProfileV2>;
    try {
        const binding = exact(source.instanceBinding,
            ['schemaVersion', 'providerInstanceRef', 'profile', 'lifecycle']);
        if (!binding) return null;
        profile = snapshotProviderInstanceProfileV2(binding.profile);
        lifecycle = snapshotProviderLifecycleV2(binding.lifecycle);
        link = bindProviderLifecycleToInstanceProfileV2(source.instanceBinding);
    } catch { return null; }
    const provider = profile.providerType;
    if ((provider !== 'openai' && provider !== 'anthropic') || lifecycle.status !== 'enabled'
        || link.providerType !== provider || link.operation !== 'document_synthesis' || link.venue !== 'cloud'
        || link.egress !== 'official_provider_api' || link.egressProfileRef !== 'egress.synthetic.v1'
        || link.retention !== 'provider_declared' || link.retentionProfileRef !== 'retention.standard.v1'
        || link.dataUse !== 'synthetic_nonclinical' || link.functionAllowlist.length !== 0) return null;
    const proof = exact(source.evidence, EVIDENCE_KEYS);
    if (!proof || proof.schemaVersion !== EVIDENCE_SCHEMA || proof.egressProfileRef !== link.egressProfileRef
        || proof.retentionProfileRef !== link.retentionProfileRef || proof.consentRef !== null
        || proof.egressPromoted !== false || proof.retentionEligible !== false || proof.consentCurrent !== false
        || proof.redactionReceiptSha256 !== null) return null;
    const secret = exact(source.secretRef, SECRET_KEYS);
    const expectedSecret = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    if (!secret || secret.scheme !== 'env' || secret.name !== expectedSecret) return null;
    let workspace: Readonly<Record<string, unknown>> | null = null;
    if (provider === 'openai') {
        if (source.workspaceAuthority !== null) return null;
    } else {
        const authority = exact(source.workspaceAuthority, WORKSPACE_KEYS);
        if (!authority || authority.schemaVersion !== ANTHROPIC_WORKSPACE_AUTHORITY_V1_SCHEMA
            || authority.workspaceRef !== profile.providerInstance.workspaceRef
            || (authority.keyScope !== 'workspace_scoped' && authority.keyScope !== 'multi_workspace')
            || typeof authority.workspaceId !== 'string' || !/^wrkspc_[A-Za-z0-9]{20,64}$/u.test(authority.workspaceId)) return null;
        workspace = Object.freeze(authority);
    }
    const instanceBinding = Object.freeze({
        schemaVersion: INSTANCE_BINDING_SCHEMA, providerInstanceRef: link.providerInstanceRef, profile, lifecycle,
    });
    return Object.freeze({ provider, instanceBinding, lifecycle, evidence: Object.freeze(proof),
        secretRef: Object.freeze({ scheme: 'env' as const, name: expectedSecret }), workspaceAuthority: workspace });
}

function parseOutput(value: unknown): string | null {
    if (typeof value !== 'string' || ENCODER.encode(value).byteLength > 8_192) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return null; }
    const output = exact(parsed, OUTPUT_KEYS, false); const summary = output?.summary;
    return output?.schemaVersion === OUTPUT_SCHEMA && output.task === 'document_synthesis'
        && output.dataClass === 'synthetic_nonclinical' && typeof summary === 'string'
        && summary === summary.trim() && summary.length > 0 && ENCODER.encode(summary).byteLength <= 4_096
        && !/[\u0000-\u001f\u007f]/u.test(summary) ? summary : null;
}

function result(outputText: string, receipt: ProviderOperationReceiptV2): DocumentSynthesisCloudProbeResult | null {
    const summary = parseOutput(outputText); const label = poweredByFromProviderReceiptV2(receipt);
    if (!summary || (label !== 'Powered by OpenAI' && label !== 'Powered by Anthropic')) return null;
    return Object.freeze(Object.assign(Object.create(null), {
        schemaVersion: DOCUMENT_SYNTHESIS_CLOUD_PROBE_RESULT_SCHEMA, operation: 'document_synthesis' as const,
        stage: 'review' as const, dataClass: 'synthetic_nonclinical' as const, summary, receipt, poweredBy: label,
        reviewRequired: true as const, applyPolicy: 'none' as const, writesPerformed: 0 as const,
    })) as DocumentSynthesisCloudProbeResult;
}

function create(
    configurationValue: unknown,
    dependenciesValue: unknown,
    operationSignal?: AbortSignal,
): DocumentSynthesisCloudProbeComposition | null {
    const configuration = hostConfiguration(configurationValue); const sources = dependencies(dependenciesValue);
    if (!configuration || !sources) return null;
    let transport;
    try {
        transport = configuration.provider === 'openai'
            ? createOpenAIResponsesOfficialHttpsTransport(Object.freeze({
                instanceBinding: configuration.instanceBinding,
                fetch: sources.fetch,
            }))
            : createAnthropicMessagesOfficialHttpsTransport(Object.freeze({
                instanceBinding: configuration.instanceBinding,
                workspaceAuthority: configuration.workspaceAuthority,
                fetch: sources.fetch,
            }));
    } catch { return null; }
    let state: 'ready' | 'terminal' = 'ready';
    return Object.freeze({
        async execute(): Promise<DocumentSynthesisCloudProbeResult | null> {
            if (state !== 'ready') return null; state = 'terminal';
            try {
                const broker = createProviderSecretBrokerV2({ now: sources.now, readEnv: sources.readEnv });
                const common = { lifecycle: configuration.lifecycle, evidence: configuration.evidence,
                    secretRef: configuration.secretRef, broker, input: PROMPT, now: sources.now,
                    transport, signal: operationSignal };
                const execution = configuration.provider === 'openai'
                    ? await executeOpenAIResponsesV2(common as Parameters<typeof executeOpenAIResponsesV2>[0])
                    : await executeAnthropicMessagesV2(common as Parameters<typeof executeAnthropicMessagesV2>[0]);
                return result(execution.outputText, execution.receipt);
            } catch { return null; }
        },
    });
}

const PROVIDER_IDS = Object.freeze({
    openai: Object.freeze({ instance: 'pvi_11111111111111111111111111111111', workspace: 'pws_11111111111111111111111111111111', auth: 'par_11111111111111111111111111111111', model: 'gpt-5.4-mini', secret: 'OPENAI_API_KEY' }),
    anthropic: Object.freeze({ instance: 'pvi_22222222222222222222222222222222', workspace: 'pws_22222222222222222222222222222222', auth: 'par_22222222222222222222222222222222', model: 'claude-sonnet-4-6', secret: 'ANTHROPIC_API_KEY' }),
} as const);

function productionConfiguration(): Readonly<Record<string, unknown>> | null {
    if (process.env.MEDIFLOW_PROVIDER_V2_ENABLED !== '1' || process.env.MEDIFLOW_PROVIDER_V2_NETWORK !== '1') return null;
    const provider = process.env.MEDIFLOW_PROVIDER_V2_SELECTION;
    if (provider !== 'openai' && provider !== 'anthropic') return null;
    const identity = PROVIDER_IDS[provider];
    const binding = Object.freeze({ schemaVersion: BINDING_SCHEMA, operation: 'document_synthesis', providerId: provider,
        kind: 'cloud', venue: 'cloud', model: identity.model, dataClass: 'synthetic_nonclinical',
        egressProfileRef: 'egress.synthetic.v1', retentionProfileRef: 'retention.standard.v1', consentRef: null,
        timeoutMs: 15_000, maxInputBytes: 32_768, maxOutputBytes: 16_384, fallback: 'none' });
    let lifecycle = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding });
    lifecycle = transitionProviderLifecycleV2(transitionProviderLifecycleV2(lifecycle, { type: 'validate' }), { type: 'enable' });
    const profile = Object.freeze({ schemaVersion: PROFILE_SCHEMA, providerType: provider,
        providerInstance: Object.freeze({ instanceRef: identity.instance, workspaceRef: identity.workspace }),
        auth: Object.freeze({ schemaVersion: AUTH_SCHEMA, credentialClass: 'api_key', authRef: identity.auth }),
        model: identity.model, capabilities: Object.freeze(['document_synthesis']), groups: Object.freeze(['group.review-only.v1']),
        bindings: Object.freeze([Object.freeze({ operation: 'document_synthesis', groupRef: 'group.review-only.v1' })]),
        functionAllowlist: Object.freeze([]), venue: 'cloud', egress: 'official_provider_api',
        egressProfileRef: 'egress.synthetic.v1', residency: 'provider_managed',
        residencyProfileRef: 'residency.provider-managed.v1', retention: 'provider_declared',
        retentionProfileRef: 'retention.standard.v1', dataUse: 'synthetic_nonclinical',
        dataUseProfileRef: 'data-use.synthetic-nonclinical.v1' });
    const workspaceAuthority = provider === 'openai' ? null : Object.freeze({
        schemaVersion: ANTHROPIC_WORKSPACE_AUTHORITY_V1_SCHEMA, workspaceRef: identity.workspace,
        keyScope: process.env.MEDIFLOW_ANTHROPIC_KEY_SCOPE,
        workspaceId: process.env.MEDIFLOW_ANTHROPIC_WORKSPACE_ID,
    });
    return Object.freeze({ enabled: true, networkAllowed: true,
        instanceBinding: Object.freeze({ schemaVersion: INSTANCE_BINDING_SCHEMA, providerInstanceRef: identity.instance,
            profile, lifecycle }),
        evidence: Object.freeze({ schemaVersion: EVIDENCE_SCHEMA, egressProfileRef: 'egress.synthetic.v1',
            retentionProfileRef: 'retention.standard.v1', consentRef: null, egressPromoted: false,
            retentionEligible: false, consentCurrent: false, redactionReceiptSha256: null }),
        secretRef: Object.freeze({ scheme: 'env', name: identity.secret }), workspaceAuthority });
}

/** Production factory with no caller input. Both explicit host opt-ins are required and cloud remains OFF by default. */
export function createDocumentSynthesisCloudProbeFromHostEnvironment(
    abortSignal?: AbortSignal,
): DocumentSynthesisCloudProbeComposition | null {
    if (abortSignal !== undefined && (!(abortSignal instanceof AbortSignal) || abortSignal.aborted)) return null;
    const configuration = productionConfiguration();
    return configuration ? create(configuration, Object.freeze({
        now: () => Date.now(), readEnv: (name: string) => process.env[name],
        fetch: (url: string, init: RequestInit) => globalThis.fetch(url, init),
    }), abortSignal) : null;
}

/** Test-only seam. It is unavailable before observing either argument outside Node's test runner. */
export function createDocumentSynthesisCloudProbeCompositionForTest(
    configuration: unknown, sources: unknown,
): DocumentSynthesisCloudProbeComposition | null {
    return TEST_HARNESS ? create(configuration, sources) : null;
}
