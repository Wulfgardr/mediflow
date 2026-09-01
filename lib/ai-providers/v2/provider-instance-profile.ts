/* @Codex */
import { types as nodeUtilTypes } from 'node:util';
import { snapshotProviderLifecycleV2 } from './provider-lifecycle';

export const PROVIDER_INSTANCE_PROFILE_V2_SCHEMA = 'mediflow.ai.provider-instance-profile.v2' as const;
export const PROVIDER_AUTH_POLICY_V2_SCHEMA = 'mediflow.ai.provider-auth-policy.v2' as const;
export const PROVIDER_INSTANCE_LIFECYCLE_BINDING_V2_SCHEMA = 'mediflow.ai.provider-instance-lifecycle-binding.v2' as const;
export const PROVIDER_INSTANCE_LIFECYCLE_LINK_V2_SCHEMA = 'mediflow.ai.provider-instance-lifecycle-link.v2' as const;

const PROVIDER_TYPES = ['ollama', 'openai', 'anthropic'] as const;
const CREDENTIAL_CLASSES = ['local_model', 'api_key', 'provider_oauth', 'host_subscription'] as const;
const OPERATIONS = ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const;
const DATA_USES = ['synthetic_nonclinical', 'redacted_clinical', 'clinical_identifiable'] as const;
const PROFILE_KEYS = [
    'schemaVersion', 'providerType', 'providerInstance', 'auth', 'model', 'capabilities', 'groups', 'bindings',
    'functionAllowlist', 'venue', 'egress', 'egressProfileRef', 'residency', 'residencyProfileRef', 'retention',
    'retentionProfileRef', 'dataUse', 'dataUseProfileRef',
] as const;
const INSTANCE_KEYS = ['instanceRef', 'workspaceRef'] as const;
const AUTH_KEYS = ['schemaVersion', 'credentialClass', 'authRef'] as const;
const BINDING_KEYS = ['operation', 'groupRef'] as const;
const LIFECYCLE_BINDING_KEYS = ['schemaVersion', 'providerInstanceRef', 'profile', 'lifecycle'] as const;
const LIFECYCLE_STATE_KEYS = ['schemaVersion', 'generation', 'status', 'binding'] as const;
const LIFECYCLE_PROVIDER_BINDING_KEYS = [
    'schemaVersion', 'operation', 'providerId', 'kind', 'venue', 'model', 'dataClass', 'egressProfileRef',
    'retentionProfileRef', 'consentRef', 'timeoutMs', 'maxInputBytes', 'maxOutputBytes', 'fallback',
] as const;
const OPAQUE_REFS = Object.freeze({
    instance: /^pvi_[0-9a-f]{32}$/,
    workspace: /^pws_[0-9a-f]{32}$/,
    auth: /^par_[0-9a-f]{32}$/,
});
const POLICY_REF = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/;
const MAX_GROUPS = 8;

type ProviderTypeV2 = typeof PROVIDER_TYPES[number];
type CredentialClassV2 = typeof CREDENTIAL_CLASSES[number];
type ProviderOperationV2 = typeof OPERATIONS[number];
type ProviderDataUseV2 = typeof DATA_USES[number];

const HOST_PROFILE_BINDINGS = Object.freeze([
    Object.freeze({ providerType: 'openai', model: 'gpt-5.4-mini', operation: 'document_synthesis',
        egressProfileRef: 'egress.synthetic.v1', dataUse: 'synthetic_nonclinical' }),
    Object.freeze({ providerType: 'anthropic', model: 'claude-sonnet-4-6', operation: 'document_synthesis',
        egressProfileRef: 'egress.synthetic.v1', dataUse: 'synthetic_nonclinical' }),
    Object.freeze({ providerType: 'ollama', model: 'qwen3.5:35b-a3b', operation: 'document_synthesis',
        egressProfileRef: 'egress.local.v1', dataUse: 'clinical_identifiable' }),
] as const);

export type ProviderInstanceProfileV2 = Readonly<{
    schemaVersion: typeof PROVIDER_INSTANCE_PROFILE_V2_SCHEMA;
    providerType: ProviderTypeV2;
    providerInstance: Readonly<{ instanceRef: string; workspaceRef: string | null }>;
    auth: Readonly<{
        schemaVersion: typeof PROVIDER_AUTH_POLICY_V2_SCHEMA;
        credentialClass: CredentialClassV2;
        authRef: string | null;
    }>;
    model: string;
    capabilities: readonly ProviderOperationV2[];
    groups: readonly string[];
    bindings: readonly Readonly<{ operation: ProviderOperationV2; groupRef: string }>[];
    functionAllowlist: readonly [];
    venue: 'local_process' | 'home_base' | 'cloud';
    egress: 'none' | 'official_provider_api';
    egressProfileRef: string;
    residency: 'local_device' | 'provider_managed';
    residencyProfileRef: string;
    retention: 'local_only' | 'provider_declared';
    retentionProfileRef: string;
    dataUse: ProviderDataUseV2;
    dataUseProfileRef: string;
}>;

