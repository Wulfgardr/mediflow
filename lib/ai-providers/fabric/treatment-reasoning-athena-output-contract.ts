import 'server-only';

/* @Codex */
import { types } from 'node:util';

import { TREATMENT_REASONING_SCHEMA_VERSION, type TreatmentReasoningEnvelope } from '../../treatment-reasoning-contract';

const OPAQUE_REF = /^[a-z][a-z0-9._-]{2,127}$/u;
const ACTIONS = new Set(['no_action', 'review_only', 'open_therapy_form_prefill', 'open_monitoring_form_prefill', 'open_diagnosis_review']);
const POLICIES = new Set(['no_write', 'review_only', 'form_prefill_only']);
const SEVERITIES = new Set(['info', 'caution', 'urgent_review']);
const MAX = Object.freeze({ summary: 480, recommendation: 900, text: 400, label: 180, rationale: 400, evidence: 10, reasoning: 8, caveats: 8, flags: 8, actions: 8, refs: 12, bindings: 18, tools: 12, limitations: 8 });

export type TreatmentReasoningAthenaSourceBinding = Readonly<{ claimPath: string; claim: string; evidenceRefs: readonly string[] }>;
type Accepted = Readonly<{ status: 'accepted'; code: null; value: TreatmentReasoningEnvelope; sourceBindings: readonly TreatmentReasoningAthenaSourceBinding[]; writesPerformed: 0; applyPolicy: 'none' }>;
type Denied = Readonly<{ status: 'denied'; code: 'configuration_invalid' | 'output_invalid'; value: null; writesPerformed: 0; applyPolicy: 'none' }>;
export type TreatmentReasoningAthenaOutputContractResult = Accepted | Denied;

const COMMON = Object.freeze({ writesPerformed: 0 as const, applyPolicy: 'none' as const });

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (types.isProxy(value) || typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const actual = Reflect.ownKeys(value);
        if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) return null;
        const copy: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function array(value: unknown, maximum: number): readonly unknown[] | null {
    try {
        if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1 || !keys.includes('length')) return null;
        const copy = new Array<unknown>(value.length);
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            copy[index] = descriptor.value;
        }
        return Object.freeze(copy);
    } catch { return null; }
}

function text(value: unknown, maximum: number): string | null {
    if (typeof value !== 'string' || value.length > maximum) return null;
    const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
    return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

function ref(value: unknown): string | null { return typeof value === 'string' && OPAQUE_REF.test(value) ? value : null; }

function refs(value: unknown, allowed: ReadonlySet<string>): string[] | null {
    const input = array(value, MAX.refs);
    if (!input) return null;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of input) {
        const valueRef = ref(entry);
        if (!valueRef || !allowed.has(valueRef) || seen.has(valueRef)) return null;
        seen.add(valueRef);
        result.push(valueRef);
    }
    return Object.freeze(result) as string[];
}

function strings(value: unknown, maximum: number, chars: number = MAX.text): string[] | null {
    const input = array(value, maximum);
    if (!input) return null;
    const result: string[] = [];
    for (const entry of input) {
        const item = text(entry, chars);
        if (!item) return null;
        result.push(item);
    }
    return Object.freeze(result) as string[];
}

function keyEvidence(value: unknown, allowed: ReadonlySet<string>): TreatmentReasoningEnvelope['data']['keyEvidence'] | null {
    const input = array(value, MAX.evidence);
    if (!input) return null;
    const result: TreatmentReasoningEnvelope['data']['keyEvidence'] = [];
    const seen = new Set<string>();
    for (const entry of input) {
        const item = record(entry, ['id', 'statement', 'evidenceRefs']);
        const id = item && ref(item.id);
        const statement = item && text(item.statement, MAX.text);
        const evidenceRefs = item && refs(item.evidenceRefs, allowed);
        if (!item || !id || seen.has(id) || !statement || !evidenceRefs || evidenceRefs.length === 0) return null;
        seen.add(id);
        result.push(Object.freeze({ id, statement, evidenceRefs }));
    }
    return Object.freeze(result) as TreatmentReasoningEnvelope['data']['keyEvidence'];
}

