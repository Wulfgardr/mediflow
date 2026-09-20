/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity';
import type { PortableEngineMetadata } from './treatment-reasoning-portable-runtime';

import { TREATMENT_REASONING_SCHEMA_VERSION, type TreatmentReasoningEnvelope } from '../../treatment-reasoning-contract';

const REF = /^[A-Za-z][A-Za-z0-9._:-]{2,159}$/u;
const MAX = Object.freeze({ summary: 480, recommendation: 900, text: 400, label: 180, rationale: 400, evidence: 10, reasoning: 8, caveats: 8, flags: 8, actions: 8, refs: 12, bindings: 18, tools: 12, limitations: 8 });
const ACTIONS = new Set(['no_action', 'review_only', 'open_therapy_form_prefill', 'open_monitoring_form_prefill', 'open_diagnosis_review']);
const POLICIES = new Set(['no_write', 'review_only', 'form_prefill_only']);
const SEVERITIES = new Set(['info', 'caution', 'urgent_review']);

export const TREATMENT_REASONING_ATHENA_OUTPUT_V2_RESULT_SCHEMA = 'mediflow.ai.treatment-reasoning-athena-output-result.v2' as const;
export const TREATMENT_REASONING_ATHENA_OUTPUT_V2_ATTESTATION_SCHEMA = 'mediflow.ai.treatment-reasoning-athena-attestation.v1' as const;
export type TreatmentReasoningAthenaV2SourceBinding = Readonly<{ claimPath: string; claim: string; evidenceRefs: readonly string[] }>;
export type TreatmentReasoningAthenaV2Attestation = Readonly<{ schema: typeof TREATMENT_REASONING_ATHENA_OUTPUT_V2_ATTESTATION_SCHEMA; readiness: 'available_unqualified'; provider: 'athena_mlx'; venue: 'local_process'; egress: 'none'; receiptRef: string; provenanceRef: string }>;
export type TreatmentReasoningAthenaV2Value = TreatmentReasoningEnvelope;
type Common = Readonly<{ writesPerformed: 0; applyPolicy: 'none' }>;
type Accepted = Readonly<{ status: 'accepted'; code: null; resultSchema: typeof TREATMENT_REASONING_ATHENA_OUTPUT_V2_RESULT_SCHEMA; value: TreatmentReasoningAthenaV2Value; sourceBindings: readonly TreatmentReasoningAthenaV2SourceBinding[]; attestation: TreatmentReasoningAthenaV2Attestation }> & Common;
type Denied = Readonly<{ status: 'denied'; code: 'output_invalid'; value: null; sourceBindings: null; attestation: null }> & Common;
export type TreatmentReasoningAthenaV2Result = Accepted | Denied;

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
        if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
        const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== length + 1 || !keys.includes('length')) return null;
        const result: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            result.push(descriptor.value);
        }
        return Object.freeze(result);
    } catch { return null; }
}

