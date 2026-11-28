import {
    PERSONAL_CANDIDATE_REVIEW_SCHEMA,
    PERSONAL_SERVICE_CANDIDATE_KIND,
    candidateDiagnosisReferenceSchema,
    candidateReviewDecisionSchema,
    formatCandidateDefaultTitle,
    personalCandidateReviewStoreSchema,
    type CandidateDiagnosisReference,
    type CandidateReviewDecision,
    type CandidateServiceItem,
    type PersonalCandidateReviewStore,
    type RecurringServiceGroupCandidate,
} from './contract';

export type CandidateCorrectionInput = Readonly<{
    title: string;
    services: readonly CandidateServiceItem[];
    associatedDiagnosis: CandidateDiagnosisReference | null;
    note?: string | null;
}>;

export type CandidateCorrectionOutcome =
    | Readonly<{ ok: true; store: PersonalCandidateReviewStore; decision: CandidateReviewDecision }>
    | Readonly<{ ok: false; error: string }>;

export type ParseReviewStoreResult =
    | Readonly<{ ok: true; store: PersonalCandidateReviewStore }>
    | Readonly<{ ok: false; error: string }>;

export function emptyPersonalCandidateReviewStore(): PersonalCandidateReviewStore {
    return {
        schemaVersion: PERSONAL_CANDIDATE_REVIEW_SCHEMA,
        decisions: [],
    };
}

export function parsePersonalCandidateReviewStoreStrict(raw: unknown): ParseReviewStoreResult {
    if (raw === null || raw === undefined) {
        return { ok: true, store: emptyPersonalCandidateReviewStore() };
    }
    let candidate: unknown = raw;
    if (typeof raw === 'string') {
        if (raw.trim() === '') {
            return { ok: false, error: 'Valutazioni salvate non leggibili.' };
        }
        try {
            candidate = JSON.parse(raw) as unknown;
        } catch {
            return { ok: false, error: 'Valutazioni salvate non leggibili.' };
        }
    }
    const parsed = personalCandidateReviewStoreSchema.safeParse(candidate);
    if (!parsed.success) {
        return { ok: false, error: 'Valutazioni salvate non valide.' };
    }
    return { ok: true, store: parsed.data };
}

export function parsePersonalCandidateReviewStore(raw: unknown): PersonalCandidateReviewStore {
    if (raw === '') return emptyPersonalCandidateReviewStore();
    const parsed = parsePersonalCandidateReviewStoreStrict(raw);
    return parsed.ok ? parsed.store : emptyPersonalCandidateReviewStore();
}

export function serializePersonalCandidateReviewStore(store: PersonalCandidateReviewStore): string {
    const validated = personalCandidateReviewStoreSchema.parse(store);
    return JSON.stringify(validated);
}

function upsertDecision(
    store: PersonalCandidateReviewStore,
    decision: CandidateReviewDecision,
): PersonalCandidateReviewStore {
    const validated = candidateReviewDecisionSchema.parse(decision);
    const remaining = store.decisions.filter((item) => item.candidateId !== validated.candidateId);
    return {
        schemaVersion: PERSONAL_CANDIDATE_REVIEW_SCHEMA,
        decisions: [validated, ...remaining],
    };
}

function defaultDiagnosisForCandidate(candidate: RecurringServiceGroupCandidate): CandidateDiagnosisReference | null {
    if (!candidate.primaryDiagnosis) return null;
    return {
        code: candidate.primaryDiagnosis.code,
        system: candidate.primaryDiagnosis.system,
        description: candidate.primaryDiagnosis.description,
    };
}