function safetyFlags(value: unknown, allowed: ReadonlySet<string>): TreatmentReasoningEnvelope['data']['safetyFlags'] | null {
    const input = array(value, MAX.flags);
    if (!input) return null;
    const result: TreatmentReasoningEnvelope['data']['safetyFlags'] = [];
    const seen = new Set<string>();
    for (const entry of input) {
        const item = record(entry, ['id', 'severity', 'label', 'rationale', 'evidenceRefs']);
        const id = item && ref(item.id);
        const label = item && text(item.label, MAX.label);
        const rationale = item && text(item.rationale, MAX.rationale);
        const evidenceRefs = item && refs(item.evidenceRefs, allowed);
        if (!item || !id || seen.has(id) || typeof item.severity !== 'string' || !SEVERITIES.has(item.severity) || !label || !rationale || !evidenceRefs || evidenceRefs.length === 0) return null;
        seen.add(id);
        result.push(Object.freeze({ id, severity: item.severity as 'info' | 'caution' | 'urgent_review', label, rationale, evidenceRefs }));
    }
    return Object.freeze(result) as TreatmentReasoningEnvelope['data']['safetyFlags'];
}

function actions(value: unknown, allowed: ReadonlySet<string>): TreatmentReasoningEnvelope['data']['suggestedActions'] | null {
    const input = array(value, MAX.actions);
    if (!input) return null;
    const result: TreatmentReasoningEnvelope['data']['suggestedActions'] = [];
    const seen = new Set<string>();
    for (const entry of input) {
        const item = record(entry, ['id', 'intent', 'label', 'rationale', 'writePolicy', 'evidenceRefs']);
        const id = item && ref(item.id);
        const label = item && text(item.label, MAX.label);
        const rationale = item && text(item.rationale, MAX.rationale);
        const evidenceRefs = item && refs(item.evidenceRefs, allowed);
        if (!item || !id || seen.has(id) || typeof item.intent !== 'string' || !ACTIONS.has(item.intent) || !label || !rationale || typeof item.writePolicy !== 'string' || !POLICIES.has(item.writePolicy) || !evidenceRefs || evidenceRefs.length === 0) return null;
        seen.add(id);
        result.push(Object.freeze({ id, intent: item.intent as TreatmentReasoningEnvelope['data']['suggestedActions'][number]['intent'], label, rationale, writePolicy: item.writePolicy as TreatmentReasoningEnvelope['data']['suggestedActions'][number]['writePolicy'], evidenceRefs }));
    }
    return Object.freeze(result) as TreatmentReasoningEnvelope['data']['suggestedActions'];
}

function trace(value: unknown): TreatmentReasoningEnvelope['data']['trace'] | null {
    const item = record(value, ['mode', 'toolsUsed', 'limitations']);
    const toolsUsed = item && array(item.toolsUsed, MAX.tools);
    const limitations = item && strings(item.limitations, MAX.limitations, MAX.label);
    if (!item || item.mode !== 'local_model' || !toolsUsed || !limitations) return null;
    const tools: string[] = [];
    for (const tool of toolsUsed) {
        const valueRef = ref(tool);
        if (!valueRef) return null;
        tools.push(valueRef);
    }
    return Object.freeze({ mode: 'local_model', toolsUsed: Object.freeze(tools) as string[], limitations });
}

function snapshotAllowlist(value: unknown): ReadonlySet<string> | null {
    const input = array(value, MAX.refs);
    if (!input || input.length === 0) return null;
    const result = new Set<string>();
    for (const entry of input) {
        const valueRef = ref(entry);
        if (!valueRef || result.has(valueRef)) return null;
        result.add(valueRef);
    }
    return result;
}

function claimTargets(summary: string, recommendation: string, reasoning: readonly string[], caveats: readonly string[]): readonly Readonly<{ claimPath: string; claim: string }>[] {
    return Object.freeze([
        Object.freeze({ claimPath: 'summary', claim: summary }),
        Object.freeze({ claimPath: 'data.recommendation', claim: recommendation }),
        ...reasoning.map((claim, index) => Object.freeze({ claimPath: `data.reasoning.${index}`, claim })),
        ...caveats.map((claim, index) => Object.freeze({ claimPath: `data.caveats.${index}`, claim })),
    ]);
}

