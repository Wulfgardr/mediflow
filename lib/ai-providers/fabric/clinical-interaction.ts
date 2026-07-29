/* @Codex */
import {
    DETERMINISTIC_CAPABILITY_IDS,
    GENERATIVE_CAPABILITY_IDS,
    type FabricCapabilityId,
} from './contract';

export const CLINICAL_INTERACTION_SCHEMA_VERSION = 'mediflow.ai.clinical-interaction.v1' as const;

export type ClinicalUncertainty = Readonly<{
    level: 'high' | 'medium' | 'low';
    source: 'declared' | 'degraded_default';
}>;

export type InputCompleteness = Readonly<{
    unreadableFields: readonly string[];
    missingFields: readonly string[];
}>;

export type PendingWorkRef = Readonly<{
    kind: 'results_pending' | 'series_stalled' | 'ocr_pending' | 'manual_review';
    sourceRef: Readonly<{
        type: string;
        id: string | null;
    }>;
}>;

export const CLINICAL_REVIEW_STATES = Object.freeze([
    'pending',
    'clarification_requested',
    'previewed',
    'accepted',
    'rejected',
    'superseded',
] as const);

export type ClinicalReviewState = (typeof CLINICAL_REVIEW_STATES)[number];

export type ClinicalReviewEvent = Readonly<{
    type: 'request_clarification' | 'preview' | 'accept' | 'reject' | 'supersede';
    actor: 'physician' | 'application';
    uncertaintyAcknowledged?: boolean;
}>;

export type ClinicalInteractionErrorCode =
    | 'proposal_invalid'
    | 'completeness_invalid'
    | 'actor_forbidden'
    | 'transition_invalid'
    | 'uncertainty_not_acknowledged'
    | 'provenance_missing';

export class ClinicalInteractionError extends Error {
    constructor(public readonly code: ClinicalInteractionErrorCode) {
        super(`Clinical interaction rejected: ${code}`);
        this.name = 'ClinicalInteractionError';
    }
}

export type ClinicalProposal = Readonly<{
    schemaVersion: typeof CLINICAL_INTERACTION_SCHEMA_VERSION;
    capability: FabricCapabilityId;
    provenanceRef: string | null;
    uncertainty: ClinicalUncertainty;
    completeness: InputCompleteness;
    pendingWork: readonly PendingWorkRef[];
    review: ClinicalReviewState;
}>;

export type ClinicalProposalInput = Readonly<{
    schemaVersion?: unknown;
    capability: unknown;
    provenanceRef: unknown;
    uncertainty: unknown;
    completeness: unknown;
    pendingWork: readonly unknown[];
    review?: unknown;
}>;

const CAPABILITY_IDS = new Set<string>([
    ...GENERATIVE_CAPABILITY_IDS,
    ...DETERMINISTIC_CAPABILITY_IDS,
]);
const UNCERTAINTY_LEVELS = new Set(['high', 'medium', 'low']);
const PENDING_WORK_KINDS = new Set([
    'results_pending',
    'series_stalled',
    'ocr_pending',
    'manual_review',
]);

function reject(code: ClinicalInteractionErrorCode): never {
    throw new ClinicalInteractionError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export function declareUncertainty(value: unknown): ClinicalUncertainty {
    const level = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (UNCERTAINTY_LEVELS.has(level)) {
        return Object.freeze({ level: level as ClinicalUncertainty['level'], source: 'declared' });
    }
    return Object.freeze({ level: 'low', source: 'degraded_default' });
}

export function uncertaintyFromNumeric(value: unknown): ClinicalUncertainty {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        return Object.freeze({ level: 'low', source: 'degraded_default' });
    }
    const level = value >= 0.8 ? 'high' : value >= 0.45 ? 'medium' : 'low';
    return Object.freeze({ level, source: 'declared' });
}

export function buildInputCompleteness(input: unknown): InputCompleteness {
    if (!isRecord(input)
        || !Array.isArray(input.unreadableFields)
        || !Array.isArray(input.missingFields)) {
        return reject('completeness_invalid');
    }

    // Normalizzazione trim prima di dedup e overlap: lo stesso campo logico
    // circondato da spazi non puo' comparire in entrambe le liste.
    const normalize = (raw: readonly unknown[]): string[] => {
        const normalized: string[] = [];
        for (const field of Array.from(raw)) {
            if (!isNonEmptyString(field)) reject('completeness_invalid');
            const trimmed = (field as string).trim();
            if (trimmed.length === 0) reject('completeness_invalid');
            normalized.push(trimmed);
        }
        return normalized;
    };
    const unreadableFields = normalize(input.unreadableFields);
    const missingFields = normalize(input.missingFields);
    const unreadable = new Set<string>();
    const missing = new Set<string>();

    for (const field of unreadableFields) {
        if (unreadable.has(field)) reject('completeness_invalid');
        unreadable.add(field);
    }
    for (const field of missingFields) {
        if (missing.has(field) || unreadable.has(field)) {
            reject('completeness_invalid');
        }
        missing.add(field);
    }

    return Object.freeze({
        unreadableFields: Object.freeze(unreadableFields),
        missingFields: Object.freeze(missingFields),
    });
}

