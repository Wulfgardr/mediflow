import 'server-only';

/* @Codex */
import { types } from 'node:util';

import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity';
import { type TreatmentReasoningEnvelope } from '../../treatment-reasoning-contract';
import {
    createTreatmentReasoningAthenaOutputContract,
    type TreatmentReasoningAthenaSourceBinding,
} from './treatment-reasoning-athena-output-contract';

type HostReceipt = Readonly<{
    provider: 'athena_mlx'; venue: 'local_process'; credentialClass: 'local_model';
    model: typeof ATHENA_R1_QWEN3_8B_MODEL_ID; receiptRef: string; provenanceRef: string;
}>;
type Completed = Readonly<{
    status: 'completed'; code: null; envelope: TreatmentReasoningEnvelope;
    sourceBindings: readonly TreatmentReasoningAthenaSourceBinding[]; host: HostReceipt;
    writesPerformed: 0; applyPolicy: 'none'; fallback: 'denied_by_contract';
}>;
type Denied = Readonly<{
    status: 'denied'; code: 'input_invalid' | 'host_invalid' | 'provider_invalid' | 'provider_failed' | 'execution_timeout';
    envelope: null; sourceBindings: null; host: null; writesPerformed: 0; applyPolicy: 'none'; fallback: 'denied_by_contract';
}>;
export type TreatmentReasoningAthenaExecutionResult = Completed | Denied;

type Snapshot = Readonly<{ evidenceRefs: readonly string[]; receiptRef: string; provenanceRef: string }>;
type Host = Readonly<{ policy: () => unknown; invoke: (input: Readonly<{ instruction: string; signal: AbortSignal }>) => unknown }>;
type Configuration = Readonly<{ host: Host; timeoutMs: number }>;
const COMMON = Object.freeze({ writesPerformed: 0 as const, applyPolicy: 'none' as const, fallback: 'denied_by_contract' as const });
const REF = /^[a-z][a-z0-9._-]{2,127}$/u;
const MAX_REFS = 16;
const MAX_TIMEOUT_MS = 60_000;

export class TreatmentReasoningAthenaExecutionConfigurationError extends Error {
    constructor() { super('Treatment reasoning ATHENA execution configuration rejected'); this.name = 'TreatmentReasoningAthenaExecutionConfigurationError'; }
}

function record(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
    try {
        if (types.isProxy(value) || typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) return null;
        const copy: Record<string, unknown> = {};
        for (const key of expected) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function ref(value: unknown): string | null { return typeof value === 'string' && REF.test(value) ? value : null; }

function refs(value: unknown, count: number): readonly string[] | null {
    try {
        if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || count < 1 || count > MAX_REFS || value.length !== count) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== count + 1 || !keys.includes('length')) return null;
        const result: string[] = []; const seen = new Set<string>();
        for (let index = 0; index < count; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            const item = descriptor?.enumerable && 'value' in descriptor ? ref(descriptor.value) : null;
            if (!item || seen.has(item)) return null;
            seen.add(item); result.push(item);
        }
        return Object.freeze(result);
    } catch { return null; }
}

function zeroArg(value: unknown): value is () => unknown {
    if (types.isProxy(value) || typeof value !== 'function') return false;
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    return Boolean(length && 'value' in length && length.value === 0);
}

function nativePromise(value: unknown): value is Promise<unknown> {
    return !types.isProxy(value) && value instanceof Promise && !Object.hasOwn(value, 'then');
}

function configuration(value: unknown): Configuration | null {
    const config = record(value, ['host', 'timeoutMs']);
    const host = config && record(config.host, ['policy', 'invoke']);
    if (!config || !host || !zeroArg(host.policy) || types.isProxy(host.invoke) || typeof host.invoke !== 'function'
        || !Number.isSafeInteger(config.timeoutMs) || (config.timeoutMs as number) < 1 || (config.timeoutMs as number) > MAX_TIMEOUT_MS) return null;
    return Object.freeze({ host: Object.freeze({ policy: host.policy as () => unknown, invoke: host.invoke as Host['invoke'] }), timeoutMs: config.timeoutMs as number });
}

