/* @Codex */
import 'server-only';

import { types } from 'node:util';

export const TREATMENT_REASONING_PROJECTION_SCHEMA = 'mediflow.ai.treatment-reasoning-projection.v1' as const;
export const TREATMENT_REASONING_REVIEW_PROPOSAL_SCHEMA = 'mediflow.ai.treatment-reasoning-review-proposal.v1' as const;

export type TreatmentReasoningHostBoundaryErrorCode =
    | 'input_invalid'
    | 'projection_invalid'
    | 'provenance_invalid'
    | 'receipt_invalid';

export class TreatmentReasoningHostBoundaryError extends Error {
    public readonly code: TreatmentReasoningHostBoundaryErrorCode;

    constructor(code: TreatmentReasoningHostBoundaryErrorCode) {
        super(`Treatment reasoning host boundary rejected: ${code}`);
        this.name = 'TreatmentReasoningHostBoundaryError';
        this.code = code;
    }
}

export type TreatmentReasoningReviewProposal = Readonly<{
    schema: typeof TREATMENT_REASONING_REVIEW_PROPOSAL_SCHEMA;
    capability: 'treatment_reasoning';
    stage: 'preview';
    review: 'required';
    uncertainty: Readonly<{ level: 'low'; source: 'degraded_default' }>;
    provenanceRef: string;
    receiptRef: string;
    writesPerformed: 0;
    applyPolicy: 'none';
}>;

type MinimizedTreatmentProjection = Readonly<{
    schema: typeof TREATMENT_REASONING_PROJECTION_SCHEMA;
    capability: 'treatment_reasoning';
    stage: 'preview';
    sourceRevision: string;
    therapyRefs: readonly string[];
    evidenceRefs: readonly string[];
}>;

const INPUT_KEYS = ['projection', 'provenanceRef', 'receiptRef'];
const PROJECTION_KEYS = ['schema', 'capability', 'stage', 'sourceRevision', 'therapyRefs', 'evidenceRefs'];
const OPAQUE_REF = /^[a-z][a-z0-9._-]{2,127}$/;
const MAX_PROJECTION_REFS_PER_KIND = 32;

function reject(code: TreatmentReasoningHostBoundaryErrorCode): never {
    throw new TreatmentReasoningHostBoundaryError(code);
}

function dataRecord(value: unknown, keys: readonly string[], code: TreatmentReasoningHostBoundaryErrorCode): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return reject(code);
    const names = Reflect.ownKeys(value);
    if (names.length !== keys.length || !keys.every((key) => names.includes(key))) return reject(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return reject(code);
    }
    return value as Record<string, unknown>;
}

function opaqueRef(value: unknown, code: TreatmentReasoningHostBoundaryErrorCode): string {
    if (typeof value !== 'string' || !OPAQUE_REF.test(value)) return reject(code);
    return value;
}

function opaqueRefs(value: unknown, code: TreatmentReasoningHostBoundaryErrorCode, required: boolean): readonly string[] {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return reject(code);
    const length = value.length;
    if (length > MAX_PROJECTION_REFS_PER_KIND || (required && length === 0)) return reject(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    if (keys.length !== expected.size || !keys.every((key) => expected.has(String(key)))) return reject(code);
    const seen = new Set<string>();
    const snapshot = new Array<string>(length);
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return reject(code);
        const ref = opaqueRef(descriptor.value, code);
        if (seen.has(ref)) return reject(code);
        seen.add(ref);
        snapshot[index] = ref;
    }
    return Object.freeze(snapshot);
}

function snapshotProjection(value: unknown): MinimizedTreatmentProjection {
    const projection = dataRecord(value, PROJECTION_KEYS, 'projection_invalid');
    if (projection.schema !== TREATMENT_REASONING_PROJECTION_SCHEMA || projection.capability !== 'treatment_reasoning' || projection.stage !== 'preview') {
        return reject('projection_invalid');
    }
    return Object.freeze({
        schema: TREATMENT_REASONING_PROJECTION_SCHEMA,
        capability: 'treatment_reasoning',
        stage: 'preview',
        sourceRevision: opaqueRef(projection.sourceRevision, 'projection_invalid'),
        therapyRefs: opaqueRefs(projection.therapyRefs, 'projection_invalid', false),
        evidenceRefs: opaqueRefs(projection.evidenceRefs, 'projection_invalid', true),
    });
}

function buildDeterministicHostPrompt(projection: MinimizedTreatmentProjection): string {
    return [
        'task=treatment_reasoning',
        `source_revision=${projection.sourceRevision}`,
        `therapy_refs=${projection.therapyRefs.join(',')}`,
        `evidence_refs=${projection.evidenceRefs.join(',')}`,
        'output=review_only',
    ].join('\n');
}

/** Pure D5 boundary: it snapshots a host-owned minimized projection and never exposes the deterministic prompt or accepts caller authority. */
export function buildTreatmentReasoningReviewProposal(value: unknown): TreatmentReasoningReviewProposal {
    const input = dataRecord(value, INPUT_KEYS, 'input_invalid');
    const projection = snapshotProjection(input.projection);
    const provenanceRef = opaqueRef(input.provenanceRef, 'provenance_invalid');
    const receiptRef = opaqueRef(input.receiptRef, 'receipt_invalid');
    void buildDeterministicHostPrompt(projection);
    return Object.freeze({
        schema: TREATMENT_REASONING_REVIEW_PROPOSAL_SCHEMA,
        capability: 'treatment_reasoning',
        stage: 'preview',
        review: 'required',
        uncertainty: Object.freeze({ level: 'low', source: 'degraded_default' }),
        provenanceRef,
        receiptRef,
        writesPerformed: 0,
        applyPolicy: 'none',
    });
}