function freezeUncertainty(value: unknown): ClinicalUncertainty {
    if (!isRecord(value)
        || !UNCERTAINTY_LEVELS.has(value.level as string)
        || (value.source !== 'declared' && value.source !== 'degraded_default')
        || (value.source === 'degraded_default' && value.level !== 'low')) {
        return reject('proposal_invalid');
    }
    return Object.freeze({
        level: value.level as ClinicalUncertainty['level'],
        source: value.source,
    });
}

function freezePendingWork(value: unknown): readonly PendingWorkRef[] {
    if (!Array.isArray(value)) return reject('proposal_invalid');
    const snapshot = Array.from(value);
    const pendingWork: PendingWorkRef[] = [];

    for (let index = 0; index < snapshot.length; index += 1) {
        const item = snapshot[index];
        if (!isRecord(item) || !PENDING_WORK_KINDS.has(item.kind as string) || !isRecord(item.sourceRef)) {
            return reject('proposal_invalid');
        }
        const { type, id } = item.sourceRef;
        if (!isNonEmptyString(type) || (id !== null && typeof id !== 'string')) {
            return reject('proposal_invalid');
        }
        pendingWork.push(Object.freeze({
            kind: item.kind as PendingWorkRef['kind'],
            sourceRef: Object.freeze({ type, id }),
        }));
    }
    return Object.freeze(pendingWork);
}

export function createClinicalProposal(input: ClinicalProposalInput): ClinicalProposal {
    if (!isRecord(input)
        || (input.schemaVersion !== undefined && input.schemaVersion !== CLINICAL_INTERACTION_SCHEMA_VERSION)
        || typeof input.capability !== 'string'
        || !CAPABILITY_IDS.has(input.capability)
        // Un riferimento di provenienza e' null oppure una stringa reale:
        // la stringa vuota non e' un riferimento.
        || (input.provenanceRef !== null
            && (typeof input.provenanceRef !== 'string' || input.provenanceRef.trim().length === 0))
        || (input.review !== undefined && input.review !== 'pending')) {
        return reject('proposal_invalid');
    }

    return Object.freeze({
        schemaVersion: CLINICAL_INTERACTION_SCHEMA_VERSION,
        capability: input.capability as FabricCapabilityId,
        provenanceRef: input.provenanceRef,
        uncertainty: freezeUncertainty(input.uncertainty),
        completeness: buildInputCompleteness(input.completeness),
        pendingWork: freezePendingWork(input.pendingWork),
        review: 'pending',
    });
}

function definedTransition(
    state: ClinicalReviewState,
    event: ClinicalReviewEvent['type'],
): { readonly review: ClinicalReviewState; readonly actor: ClinicalReviewEvent['actor'] | null } | null {
    if (state === 'pending' && event === 'request_clarification') {
        return { review: 'clarification_requested', actor: null };
    }
    if ((state === 'pending' || state === 'clarification_requested') && event === 'preview') {
        return { review: 'previewed', actor: 'physician' };
    }
    if (state === 'previewed' && event === 'accept') {
        return { review: 'accepted', actor: 'physician' };
    }
    if ((state === 'pending' || state === 'clarification_requested' || state === 'previewed')
        && event === 'reject') {
        return { review: 'rejected', actor: 'physician' };
    }
    if ((state === 'pending' || state === 'clarification_requested' || state === 'previewed')
        && event === 'supersede') {
        return { review: 'superseded', actor: 'application' };
    }
    return null;
}

export function advanceClinicalReview(
    proposal: ClinicalProposal,
    event: ClinicalReviewEvent,
): ClinicalProposal {
    const transition = definedTransition(proposal.review, event.type);
    if (!transition) return reject('transition_invalid');
    // L'attore deve appartenere al vocabolario anche dove la transizione non
    // lo vincola: i tipi non sono enforcement runtime.
    if (event.actor !== 'physician' && event.actor !== 'application') {
        return reject('actor_forbidden');
    }
    if (transition.actor !== null && event.actor !== transition.actor) {
        return reject('actor_forbidden');
    }
    if (event.type === 'accept') {
        if (event.uncertaintyAcknowledged !== true) {
            return reject('uncertainty_not_acknowledged');
        }
        if (proposal.provenanceRef === null || proposal.provenanceRef.trim().length === 0) {
            return reject('provenance_missing');
        }
    }
    return Object.freeze({ ...proposal, review: transition.review });
}