function sourceBindings(value: unknown, allowed: ReadonlySet<string>, expected: readonly Readonly<{ claimPath: string; claim: string }>[]): readonly TreatmentReasoningAthenaSourceBinding[] | null {
    const input = array(value, MAX.bindings);
    if (!input || input.length !== expected.length) return null;
    const expectedByPath = new Map(expected.map((item) => [item.claimPath, item.claim]));
    const accepted = new Map<string, TreatmentReasoningAthenaSourceBinding>();
    for (const entry of input) {
        const item = record(entry, ['claimPath', 'claim', 'evidenceRefs']);
        const claimPath = item && text(item.claimPath, MAX.label);
        const claim = item && text(item.claim, MAX.recommendation);
        const evidenceRefs = item && refs(item.evidenceRefs, allowed);
        if (!item || !claimPath || !claim || expectedByPath.get(claimPath) !== claim || !evidenceRefs || evidenceRefs.length === 0 || accepted.has(claimPath)) return null;
        accepted.set(claimPath, Object.freeze({ claimPath, claim, evidenceRefs }));
    }
    const normalized: TreatmentReasoningAthenaSourceBinding[] = [];
    for (const target of expected) {
        const binding = accepted.get(target.claimPath);
        if (!binding) return null;
        normalized.push(binding);
    }
    return Object.freeze(normalized);
}

/** Server-only closed-record parser for the minimized provider payload; host attestation stays outside this boundary. */
export function createTreatmentReasoningAthenaOutputContract(configuration: unknown): Readonly<{ normalize(value: unknown): TreatmentReasoningAthenaOutputContractResult }> {
    const config = record(configuration, ['allowedEvidenceRefs']);
    const allowed = config && snapshotAllowlist(config.allowedEvidenceRefs);
    if (!config || !allowed) throw new Error('Treatment reasoning ATHENA output contract configuration rejected');
    return Object.freeze({ normalize(value: unknown): TreatmentReasoningAthenaOutputContractResult {
        const input = record(value, ['schemaVersion', 'task', 'summary', 'data', 'sourceBindings']);
        const summary = input && text(input.summary, MAX.summary);
        const data = input && record(input.data, ['recommendation', 'keyEvidence', 'reasoning', 'caveats', 'safetyFlags', 'suggestedActions', 'trace']);
        const recommendation = data && text(data.recommendation, MAX.recommendation);
        const evidence = data && keyEvidence(data.keyEvidence, allowed);
        const reasoning = data && strings(data.reasoning, MAX.reasoning);
        const caveats = data && strings(data.caveats, MAX.caveats);
        const flags = data && safetyFlags(data.safetyFlags, allowed);
        const suggestedActions = data && actions(data.suggestedActions, allowed);
        const normalizedTrace = data && trace(data.trace);
        const normalizedBindings = input && summary && recommendation && reasoning && caveats
            ? sourceBindings(input.sourceBindings, allowed, claimTargets(summary, recommendation, reasoning, caveats))
            : null;
        if (!input || input.schemaVersion !== TREATMENT_REASONING_SCHEMA_VERSION || input.task !== 'treatment_reasoning' || !summary || !data || !recommendation || !evidence || !reasoning || !caveats || !flags || !suggestedActions || !normalizedTrace || !normalizedBindings) return Object.freeze({ status: 'denied' as const, code: 'output_invalid' as const, value: null, ...COMMON });
        const normalized = Object.freeze({ schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION, task: 'treatment_reasoning' as const, summary, data: Object.freeze({ recommendation, keyEvidence: evidence, reasoning, caveats, safetyFlags: flags, suggestedActions, trace: normalizedTrace }) });
        return Object.freeze({ status: 'accepted' as const, code: null, value: normalized, sourceBindings: normalizedBindings, ...COMMON });
    } });
}
