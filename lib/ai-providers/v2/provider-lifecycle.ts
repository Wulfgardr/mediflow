/* @Codex */

export const PROVIDER_BINDING_V2_SCHEMA = 'mediflow.ai.provider-binding.v2' as const;
export const PROVIDER_LIFECYCLE_V2_SCHEMA = 'mediflow.ai.provider-lifecycle.v2' as const;
export const PROVIDER_BINDING_V2_LIMITS = Object.freeze({ timeoutMs: 120_000, maxInputBytes: 1_048_576, maxOutputBytes: 262_144 });

const PROVIDERS = ['ollama', 'openai', 'anthropic'] as const;
const OPERATIONS = ['patient_insight', 'smart_import', 'document_synthesis', 'ocr', 'treatment_reasoning'] as const;
const DATA_CLASSES = ['synthetic_nonclinical', 'redacted_clinical', 'clinical_identifiable'] as const;
const STATUSES = ['absent', 'configured', 'validated', 'enabled', 'disabled', 'degraded', 'revoked_local'] as const;
const BINDING_KEYS = ['schemaVersion', 'operation', 'providerId', 'kind', 'venue', 'model', 'dataClass', 'egressProfileRef', 'retentionProfileRef', 'consentRef', 'timeoutMs', 'maxInputBytes', 'maxOutputBytes', 'fallback'] as const;
const STATE_KEYS = ['schemaVersion', 'generation', 'status', 'binding'] as const;

export type ProviderLifecycleV2Status = 'absent' | 'configured' | 'validated' | 'enabled' | 'disabled' | 'degraded' | 'revoked_local';
export type ProviderBindingV2 = Readonly<{
    schemaVersion: typeof PROVIDER_BINDING_V2_SCHEMA;
    operation: typeof OPERATIONS[number]; providerId: typeof PROVIDERS[number];
    kind: 'local' | 'cloud'; venue: 'local_process' | 'home_base' | 'cloud'; model: string;
    dataClass: typeof DATA_CLASSES[number]; egressProfileRef: string;
    retentionProfileRef: string; consentRef: string | null; timeoutMs: number;
    maxInputBytes: number; maxOutputBytes: number; fallback: 'none';
}>;
export type ProviderLifecycleV2 = Readonly<{
    schemaVersion: typeof PROVIDER_LIFECYCLE_V2_SCHEMA; generation: number;
    status: ProviderLifecycleV2Status; binding: ProviderBindingV2 | null;
}>;
const LEGAL_TRANSITIONS: Readonly<Record<ProviderLifecycleV2Status, Readonly<Partial<Record<string, ProviderLifecycleV2Status>>>>> = Object.freeze({
    absent: {},
    configured: { validate: 'validated', revoke_local: 'revoked_local' },
    validated: { enable: 'enabled', revoke_local: 'revoked_local' },
    enabled: { disable: 'disabled', degrade: 'degraded', revoke_local: 'revoked_local' },
    disabled: { enable: 'enabled', revoke_local: 'revoked_local' },
    degraded: { enable: 'enabled', disable: 'disabled', revoke_local: 'revoked_local' },
    revoked_local: {},
});

export class ProviderLifecycleV2Error extends Error {
    constructor(public readonly code: 'binding_invalid' | 'event_invalid' | 'transition_invalid' | 'snapshot_invalid') {
        super(`Provider lifecycle v2 rejected: ${code}`); this.name = 'ProviderLifecycleV2Error';
    }
}

function exactRecord(value: unknown, keys: readonly string[], code: ProviderLifecycleV2Error['code']): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderLifecycleV2Error(code);
    let prototype: object | null; let ownKeys: (string | symbol)[];
    try { prototype = Object.getPrototypeOf(value); ownKeys = Reflect.ownKeys(value); } catch { throw new ProviderLifecycleV2Error(code); }
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) throw new ProviderLifecycleV2Error(code);
    return value as Record<string, unknown>;
}
function boundedText(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value); }
function boundedPositive(value: unknown, maximum: number): value is number { return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum; }
function readExact(source: Record<string, unknown>, keys: readonly string[], code: ProviderLifecycleV2Error['code']): unknown[] {
    try { return keys.map((key) => source[key]); } catch { throw new ProviderLifecycleV2Error(code); }
}