export type ProviderInstanceLifecycleLinkV2 = Readonly<{
    schemaVersion: typeof PROVIDER_INSTANCE_LIFECYCLE_LINK_V2_SCHEMA;
    providerInstanceRef: string;
    providerType: ProviderTypeV2;
    operation: ProviderOperationV2;
    model: string;
    groupRef: string;
    functionAllowlist: readonly [];
    venue: ProviderInstanceProfileV2['venue'];
    egress: ProviderInstanceProfileV2['egress'];
    egressProfileRef: string;
    residency: ProviderInstanceProfileV2['residency'];
    residencyProfileRef: string;
    retention: ProviderInstanceProfileV2['retention'];
    retentionProfileRef: string;
    dataUse: ProviderDataUseV2;
    dataUseProfileRef: string;
    generation: number;
}>;

export class ProviderInstanceProfileV2Error extends Error {
    constructor(public readonly code: 'profile_invalid' | 'lifecycle_mismatch') {
        super(`Provider instance profile v2 rejected: ${code}`);
        this.name = 'ProviderInstanceProfileV2Error';
    }
}

function invalid(): never { throw new ProviderInstanceProfileV2Error('profile_invalid'); }

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || nodeUtilTypes.isProxy(value)) invalid();
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) invalid();
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) invalid();
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) invalid();
            output[key] = descriptor.value;
        }
        return output;
    } catch (error) {
        if (error instanceof ProviderInstanceProfileV2Error) throw error;
        return invalid();
    }
}

function exactDataArray(value: unknown, maximum: number): readonly unknown[] {
    try {
        if (!Array.isArray(value) || nodeUtilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
            || value.length > maximum) invalid();
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') invalid();
        const output: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
            if (keys[index] !== String(index)) invalid();
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) invalid();
            output.push(descriptor.value);
        }
        return output;
    } catch (error) {
        if (error instanceof ProviderInstanceProfileV2Error) throw error;
        return invalid();
    }
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
    return value as T;
}

function policyRef(value: unknown, prefix?: string): string {
    if (typeof value !== 'string' || value.length > 128 || !POLICY_REF.test(value)
        || (prefix && !value.startsWith(prefix))) invalid();
    return value;
}

function opaqueRef(value: unknown, pattern: RegExp, nullable = false): string | null {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !pattern.test(value)) invalid();
    return value;
}

function uniqueValues<T extends string>(value: unknown, allowed: readonly T[], maximum: number): readonly T[] {
    const raw = exactDataArray(value, maximum);
    const output = raw.map((item) => enumValue(item, allowed));
    if (output.length === 0 || new Set(output).size !== output.length) invalid();
    return Object.freeze(output);
}

function groups(value: unknown): readonly string[] {
    const raw = exactDataArray(value, MAX_GROUPS);
    const output = raw.map((item) => policyRef(item, 'group.'));
    if (output.length === 0 || new Set(output).size !== output.length) invalid();
    return Object.freeze(output);
}

function materializeLifecycle(value: unknown): Record<string, unknown> {
    const state = exactDataRecord(value, LIFECYCLE_STATE_KEYS);
    const binding = state.binding === null ? null : exactDataRecord(state.binding, LIFECYCLE_PROVIDER_BINDING_KEYS);
    return {
        schemaVersion: state.schemaVersion,
        generation: state.generation,
        status: state.status,
        binding,
    };
}