function snapshot(value: unknown): Snapshot | null {
    const input = record(value, ['preview', 'evidenceRefs']);
    const preview = input && record(input.preview, ['schema', 'capability', 'stage', 'review', 'uncertainty', 'evidence', 'provenanceRef', 'receiptRef']);
    const uncertainty = preview && record(preview.uncertainty, ['level', 'source']);
    const evidence = preview && record(preview.evidence, ['source', 'count']);
    const receiptRef = preview && ref(preview.receiptRef); const provenanceRef = preview && ref(preview.provenanceRef);
    if (!input || !preview || !uncertainty || !evidence || !receiptRef || !provenanceRef || !Object.isFrozen(input.preview)
        || !Object.isFrozen(preview.uncertainty) || !Object.isFrozen(preview.evidence)
        || preview.schema !== 'mediflow.ai.treatment-reasoning-preview-envelope.v1' || preview.capability !== 'treatment_reasoning'
        || preview.stage !== 'preview' || preview.review !== 'required' || uncertainty.level !== 'low' || uncertainty.source !== 'degraded_default'
        || evidence.source !== 'host_minimized' || !Number.isSafeInteger(evidence.count)) return null;
    const evidenceRefs = refs(input.evidenceRefs, evidence.count as number);
    return evidenceRefs ? Object.freeze({ evidenceRefs, receiptRef, provenanceRef }) : null;
}

function hostReceipt(value: unknown, input: Snapshot): HostReceipt | null {
    const policy = record(value, ['provider', 'venue', 'credentialClass', 'model', 'receiptRef', 'provenanceRef']);
    const receiptRef = policy && ref(policy.receiptRef); const provenanceRef = policy && ref(policy.provenanceRef);
    if (!policy || !receiptRef || !provenanceRef || policy.provider !== 'athena_mlx' || policy.venue !== 'local_process'
        || policy.credentialClass !== 'local_model' || policy.model !== ATHENA_R1_QWEN3_8B_MODEL_ID
        || receiptRef !== input.receiptRef || provenanceRef !== input.provenanceRef) return null;
    return Object.freeze({ provider: 'athena_mlx', venue: 'local_process', credentialClass: 'local_model', model: ATHENA_R1_QWEN3_8B_MODEL_ID, receiptRef, provenanceRef });
}

function instruction(input: Snapshot): string {
    return ['task=treatment_reasoning', 'stage=preview', 'review=required', `evidence_refs=${input.evidenceRefs.join(',')}`, 'response_schema=mediflow.treatment_reasoning.v1'].join('\n');
}

function denied(code: Denied['code']): Denied { return Object.freeze({ status: 'denied', code, envelope: null, sourceBindings: null, host: null, ...COMMON }); }

async function invokeOnce(host: Host, timeoutMs: number, input: Snapshot): Promise<Readonly<{ kind: 'value'; value: unknown }> | Readonly<{ kind: 'failed' }> | Readonly<{ kind: 'timeout' }>> {
    const controller = new AbortController();
    return new Promise((resolve) => {
        let settled = false;
        const finish = (outcome: Readonly<{ kind: 'value'; value: unknown }> | Readonly<{ kind: 'failed' }> | Readonly<{ kind: 'timeout' }>) => {
            if (settled) return; settled = true; clearTimeout(timer); resolve(outcome);
        };
        const timer = setTimeout(() => { controller.abort(); finish(Object.freeze({ kind: 'timeout' as const })); }, timeoutMs);
        Promise.resolve().then(() => {
            try {
                const result = host.invoke(Object.freeze({ instruction: instruction(input), signal: controller.signal }));
                if (!nativePromise(result)) return finish(Object.freeze({ kind: 'value' as const, value: result }));
                Promise.prototype.then.call(result, (value) => finish(Object.freeze({ kind: 'value' as const, value })), () => finish(Object.freeze({ kind: 'failed' as const })));
            } catch { finish(Object.freeze({ kind: 'failed' as const })); }
        }, () => finish(Object.freeze({ kind: 'failed' as const })));
    });
}

/** Server-only one-shot adapter. It has no route, persistence, apply, retry, fallback, or caller prompt. */
export function createTreatmentReasoningAthenaExecution(value: unknown): Readonly<{ execute(input: unknown): Promise<TreatmentReasoningAthenaExecutionResult> }> {
    const config = configuration(value);
    if (!config) throw new TreatmentReasoningAthenaExecutionConfigurationError();
    return Object.freeze({ async execute(value: unknown): Promise<TreatmentReasoningAthenaExecutionResult> {
        const input = snapshot(value);
        if (!input) return denied('input_invalid');
        let host: HostReceipt | null;
        try { host = hostReceipt(config.host.policy(), input); } catch { host = null; }
        if (!host) return denied('host_invalid');
        const outcome = await invokeOnce(config.host, config.timeoutMs, input);
        if (outcome.kind === 'timeout') return denied('execution_timeout');
        if (outcome.kind === 'failed') return denied('provider_failed');
        try {
            const normalized = createTreatmentReasoningAthenaOutputContract({ allowedEvidenceRefs: input.evidenceRefs }).normalize(outcome.value);
            return normalized.status === 'accepted'
                ? Object.freeze({ status: 'completed' as const, code: null, envelope: normalized.value, sourceBindings: normalized.sourceBindings, host, ...COMMON })
                : denied('provider_invalid');
        } catch { return denied('provider_invalid'); }
    } });
}