export function keepCandidateDecision(
    store: PersonalCandidateReviewStore,
    candidate: RecurringServiceGroupCandidate,
    now: Date = new Date(),
): PersonalCandidateReviewStore {
    const existing = findCandidateDecision(store, candidate.id);
    const decision: CandidateReviewDecision = {
        kind: PERSONAL_SERVICE_CANDIDATE_KIND,
        candidateId: candidate.id,
        status: 'kept',
        title: existing?.title ?? formatCandidateDefaultTitle(candidate.services),
        services: existing?.services ?? candidate.services,
        associatedDiagnosis: existing ? existing.associatedDiagnosis : defaultDiagnosisForCandidate(candidate),
        note: existing?.note ?? null,
        updatedAt: now.toISOString(),
    };
    return upsertDecision(store, decision);
}

export function correctCandidateDecision(
    store: PersonalCandidateReviewStore,
    candidate: RecurringServiceGroupCandidate,
    correction: CandidateCorrectionInput,
    now: Date = new Date(),
): CandidateCorrectionOutcome {
    const title = correction.title.trim();
    if (!title) {
        return { ok: false, error: 'Inserisci un nome per il gruppo personale.' };
    }
    if (correction.services.length === 0) {
        return { ok: false, error: 'Mantieni almeno una prestazione nel gruppo.' };
    }

    const dedupedServices: CandidateServiceItem[] = [];
    const seenKeys = new Set<string>();
    for (const service of correction.services) {
        if (seenKeys.has(service.key)) continue;
        seenKeys.add(service.key);
        dedupedServices.push(service);
    }

    let associatedDiagnosis: CandidateDiagnosisReference | null = null;
    if (correction.associatedDiagnosis !== null) {
        const parsedDiagnosis = candidateDiagnosisReferenceSchema.safeParse(correction.associatedDiagnosis);
        if (!parsedDiagnosis.success) {
            return { ok: false, error: 'Diagnosi associata non valida.' };
        }
        associatedDiagnosis = parsedDiagnosis.data;
    }

    const trimmedNote = correction.note?.trim() ?? '';
    const candidateDecision = candidateReviewDecisionSchema.safeParse({
        kind: PERSONAL_SERVICE_CANDIDATE_KIND,
        candidateId: candidate.id,
        status: 'corrected',
        title,
        services: dedupedServices,
        associatedDiagnosis,
        note: trimmedNote.length > 0 ? trimmedNote : null,
        updatedAt: now.toISOString(),
    });
    if (!candidateDecision.success) {
        return { ok: false, error: 'Correzione non valida.' };
    }

    return {
        ok: true,
        store: upsertDecision(store, candidateDecision.data),
        decision: candidateDecision.data,
    };
}

export function discardCandidateDecision(
    store: PersonalCandidateReviewStore,
    candidate: RecurringServiceGroupCandidate,
    note?: string | null,
    now: Date = new Date(),
): PersonalCandidateReviewStore {
    const existing = findCandidateDecision(store, candidate.id);
    const trimmedNote = note?.trim() ?? existing?.note ?? '';
    const decision: CandidateReviewDecision = {
        kind: PERSONAL_SERVICE_CANDIDATE_KIND,
        candidateId: candidate.id,
        status: 'discarded',
        title: existing?.title ?? formatCandidateDefaultTitle(candidate.services),
        services: existing?.services ?? candidate.services,
        associatedDiagnosis: existing ? existing.associatedDiagnosis : defaultDiagnosisForCandidate(candidate),
        note: trimmedNote.length > 0 ? trimmedNote : null,
        updatedAt: now.toISOString(),
    };
    return upsertDecision(store, decision);
}

export function restoreCandidateDecision(
    store: PersonalCandidateReviewStore,
    candidateId: string,
): PersonalCandidateReviewStore {
    return {
        schemaVersion: PERSONAL_CANDIDATE_REVIEW_SCHEMA,
        decisions: store.decisions.filter((decision) => decision.candidateId !== candidateId),
    };
}

export function findCandidateDecision(
    store: PersonalCandidateReviewStore,
    candidateId: string,
): CandidateReviewDecision | null {
    return store.decisions.find((decision) => decision.candidateId === candidateId) ?? null;
}