function text(value: unknown, maximum: number = MAX.text): string | null {
    if (typeof value !== 'string' || value.length > maximum) return null;
    const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
    return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

function ref(value: unknown): string | null { return typeof value === 'string' && REF.test(value) ? value : null; }

function refs(value: unknown, allowed?: ReadonlySet<string>): string[] | null {
    const input = array(value, MAX.refs);
    if (!input) return null;
    const result: string[] = [];
    for (const item of input) {
        const itemRef = ref(item);
        if (!itemRef || result.includes(itemRef) || (allowed && !allowed.has(itemRef))) return null;
        result.push(itemRef);
    }
    return Object.freeze(result) as string[];
}

function strings(value: unknown, maximum: number, characters: number = MAX.text): string[] | null {
    const input = array(value, maximum);
    if (!input) return null;
    const result: string[] = [];
    for (const item of input) { const normalized = text(item, characters); if (!normalized) return null; result.push(normalized); }
    return Object.freeze(result) as string[];
}

function evidence(value: unknown, allowed: ReadonlySet<string>): TreatmentReasoningEnvelope['data']['keyEvidence'] | null {
    const input = array(value, MAX.evidence);
    if (!input) return null;
    const result: TreatmentReasoningEnvelope['data']['keyEvidence'] = []; const seen = new Set<string>();
    for (const value of input) {
        const item = record(value, ['id', 'statement', 'evidenceRefs']); const id = item && ref(item.id); const statement = item && text(item.statement); const evidenceRefs = item && refs(item.evidenceRefs, allowed);
        if (!item || !id || !statement || !evidenceRefs || evidenceRefs.length === 0 || seen.has(id)) return null;
        seen.add(id); result.push(Object.freeze({ id, statement, evidenceRefs }));
    }
    return Object.freeze(result) as TreatmentReasoningEnvelope['data']['keyEvidence'];
}

function flags(value: unknown, allowed: ReadonlySet<string>): TreatmentReasoningEnvelope['data']['safetyFlags'] | null {
    const input = array(value, MAX.flags);
    if (!input) return null;
    const result: TreatmentReasoningEnvelope['data']['safetyFlags'] = []; const seen = new Set<string>();
    for (const value of input) {
        const item = record(value, ['id', 'severity', 'label', 'rationale', 'evidenceRefs']); const id = item && ref(item.id); const label = item && text(item.label, MAX.label); const rationale = item && text(item.rationale, MAX.rationale); const evidenceRefs = item && refs(item.evidenceRefs, allowed);
        if (!item || !id || !label || !rationale || !evidenceRefs || evidenceRefs.length === 0 || seen.has(id) || typeof item.severity !== 'string' || !SEVERITIES.has(item.severity)) return null;
        seen.add(id); result.push(Object.freeze({ id, severity: item.severity as 'info' | 'caution' | 'urgent_review', label, rationale, evidenceRefs }));
    }
    return Object.freeze(result) as TreatmentReasoningEnvelope['data']['safetyFlags'];
}

function actions(value: unknown, allowed: ReadonlySet<string>): TreatmentReasoningEnvelope['data']['suggestedActions'] | null {
    const input = array(value, MAX.actions);
    if (!input) return null;
    const result: TreatmentReasoningEnvelope['data']['suggestedActions'] = []; const seen = new Set<string>();
    for (const value of input) {
        const item = record(value, ['id', 'intent', 'label', 'rationale', 'writePolicy', 'evidenceRefs']); const id = item && ref(item.id); const label = item && text(item.label, MAX.label); const rationale = item && text(item.rationale, MAX.rationale); const evidenceRefs = item && refs(item.evidenceRefs, allowed);
        if (!item || !id || !label || !rationale || !evidenceRefs || evidenceRefs.length === 0 || seen.has(id) || typeof item.intent !== 'string' || !ACTIONS.has(item.intent) || typeof item.writePolicy !== 'string' || !POLICIES.has(item.writePolicy)) return null;
        seen.add(id); result.push(Object.freeze({ id, intent: item.intent as TreatmentReasoningEnvelope['data']['suggestedActions'][number]['intent'], label, rationale, writePolicy: item.writePolicy as TreatmentReasoningEnvelope['data']['suggestedActions'][number]['writePolicy'], evidenceRefs }));
    }
    return Object.freeze(result) as TreatmentReasoningEnvelope['data']['suggestedActions'];
}

function trace(value: unknown): TreatmentReasoningEnvelope['data']['trace'] | null {
    const item = record(value, ['mode', 'toolsUsed', 'limitations']); const tools = item && array(item.toolsUsed, MAX.tools); const limitations = item && strings(item.limitations, MAX.limitations, MAX.label);
    if (!item || item.mode !== 'local_model' || !tools || !limitations) return null;
    const toolsUsed: string[] = [];
    for (const tool of tools) { const toolRef = ref(tool); if (!toolRef) return null; toolsUsed.push(toolRef); }
    return Object.freeze({ mode: 'local_model', toolsUsed: Object.freeze(toolsUsed) as string[], limitations });
}

function claims(summary: string, recommendation: string, reasoning: readonly string[], caveats: readonly string[]): readonly Readonly<{ claimPath: string; claim: string }>[] {
    const result: Readonly<{ claimPath: string; claim: string }>[] = [{ claimPath: 'summary', claim: summary }, { claimPath: 'data.recommendation', claim: recommendation }, ...reasoning.map((claim, index) => ({ claimPath: `data.reasoning.${index}`, claim })), ...caveats.map((claim, index) => ({ claimPath: `data.caveats.${index}`, claim }))].map((item) => Object.freeze(item));
    return Object.freeze(result);
}

function bindings(value: unknown, allowed: ReadonlySet<string>, expected: readonly Readonly<{ claimPath: string; claim: string }>[]): readonly TreatmentReasoningAthenaV2SourceBinding[] | null {
    const input = array(value, MAX.bindings);
    if (!input || input.length !== expected.length) return null;
    const remaining = new Map(expected.map((item) => [item.claimPath, item.claim]));
    const found = new Map<string, TreatmentReasoningAthenaV2SourceBinding>();
    for (const value of input) {
        const inputBinding = record(value, ['claimPath', 'claim', 'evidenceRefs']);
        const claimPath = inputBinding && text(inputBinding.claimPath);
        const claim = inputBinding && text(inputBinding.claim);
        const evidenceRefs = inputBinding && refs(inputBinding.evidenceRefs, allowed);
        if (!inputBinding || !claimPath || !claim || !evidenceRefs || evidenceRefs.length === 0 || remaining.get(claimPath) !== claim || found.has(claimPath)) return null;
        found.set(claimPath, Object.freeze({ claimPath, claim, evidenceRefs }));
    }
    const normalized = expected.map(({ claimPath }) => found.get(claimPath));
    return normalized.some((binding) => !binding) ? null : Object.freeze(normalized as TreatmentReasoningAthenaV2SourceBinding[]);
}

function attest(value: unknown): TreatmentReasoningAthenaV2Attestation | null {
    const input = record(value, ['schema', 'readiness', 'provider', 'venue', 'egress', 'receiptRef', 'provenanceRef']);
    const receiptRef = input && ref(input.receiptRef);
    const provenanceRef = input && ref(input.provenanceRef);
    if (!input || input.schema !== TREATMENT_REASONING_ATHENA_OUTPUT_V2_ATTESTATION_SCHEMA || input.readiness !== 'available_unqualified' || input.provider !== 'athena_mlx' || input.venue !== 'local_process' || input.egress !== 'none' || !receiptRef || !provenanceRef) return null;
    return Object.freeze({ schema: TREATMENT_REASONING_ATHENA_OUTPUT_V2_ATTESTATION_SCHEMA, readiness: 'available_unqualified', provider: 'athena_mlx', venue: 'local_process', egress: 'none', receiptRef, provenanceRef });
}

export type TreatmentReasoningPortableAttestation = PortableEngineMetadata & Readonly<{
    schema: 'mediflow.ai.treatment-reasoning-engine-attestation.v2'; readiness: 'available_unqualified';
    venue: 'local_process'; egress: 'none'; receiptRef: string; provenanceRef: string;
}>;
/** Distinct closed schema. The MLX v1 parser above is intentionally not broadened. */
export function snapshotTreatmentReasoningPortableAttestation(value: unknown): TreatmentReasoningPortableAttestation | null {
    const item = record(value, ['schema', 'readiness', 'provider', 'model', 'platform', 'artifactDigest', 'runtimeDigest',
        'workerDigest', 'admissionRevision', 'venue', 'egress', 'receiptRef', 'provenanceRef']);
    if (!item || item.schema !== 'mediflow.ai.treatment-reasoning-engine-attestation.v2'
        || item.provider !== 'athena_transformers' || item.model !== ATHENA_R1_QWEN3_8B_MODEL_ID
        || !['linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'].includes(item.platform as string)
        || !['artifactDigest', 'runtimeDigest', 'workerDigest'].every(k => typeof item[k] === 'string' && /^[0-9a-f]{64}$/u.test(item[k] as string))
        || !Number.isSafeInteger(item.admissionRevision) || (item.admissionRevision as number) < 1
        || item.readiness !== 'available_unqualified' || item.venue !== 'local_process' || item.egress !== 'none'
        || !ref(item.receiptRef) || !ref(item.provenanceRef)) return null;
    return Object.freeze(item) as TreatmentReasoningPortableAttestation;
}
export function createTreatmentReasoningPortableOutputContractV2(configuration: unknown) {
    const config = record(configuration, ['allowedEvidenceRefs', 'attestation']);
    const allowedRefs = config && refs(config.allowedEvidenceRefs);
    const attestation = config && snapshotTreatmentReasoningPortableAttestation(config.attestation);
    if (!allowedRefs?.length || !attestation) throw new Error('Treatment reasoning portable V2 configuration rejected');
    return outputNormalizer(new Set(allowedRefs), attestation);
}
export type TreatmentReasoningPortableOutputResult = ReturnType<ReturnType<typeof createTreatmentReasoningPortableOutputContractV2>['normalize']>;

/** Closed V2 parser: source-bound review output and host-minted provenance remain separate. */
export function createTreatmentReasoningAthenaOutputContractV2(configuration: unknown): Readonly<{ normalize(value: unknown): TreatmentReasoningAthenaV2Result }> {
    const config = record(configuration, ['allowedEvidenceRefs', 'attestation']);
    const allowedRefs = config && refs(config.allowedEvidenceRefs);
    const allowed = allowedRefs && new Set(allowedRefs);
    const attestation = config && attest(config.attestation);
    if (!config || !allowed || allowed.size === 0 || !attestation) throw new Error('Treatment reasoning ATHENA V2 configuration rejected');
    return outputNormalizer(allowed, attestation);
}

/** Shared clinical content validation; it does not parse or mint provenance. */
function clinicalContent(value: unknown, allowed: ReadonlySet<string>) {
    const input = record(value, ['schemaVersion', 'task', 'summary', 'data', 'sourceBindings']);
    const summary = input && text(input.summary, MAX.summary);
    const data = input && record(input.data, ['recommendation', 'keyEvidence', 'reasoning', 'caveats', 'safetyFlags', 'suggestedActions', 'trace']);
    const recommendation = data && text(data.recommendation, MAX.recommendation);
    const keyEvidence = data && evidence(data.keyEvidence, allowed);
    const reasoning = data && strings(data.reasoning, MAX.reasoning);
    const caveats = data && strings(data.caveats, MAX.caveats);
    const safetyFlags = data && flags(data.safetyFlags, allowed);
    const suggestedActions = data && actions(data.suggestedActions, allowed);
    const sourceBindings = input && summary && recommendation && reasoning?.every(Boolean) && caveats?.every(Boolean)
        ? bindings(input.sourceBindings, allowed, claims(summary, recommendation, reasoning, caveats)) : null;
    if (!input || input.schemaVersion !== TREATMENT_REASONING_SCHEMA_VERSION || input.task !== 'treatment_reasoning'
        || !summary || !data || !recommendation || !keyEvidence || !reasoning || !caveats || !safetyFlags || !suggestedActions || !sourceBindings) return null;
    return { summary, recommendation, keyEvidence, reasoning, caveats, safetyFlags, suggestedActions, sourceBindings, rawTrace: data.trace };
}

/** Only the host metadata varies; every clinical and source-binding check is shared. */
function outputNormalizer<A extends TreatmentReasoningAthenaV2Attestation | TreatmentReasoningPortableAttestation>(allowed: ReadonlySet<string>, attestation: A) {
    return Object.freeze({ normalize(value: unknown) {
        const content = clinicalContent(value, allowed);
        const normalizedTrace = content && trace(content.rawTrace);
        if (!content || !normalizedTrace) return Object.freeze({ status: 'denied' as const, code: 'output_invalid' as const, value: null, sourceBindings: null, attestation: null, ...COMMON });
        const { summary, recommendation, keyEvidence, reasoning, caveats, safetyFlags, suggestedActions, sourceBindings } = content;
        const normalized = Object.freeze({ schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION, task: 'treatment_reasoning' as const, summary, data: Object.freeze({ recommendation, keyEvidence, reasoning, caveats, safetyFlags, suggestedActions, trace: normalizedTrace }) });
        return Object.freeze({ status: 'accepted' as const, code: null, resultSchema: TREATMENT_REASONING_ATHENA_OUTPUT_V2_RESULT_SCHEMA, value: normalized, sourceBindings, attestation, ...COMMON });
    } });
}

/** Closed remote content variant. A parsed proposal is not an execution receipt. */
export function createTreatmentReasoningChatGptOutputContract(configuration: unknown) {
    const config = record(configuration, ['allowedEvidenceRefs']);
    const allowedRefs = config && refs(config.allowedEvidenceRefs);
    if (!allowedRefs?.length) throw new Error('Treatment reasoning ChatGPT configuration rejected');
    const allowed = new Set(allowedRefs);
    return Object.freeze({ normalize(value: unknown) {
        const content = clinicalContent(value, allowed);
        const inputTrace = content && record(content.rawTrace, ['mode', 'toolsUsed', 'limitations']);
        const tools = inputTrace && array(inputTrace.toolsUsed, 0);
        const limitations = inputTrace && strings(inputTrace.limitations, MAX.limitations, MAX.label);
        if (!content || !inputTrace || inputTrace.mode !== 'chatgpt_subscription' || !tools || !limitations) {
            return Object.freeze({ status: 'denied' as const, code: 'output_invalid' as const, value: null, sourceBindings: null, ...COMMON });
        }
        const { summary, recommendation, keyEvidence, reasoning, caveats, safetyFlags, suggestedActions, sourceBindings } = content;
        const normalizedTrace = Object.freeze({ mode: 'chatgpt_subscription' as const, toolsUsed: Object.freeze([]) as readonly [], limitations });
        const normalized = Object.freeze({ schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION, task: 'treatment_reasoning' as const, summary,
            data: Object.freeze({ recommendation, keyEvidence, reasoning, caveats, safetyFlags, suggestedActions, trace: normalizedTrace }) });
        return Object.freeze({ status: 'accepted' as const, code: null, resultSchema: 'mediflow.ai.treatment-reasoning-chatgpt-content.v1' as const,
            value: normalized, sourceBindings, ...COMMON });
    } });
}
export type TreatmentReasoningChatGptContent = Extract<ReturnType<ReturnType<typeof createTreatmentReasoningChatGptOutputContract>['normalize']>, { status: 'accepted' }>;