function snapshotBinding(value: unknown): ProviderBindingV2 {
    const source = exactRecord(value, BINDING_KEYS, 'binding_invalid');
    const [schemaVersion, operation, providerId, kind, venue, model, dataClass, egressProfileRef, retentionProfileRef, consentRef, timeoutMs, maxInputBytes, maxOutputBytes, fallback] = readExact(source, BINDING_KEYS, 'binding_invalid');
    const local = providerId === 'ollama';
    if (schemaVersion !== PROVIDER_BINDING_V2_SCHEMA || !OPERATIONS.includes(operation as never)
        || !PROVIDERS.includes(providerId as never) || (local ? kind !== 'local' || (venue !== 'local_process' && venue !== 'home_base') : kind !== 'cloud' || venue !== 'cloud')
        || !boundedText(model) || !DATA_CLASSES.includes(dataClass as never) || !boundedText(egressProfileRef)
        || !boundedText(retentionProfileRef) || (consentRef !== null && !boundedText(consentRef))
        || !boundedPositive(timeoutMs, PROVIDER_BINDING_V2_LIMITS.timeoutMs)
        || !boundedPositive(maxInputBytes, PROVIDER_BINDING_V2_LIMITS.maxInputBytes)
        || !boundedPositive(maxOutputBytes, PROVIDER_BINDING_V2_LIMITS.maxOutputBytes) || fallback !== 'none') {
        throw new ProviderLifecycleV2Error('binding_invalid');
    }
    return Object.freeze({ schemaVersion, operation, providerId, kind, venue, model, dataClass, egressProfileRef, retentionProfileRef, consentRef, timeoutMs, maxInputBytes, maxOutputBytes, fallback } as ProviderBindingV2);
}

function freezeState(generation: number, status: ProviderLifecycleV2Status, binding: ProviderBindingV2 | null): ProviderLifecycleV2 {
    return Object.freeze({ schemaVersion: PROVIDER_LIFECYCLE_V2_SCHEMA, generation, status, binding });
}

export function snapshotProviderLifecycleV2(value: unknown): ProviderLifecycleV2 {
    const source = exactRecord(value, STATE_KEYS, 'snapshot_invalid');
    const [schemaVersion, generation, status, rawBinding] = readExact(source, STATE_KEYS, 'snapshot_invalid');
    if (schemaVersion !== PROVIDER_LIFECYCLE_V2_SCHEMA || !Number.isSafeInteger(generation) || (generation as number) < 0
        || !STATUSES.includes(status as never)) throw new ProviderLifecycleV2Error('snapshot_invalid');
    const empty = status === 'absent' || status === 'revoked_local';
    if ((status === 'absent' && generation !== 0) || (status !== 'absent' && generation === 0)
        || (empty ? rawBinding !== null : rawBinding === null)) throw new ProviderLifecycleV2Error('snapshot_invalid');
    return freezeState(generation as number, status as ProviderLifecycleV2Status, empty ? null : snapshotBinding(rawBinding));
}

export function createAbsentProviderLifecycleV2(): ProviderLifecycleV2 { return freezeState(0, 'absent', null); }

export function transitionProviderLifecycleV2(state: unknown, event: unknown): ProviderLifecycleV2 {
    const current = snapshotProviderLifecycleV2(state);
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new ProviderLifecycleV2Error('event_invalid');
    let keys: (string | symbol)[]; let type: unknown; let eventBinding: unknown; const input = event as Record<string, unknown>;
    try {
        const prototype = Object.getPrototypeOf(event);
        if (prototype !== Object.prototype && prototype !== null) throw new Error('prototype');
        keys = Reflect.ownKeys(event); type = input.type;
    } catch { throw new ProviderLifecycleV2Error('event_invalid'); }
    const configure = type === 'configure'; const expected = configure ? ['type', 'binding'] : ['type'];
    if (keys.length !== expected.length || keys.some((key) => typeof key !== 'string' || !expected.includes(key))) throw new ProviderLifecycleV2Error('event_invalid');
    if (configure) {
        if (current.generation === Number.MAX_SAFE_INTEGER) throw new ProviderLifecycleV2Error('transition_invalid');
        try { eventBinding = input.binding; } catch { throw new ProviderLifecycleV2Error('event_invalid'); }
        return freezeState(current.generation + 1, 'configured', snapshotBinding(eventBinding));
    }
    const target = typeof type === 'string' ? LEGAL_TRANSITIONS[current.status][type] : undefined;
    if (!target) throw new ProviderLifecycleV2Error(typeof type === 'string' && ['validate', 'enable', 'disable', 'degrade', 'revoke_local'].includes(type) ? 'transition_invalid' : 'event_invalid');
    return freezeState(current.generation, target, target === 'revoked_local' ? null : current.binding);
}
