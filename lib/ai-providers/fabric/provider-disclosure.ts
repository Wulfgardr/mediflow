/* @Codex */
import { snapshotProviderLifecycle } from './provider-lifecycle';

export const PROVIDER_DISCLOSURE_SCHEMA_VERSION = 'mediflow.ai.provider-disclosure.v1' as const;

export const PROVIDER_DISCLOSURE_IDS = Object.freeze([
    'ollama',
    'athena_mlx',
    'openai',
    'anthropic',
] as const);

export type ProviderDisclosureId = typeof PROVIDER_DISCLOSURE_IDS[number];
export type ProviderDisclosureSources = Readonly<{
    ollama: () => unknown;
    athena: () => unknown;
}>;

export type ProviderDisclosureLifecycle =
    | 'available_unqualified'
    | 'degraded'
    | 'revoked'
    | 'missing'
    | 'corrupt'
    | 'unavailable'
    | 'invalid'
    | 'not_applicable';

export type ProviderDisclosureRow = Readonly<{
    id: ProviderDisclosureId;
    label: string;
    declared: Readonly<{
        lifecycle: 'host_managed' | 'informational_only';
        runtimeObservation: 'operation_receipt_required' | 'disabled';
        venue: 'local_process' | 'cloud';
        egress: 'none' | 'disabled';
        credentialClass: 'local_model' | 'separate_api_access_required';
        executionDisposition: 'proposal_only_candidate' | 'execution_disabled';
        accessBoundary: 'not_applicable' | 'consumer_subscription_is_not_api_access';
    }>;
    effective: Readonly<{
        lifecycle: ProviderDisclosureLifecycle;
        runtimeObservation: 'not_observed';
        venue: null;
        egress: null;
        credentialClass: 'local_model' | null;
        executionDisposition: 'not_observed' | 'denied_by_contract' | 'execution_disabled';
    }>;
}>;

export type ProviderDisclosureSnapshot = Readonly<{
    schemaVersion: typeof PROVIDER_DISCLOSURE_SCHEMA_VERSION;
    providers: readonly ProviderDisclosureRow[];
}>;

type LocalProviderId = 'ollama' | 'athena_mlx';

function hasExactKeys(value: object, expected: readonly string[]): boolean {
    const keys = Reflect.ownKeys(value);
    return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function readLocalLifecycle(
    read: () => unknown,
    expectedProvider: LocalProviderId,
): Readonly<{
    lifecycle: ProviderDisclosureLifecycle;
    credentialClass: 'local_model' | null;
}> {
    let value: unknown;
    try {
        value = read();
    } catch {
        return Object.freeze({ lifecycle: 'unavailable', credentialClass: null });
    }

    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const statusDescriptor = Object.getOwnPropertyDescriptor(value, 'status');
        if (!statusDescriptor || !('value' in statusDescriptor)) throw new Error();

        if (statusDescriptor.value === 'denied') {
            if (!hasExactKeys(value, ['status', 'reason'])) throw new Error();
            const reasonDescriptor = Object.getOwnPropertyDescriptor(value, 'reason');
            const reason = reasonDescriptor && 'value' in reasonDescriptor ? reasonDescriptor.value : null;
            if (reason !== 'missing' && reason !== 'corrupt' && reason !== 'unavailable') throw new Error();
            return Object.freeze({ lifecycle: reason, credentialClass: null });
        }

        if (statusDescriptor.value !== 'available' || !hasExactKeys(value, ['status', 'record'])) {
            throw new Error();
        }
        const recordDescriptor = Object.getOwnPropertyDescriptor(value, 'record');
        const record = recordDescriptor && 'value' in recordDescriptor ? recordDescriptor.value : null;
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error();
        const lifecycleDescriptor = Object.getOwnPropertyDescriptor(record, 'lifecycle');
        if (!lifecycleDescriptor || !('value' in lifecycleDescriptor)) throw new Error();
        const lifecycle = snapshotProviderLifecycle(lifecycleDescriptor.value);
        if (lifecycle.provider !== expectedProvider || lifecycle.credentialClass !== 'local_model') {
            throw new Error();
        }
        return Object.freeze({ lifecycle: lifecycle.status, credentialClass: 'local_model' });
    } catch {
        return Object.freeze({ lifecycle: 'invalid', credentialClass: null });
    }
}

function localRow(
    id: LocalProviderId,
    label: string,
    read: () => unknown,
): ProviderDisclosureRow {
    const observed = readLocalLifecycle(read, id);
    const lifecycleAllowsCandidate = observed.lifecycle === 'available_unqualified';
    return Object.freeze({
        id,
        label,
        declared: Object.freeze({
            lifecycle: 'host_managed' as const,
            runtimeObservation: 'operation_receipt_required' as const,
            venue: 'local_process' as const,
            egress: 'none' as const,
            credentialClass: 'local_model' as const,
            executionDisposition: 'proposal_only_candidate' as const,
            accessBoundary: 'not_applicable' as const,
        }),
        effective: Object.freeze({
            lifecycle: observed.lifecycle,
            runtimeObservation: 'not_observed' as const,
            venue: null,
            egress: null,
            credentialClass: observed.credentialClass,
            executionDisposition: lifecycleAllowsCandidate
                ? 'not_observed' as const
                : 'denied_by_contract' as const,
        }),
    });
}

function cloudRow(id: 'openai' | 'anthropic', label: string): ProviderDisclosureRow {
    return Object.freeze({
        id,
        label,
        declared: Object.freeze({
            lifecycle: 'informational_only' as const,
            runtimeObservation: 'disabled' as const,
            venue: 'cloud' as const,
            egress: 'disabled' as const,
            credentialClass: 'separate_api_access_required' as const,
            executionDisposition: 'execution_disabled' as const,
            accessBoundary: 'consumer_subscription_is_not_api_access' as const,
        }),
        effective: Object.freeze({
            lifecycle: 'not_applicable' as const,
            runtimeObservation: 'not_observed' as const,
            venue: null,
            egress: null,
            credentialClass: null,
            executionDisposition: 'execution_disabled' as const,
        }),
    });
}

export function buildProviderDisclosureSnapshot(
    sources: ProviderDisclosureSources,
): ProviderDisclosureSnapshot {
    const providers = Object.freeze([
        localRow('ollama', 'Ollama', sources.ollama),
        localRow('athena_mlx', 'ATHENA', sources.athena),
        cloudRow('openai', 'OpenAI'),
        cloudRow('anthropic', 'Anthropic'),
    ]);
    return Object.freeze({
        schemaVersion: PROVIDER_DISCLOSURE_SCHEMA_VERSION,
        providers,
    });
}