export function snapshotProviderInstanceProfileV2(value: unknown): ProviderInstanceProfileV2 {
    const source = exactDataRecord(value, PROFILE_KEYS);
    const instance = exactDataRecord(source.providerInstance, INSTANCE_KEYS);
    const auth = exactDataRecord(source.auth, AUTH_KEYS);
    const providerType = enumValue(source.providerType, PROVIDER_TYPES);
    const capabilities = uniqueValues(source.capabilities, OPERATIONS, OPERATIONS.length);
    const declaredGroups = groups(source.groups);
    const rawBindings = exactDataArray(source.bindings, OPERATIONS.length);
    const bindings = rawBindings.map((value) => {
        const binding = exactDataRecord(value, BINDING_KEYS);
        const operation = enumValue(binding.operation, OPERATIONS);
        const groupRef = policyRef(binding.groupRef, 'group.');
        if (!capabilities.includes(operation) || !declaredGroups.includes(groupRef)) invalid();
        return Object.freeze({ operation, groupRef });
    });
    if (bindings.length !== capabilities.length || new Set(bindings.map(({ operation }) => operation)).size !== bindings.length
        || declaredGroups.some((groupRef) => !bindings.some((binding) => binding.groupRef === groupRef))) invalid();
    if (exactDataArray(source.functionAllowlist, 0).length !== 0) invalid();

    const providerInstance = Object.freeze({
        instanceRef: opaqueRef(instance.instanceRef, OPAQUE_REFS.instance) as string,
        workspaceRef: opaqueRef(instance.workspaceRef, OPAQUE_REFS.workspace, true),
    });
    const credentialClass = enumValue(auth.credentialClass, CREDENTIAL_CLASSES);
    const authPolicy = Object.freeze({
        schemaVersion: auth.schemaVersion,
        credentialClass,
        authRef: opaqueRef(auth.authRef, OPAQUE_REFS.auth, true),
    });
    const hostProfileBindings = HOST_PROFILE_BINDINGS.filter((candidate) => candidate.providerType === providerType
        && capabilities.includes(candidate.operation));
    const matchedHostBinding = hostProfileBindings.length === capabilities.length
        ? hostProfileBindings.find((candidate) => candidate.model === source.model
            && candidate.egressProfileRef === source.egressProfileRef && candidate.dataUse === source.dataUse)
        : undefined;
    const model = matchedHostBinding?.model;
    if (source.schemaVersion !== PROVIDER_INSTANCE_PROFILE_V2_SCHEMA || auth.schemaVersion !== PROVIDER_AUTH_POLICY_V2_SCHEMA
        || !matchedHostBinding || typeof model !== 'string') invalid();

    const venue = enumValue(source.venue, ['local_process', 'home_base', 'cloud'] as const);
    const egress = enumValue(source.egress, ['none', 'official_provider_api'] as const);
    const residency = enumValue(source.residency, ['local_device', 'provider_managed'] as const);
    const retention = enumValue(source.retention, ['local_only', 'provider_declared'] as const);
    const dataUse = enumValue(source.dataUse, DATA_USES);
    const cloud = providerType === 'openai' || providerType === 'anthropic';
    if (cloud ? credentialClass !== 'api_key' || authPolicy.authRef === null || providerInstance.workspaceRef === null
        || venue !== 'cloud' || egress !== 'official_provider_api' || residency !== 'provider_managed' || retention !== 'provider_declared'
        : credentialClass !== 'local_model' || authPolicy.authRef !== null || providerInstance.workspaceRef !== null
        || (venue !== 'local_process' && venue !== 'home_base') || egress !== 'none' || residency !== 'local_device' || retention !== 'local_only') invalid();

    return Object.freeze({
        schemaVersion: source.schemaVersion,
        providerType, providerInstance, auth: authPolicy, model, capabilities,
        groups: declaredGroups, bindings: Object.freeze(bindings), functionAllowlist: Object.freeze([]),
        venue, egress, egressProfileRef: matchedHostBinding.egressProfileRef, residency,
        residencyProfileRef: policyRef(source.residencyProfileRef, 'residency.'), retention,
        retentionProfileRef: policyRef(source.retentionProfileRef, 'retention.'), dataUse,
        dataUseProfileRef: policyRef(source.dataUseProfileRef, 'data-use.'),
    } as ProviderInstanceProfileV2);
}

export function bindProviderLifecycleToInstanceProfileV2(
    value: unknown,
): ProviderInstanceLifecycleLinkV2 {
    let hostBinding: Record<string, unknown>;
    try { hostBinding = exactDataRecord(value, LIFECYCLE_BINDING_KEYS); }
    catch { throw new ProviderInstanceProfileV2Error('lifecycle_mismatch'); }
    if (hostBinding.schemaVersion !== PROVIDER_INSTANCE_LIFECYCLE_BINDING_V2_SCHEMA) {
        throw new ProviderInstanceProfileV2Error('lifecycle_mismatch');
    }
    const profile = snapshotProviderInstanceProfileV2(hostBinding.profile);
    let lifecycle: ReturnType<typeof snapshotProviderLifecycleV2>;
    try { lifecycle = snapshotProviderLifecycleV2(materializeLifecycle(hostBinding.lifecycle)); }
    catch { throw new ProviderInstanceProfileV2Error('lifecycle_mismatch'); }
    const binding = lifecycle.binding;
    const operationBinding = binding && profile.bindings.find(({ operation }) => operation === binding.operation);
    const expectedKind = profile.providerType === 'ollama' ? 'local' : 'cloud';
    if (typeof hostBinding.providerInstanceRef !== 'string'
        || !OPAQUE_REFS.instance.test(hostBinding.providerInstanceRef)
        || hostBinding.providerInstanceRef !== profile.providerInstance.instanceRef
        || !binding || !operationBinding || binding.providerId !== profile.providerType
        || binding.kind !== expectedKind || binding.model !== profile.model
        || binding.venue !== profile.venue || binding.dataClass !== profile.dataUse
        || binding.egressProfileRef !== profile.egressProfileRef
        || binding.retentionProfileRef !== profile.retentionProfileRef) {
        throw new ProviderInstanceProfileV2Error('lifecycle_mismatch');
    }
    return Object.freeze({
        schemaVersion: PROVIDER_INSTANCE_LIFECYCLE_LINK_V2_SCHEMA,
        providerInstanceRef: profile.providerInstance.instanceRef,
        providerType: profile.providerType,
        operation: operationBinding.operation,
        model: profile.model,
        groupRef: operationBinding.groupRef,
        functionAllowlist: profile.functionAllowlist,
        venue: profile.venue,
        egress: profile.egress,
        egressProfileRef: profile.egressProfileRef,
        residency: profile.residency,
        residencyProfileRef: profile.residencyProfileRef,
        retention: profile.retention,
        retentionProfileRef: profile.retentionProfileRef,
        dataUse: profile.dataUse,
        dataUseProfileRef: profile.dataUseProfileRef,
        generation: lifecycle.generation,
    });
}
