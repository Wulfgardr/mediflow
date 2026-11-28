'use client';

import { useState } from 'react';
import { Disclosure } from '@/components/disclosure';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { formatCountLabel } from '@/lib/format-count';
import { clientArchiveGeneration } from '@/lib/security/client-auth-api';
import {
    PERSONAL_CANDIDATE_REVIEW_SETTING_KEY,
    correctCandidateDecision,
    deriveRecurringServiceCandidates,
    discardCandidateDecision,
    emptyPersonalCandidateReviewStore,
    findCandidateDecision,
    formatCandidateDefaultTitle,
    keepCandidateDecision,
    parsePersonalCandidateReviewStoreStrict,
    restoreCandidateDecision,
    serializePersonalCandidateReviewStore,
    type CandidateDiagnosisReference,
    type CandidateReviewDecision,
    type CandidateServiceItem,
    type PersonalCandidateReviewStore,
    type RecurringServiceCandidateAnalysis,
    type RecurringServiceGroupCandidate,
} from '@/lib/service-package-candidates';
import rowStyles from './repertori-settings.module.css';
import styles from './service-package-candidates-panel.module.css';

type PanelPhase =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; analysis: RecurringServiceCandidateAnalysis };

type ReviewSnapshot = Readonly<{
    store: PersonalCandidateReviewStore;
    rawValue: string | null;
}>;

type ReviewLoadState =
    | { kind: 'idle' }
    | { kind: 'ready'; snapshot: ReviewSnapshot }
    | { kind: 'error'; message: string };

type CorrectionDraft = {
    candidateId: string;
    title: string;
    selectedKeys: string[];
    diagnosisSelection: string;
    note: string;
    error: string | null;
};

const NONE_DIAGNOSIS_VALUE = '__none__';
const MAX_CAS_ATTEMPTS = 4;
const REVIEW_READ_ERROR_MESSAGE = 'Impossibile leggere le valutazioni salvate. Riprova.';
const REVIEW_CONFLICT_ERROR_MESSAGE = 'Valutazioni aggiornate in un’altra scheda. Riprova.';

function diagnosisOptionValue(diagnosis: CandidateDiagnosisReference): string {
    return `${diagnosis.system}\u0000${diagnosis.code}\u0000${diagnosis.description}`;
}

function parseDiagnosisOptionValue(value: string): CandidateDiagnosisReference | null {
    if (!value || value === NONE_DIAGNOSIS_VALUE) return null;
    const [system, code, ...rest] = value.split('\u0000');
    const description = rest.join('\u0000');
    if (!system || !code || !description) return null;
    return { system, code, description };
}

function statusLabel(decision: CandidateReviewDecision | null): string {
    if (!decision) return 'Da valutare';
    if (decision.status === 'kept') return 'Conservato';
    if (decision.status === 'corrected') return 'Corretto';
    return 'Scartato';
}

function sufficiencyNote(candidate: RecurringServiceGroupCandidate, minPrescriptions: number, minPatients: number): string {
    if (candidate.sufficiency === 'insufficient_patients') {
        return `Dati insufficienti: osservato su ${formatCountLabel(candidate.patientCount, 'paziente', 'pazienti')} (soglia minima ${minPatients}).`;
    }
    return `Dati insufficienti: ${formatCountLabel(candidate.prescriptionCount, 'prescrizione', 'prescrizioni')} (soglia minima ${minPrescriptions}).`;
}

function parseReviewSnapshotValue(raw: unknown): ReviewSnapshot {
    if (raw !== null && raw !== undefined && typeof raw !== 'string') {
        throw new Error(REVIEW_READ_ERROR_MESSAGE);
    }
    const rawValue = raw ?? null;
    const parsed = parsePersonalCandidateReviewStoreStrict(rawValue);
    if (!parsed.ok) {
        throw new Error(parsed.error);
    }
    return {
        store: parsed.store,
        rawValue,
    };
}

async function readSavedReviewSnapshot(): Promise<ReviewSnapshot> {
    let response: Response;
    try {
        response = await fetch(`/api/settings/${encodeURIComponent(PERSONAL_CANDIDATE_REVIEW_SETTING_KEY)}`, {
            cache: 'no-store',
            credentials: 'same-origin',
        });
    } catch {
        throw new Error(REVIEW_READ_ERROR_MESSAGE);
    }
    if (!response.ok) {
        throw new Error(REVIEW_READ_ERROR_MESSAGE);
    }
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new Error(REVIEW_READ_ERROR_MESSAGE);
    }
    if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'value')) {
        throw new Error(REVIEW_READ_ERROR_MESSAGE);
    }
    return parseReviewSnapshotValue((payload as { value?: unknown }).value);
}

type PersistReviewResult =
    | Readonly<{ kind: 'saved'; snapshot: ReviewSnapshot }>
    | Readonly<{ kind: 'conflict'; latestRawValue: string | null | undefined }>;

async function persistReviewStoreConditional(
    store: PersonalCandidateReviewStore,
    expectedValue: string | null,
): Promise<PersistReviewResult> {
    const serialized = serializePersonalCandidateReviewStore(store);
    let response: Response;
    try {
        response = await fetch(`/api/settings/${encodeURIComponent(PERSONAL_CANDIDATE_REVIEW_SETTING_KEY)}`, {
            method: 'PUT',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'x-mediflow-archive-generation': clientArchiveGeneration(),
            },
            body: JSON.stringify({ value: serialized, expectedValue }),
        });
    } catch {
        throw new Error('Salvataggio delle valutazioni non riuscito.');
    }
    if (response.status === 409) {
        const conflictBody = (await response.json().catch(() => null)) as { value?: unknown } | null;
        const latestRawValue = conflictBody && Object.hasOwn(conflictBody, 'value')
            && (conflictBody.value === null || typeof conflictBody.value === 'string')
            ? conflictBody.value
            : undefined;
        return { kind: 'conflict', latestRawValue };
    }
    if (!response.ok) {
        throw new Error('Salvataggio delle valutazioni non riuscito.');
    }
    return {
        kind: 'saved',
        snapshot: {
            store,
            rawValue: serialized,
        },
    };
}

export function ServicePackageCandidatesPanel({
    expanded,
    onExpandedChange,
}: {
    expanded?: boolean;
    onExpandedChange?: (value: boolean) => void;
} = {}) {
    const [phase, setPhase] = useState<PanelPhase>({ kind: 'idle' });
    const [reviewState, setReviewState] = useState<ReviewLoadState>({ kind: 'idle' });
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [draft, setDraft] = useState<CorrectionDraft | null>(null);

    const reviewStore = reviewState.kind === 'ready'
        ? reviewState.snapshot.store
        : emptyPersonalCandidateReviewStore();

    async function ensureSavedDecisionsLoaded() {
        if (reviewState.kind === 'ready') return;
        try {
            const loaded = await readSavedReviewSnapshot();
            setReviewState({ kind: 'ready', snapshot: loaded });
        } catch (error) {
            setReviewState({
                kind: 'error',
                message: error instanceof Error ? error.message : REVIEW_READ_ERROR_MESSAGE,
            });
        }
    }

    function handleExpandedChange(nextOpen: boolean) {
        onExpandedChange?.(nextOpen);
        if (nextOpen) {
            void ensureSavedDecisionsLoaded();
        }
    }

    async function runLocalAnalysis() {
        setPhase({ kind: 'loading' });
        setFeedback(null);
        setActionError(null);
        setDraft(null);
        let saved: ReviewSnapshot;
        try {
            saved = await readSavedReviewSnapshot();
        } catch (error) {
            const message = error instanceof Error ? error.message : REVIEW_READ_ERROR_MESSAGE;
            setReviewState({ kind: 'error', message });
            setPhase({ kind: 'error', message });
            return;
        }
        try {
            const [patients, prescriptions, items] = await Promise.all([
                db.patients.toArray(),
                db.servicePrescriptions.toArray(),
                db.servicePrescriptionItems.toArray(),
            ]);
            const analysis = deriveRecurringServiceCandidates({
                patients,
                prescriptions,
                items,
            });
            setReviewState({ kind: 'ready', snapshot: saved });
            setPhase({ kind: 'ready', analysis });
        } catch {
            setPhase({
                kind: 'error',
                message: 'Storico non leggibile in questa sessione. Verifica che l’archivio sia sbloccato e riprova.',
            });
        }
    }

    async function mutateDecision(
        applyMutation: (currentStore: PersonalCandidateReviewStore) => PersonalCandidateReviewStore,
        message: string,
    ): Promise<boolean> {
        setSaving(true);
        setFeedback(null);
        setActionError(null);
        try {
            let baseSnapshot: ReviewSnapshot;
            if (reviewState.kind === 'ready') {
                baseSnapshot = reviewState.snapshot;
            } else {
                baseSnapshot = await readSavedReviewSnapshot();
                setReviewState({ kind: 'ready', snapshot: baseSnapshot });
            }

            for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
                const nextStore = applyMutation(baseSnapshot.store);
                const persisted = await persistReviewStoreConditional(nextStore, baseSnapshot.rawValue);
                if (persisted.kind === 'saved') {
                    setReviewState({ kind: 'ready', snapshot: persisted.snapshot });
                    setFeedback(message);
                    return true;
                }
                baseSnapshot = persisted.latestRawValue !== undefined
                    ? parseReviewSnapshotValue(persisted.latestRawValue)
                    : await readSavedReviewSnapshot();
                setReviewState({ kind: 'ready', snapshot: baseSnapshot });
            }

            setActionError(REVIEW_CONFLICT_ERROR_MESSAGE);
            return false;
        } catch (error) {
            setActionError(error instanceof Error ? error.message : 'Salvataggio non riuscito.');
            return false;
        } finally {
            setSaving(false);
        }
    }

    function openCorrectionEditor(candidate: RecurringServiceGroupCandidate) {
        const existing = findCandidateDecision(reviewStore, candidate.id);
        const currentServices = existing?.services ?? candidate.services;
        const currentDiagnosis = existing
            ? existing.associatedDiagnosis
            : candidate.primaryDiagnosis
                ? {
                    code: candidate.primaryDiagnosis.code,
                    system: candidate.primaryDiagnosis.system,
                    description: candidate.primaryDiagnosis.description,
                }
                : null;
        setDraft({
            candidateId: candidate.id,
            title: existing?.title ?? formatCandidateDefaultTitle(candidate.services),
            selectedKeys: currentServices.map((service) => service.key),
            diagnosisSelection: currentDiagnosis ? diagnosisOptionValue(currentDiagnosis) : NONE_DIAGNOSIS_VALUE,
            note: existing?.note ?? '',
            error: null,
        });
    }

    async function submitCorrection(candidate: RecurringServiceGroupCandidate) {
        if (!draft || draft.candidateId !== candidate.id) return;
        const selectedServices: CandidateServiceItem[] = candidate.services.filter((service) =>
            draft.selectedKeys.includes(service.key),
        );
        const correctionInput = {
            title: draft.title,
            services: selectedServices,
            associatedDiagnosis: parseDiagnosisOptionValue(draft.diagnosisSelection),
            note: draft.note,
        };
        const validation = correctCandidateDecision(reviewStore, candidate, correctionInput);
        if (!validation.ok) {
            setDraft({ ...draft, error: validation.error });
            return;
        }
        const saved = await mutateDecision((latestStore) => {
            const outcome = correctCandidateDecision(latestStore, candidate, correctionInput);
            if (!outcome.ok) {
                throw new Error(outcome.error);
            }
            return outcome.store;
        }, 'Correzione salvata nei candidati personali.');
        if (saved) {
            setDraft(null);
        }
    }

    const activeCandidates = phase.kind === 'ready'
        ? phase.analysis.candidates.filter((candidate) => findCandidateDecision(reviewStore, candidate.id)?.status !== 'discarded')
        : [];
    const discardedCandidates = phase.kind === 'ready'
        ? phase.analysis.candidates.filter((candidate) => findCandidateDecision(reviewStore, candidate.id)?.status === 'discarded')
        : [];

    const summaryText = phase.kind === 'loading'
        ? 'Analisi locale in corso…'
        : phase.kind === 'ready'
            ? phase.analysis.status === 'empty_history'
                ? 'Storico vuoto'
                : `${formatCountLabel(phase.analysis.candidates.length, 'candidato', 'candidati')} · ${formatCountLabel(phase.analysis.summary.totalPrescriptionsScanned, 'prescrizione', 'prescrizioni')}`
            : 'Analisi locale';

    return (
        <section
            id="candidati-pacchetti"
            className={rowStyles.row}
            aria-label="Gruppi di prestazioni dallo storico"
            data-testid="service-package-candidates-panel"
        >
            <Disclosure
                headingLevel={2}
                open={expanded}
                onOpenChange={handleExpandedChange}
                title={
                    <span className={rowStyles.title}>
                        <span>Gruppi di prestazioni dallo storico</span>
                        <span className={rowStyles.summary}>{summaryText}</span>
                    </span>
                }
            >
                <div className={rowStyles.body}>
                    <p className={styles.notice}>
                        Ricava sul tuo computer i gruppi di prestazioni prescritti insieme. Sono candidati personali: non sostituiscono i pacchetti clinici approvati e la frequenza non stabilisce indicazioni, esenzioni o periodicità.
                    </p>

                    <div className={styles.controls}>
                        <Button
                            variant="primary"
                            disabled={phase.kind === 'loading' || saving}
                            onClick={() => void runLocalAnalysis()}
                            data-testid="analyze-service-candidates-button"
                        >
                            {phase.kind === 'loading' ? 'Analisi in corso…' : 'Analizza storico'}
                        </Button>
                        {phase.kind === 'ready' ? (
                            <span className={styles.meta} data-testid="service-candidates-summary">
                                {formatCountLabel(phase.analysis.summary.totalPrescriptionsScanned, 'prescrizione analizzata', 'prescrizioni analizzate')} · {formatCountLabel(phase.analysis.summary.distinctPatients, 'paziente', 'pazienti')}
                            </span>
                        ) : null}
                    </div>

                    {feedback ? (
                        <p className={styles.meta} role="status" aria-live="polite" data-testid="service-candidates-feedback">
                            {feedback}
                        </p>
                    ) : null}

                    {actionError ? (
                        <p className={styles.error} role="alert" data-testid="service-candidates-error">
                            {actionError}
                        </p>
                    ) : null}

                    {phase.kind === 'error' ? (
                        <p className={styles.error} role="alert" data-testid="service-candidates-error">
                            {phase.message}
                        </p>
                    ) : null}

                    {phase.kind === 'ready' && phase.analysis.summary.candidatePoolCapped ? (
                        <p className={styles.notice} role="status" data-testid="service-candidates-partial-notice">
                            Analisi parziale: raggiunto il limite di gruppi per livello, mostrati i più frequenti.
                        </p>
                    ) : null}

                    {phase.kind === 'ready' && phase.analysis.status === 'empty_history' ? (
                        <p className={styles.notice} data-testid="service-candidates-empty">
                            Nessuna prescrizione nello storico locale. Quando registri prescrizioni con più prestazioni, puoi ricavare qui i gruppi ricorrenti.
                        </p>
                    ) : null}

                    {phase.kind === 'ready' && phase.analysis.status === 'insufficient_data' ? (
                        <p className={styles.notice} data-testid="service-candidates-insufficient-only">
                            Nessun gruppo supera le soglie minime ({formatCountLabel(phase.analysis.thresholds.minPrescriptionCount, 'prescrizione', 'prescrizioni')} su almeno {formatCountLabel(phase.analysis.thresholds.minPatientCount, 'paziente diverso', 'pazienti diversi')}).
                        </p>
                    ) : null}

                    {phase.kind === 'ready' && activeCandidates.length > 0 ? (
                        <ul className={styles.list} data-testid="service-candidates-list">
                            {activeCandidates.map((candidate) => {
                                const decision = findCandidateDecision(reviewStore, candidate.id);
                                const displayTitle = decision?.title ?? formatCandidateDefaultTitle(candidate.services);
                                const displayServices = decision?.services ?? candidate.services;
                                const displayDiagnosis = decision
                                    ? decision.associatedDiagnosis
                                    : candidate.primaryDiagnosis;
                                const isEditing = draft?.candidateId === candidate.id;

                                return (
                                    <li key={candidate.id} className={styles.card} data-testid="service-candidate-card">
                                        <div className={styles.cardHead}>
                                            <h3>{displayTitle}</h3>
                                            <div className={styles.badges}>
                                                <span className={styles.badge}>Candidato personale</span>
                                                <span className={styles.badge} data-testid="candidate-review-status">
                                                    {statusLabel(decision)}
                                                </span>
                                            </div>
                                        </div>

                                        <p className={styles.meta} data-testid="candidate-frequency">
                                            {formatCountLabel(candidate.prescriptionCount, 'prescrizione', 'prescrizioni')} · {formatCountLabel(candidate.patientCount, 'paziente', 'pazienti')}
                                        </p>

                                        <ul className={styles.services}>
                                            {displayServices.map((service) => (
                                                <li key={service.key}>
                                                    {service.serviceName}
                                                    {service.serviceCode ? ` (${service.serviceCode})` : ''}
                                                </li>
                                            ))}
                                        </ul>

                                        <p className={styles.meta} data-testid="candidate-diagnosis">
                                            {displayDiagnosis
                                                ? `Diagnosi associata: ${displayDiagnosis.description} (${displayDiagnosis.code})`
                                                : 'Nessuna diagnosi associata'}
                                            {!decision && candidate.primaryDiagnosis
                                                ? ` · ${formatCountLabel(candidate.primaryDiagnosis.prescriptionCount, 'prescrizione', 'prescrizioni')} su ${formatCountLabel(candidate.primaryDiagnosis.patientCount, 'paziente', 'pazienti')}`
                                                : ''}
                                        </p>

                                        {decision?.note ? (
                                            <p className={styles.meta}>Nota personale: {decision.note}</p>
                                        ) : null}

                                        <div className={styles.actions}>
                                            {decision?.status !== 'kept' ? (
                                                <Button
                                                    variant="secondary"
                                                    disabled={saving}
                                                    onClick={() => void mutateDecision((current) => keepCandidateDecision(current, candidate), 'Candidato conservato.')}
                                                >
                                                    Conserva
                                                </Button>
                                            ) : null}
                                            <Button
                                                variant="secondary"
                                                disabled={saving}
                                                onClick={() => openCorrectionEditor(candidate)}
                                            >
                                                Correggi
                                            </Button>
                                            <Button
                                                variant="text"
                                                disabled={saving}
                                                onClick={() => {
                                                    void mutateDecision((current) => discardCandidateDecision(current, candidate), 'Candidato scartato.').then((saved) => {
                                                        if (saved && isEditing) setDraft(null);
                                                    });
                                                }}
                                            >
                                                Scarta
                                            </Button>
                                            {decision ? (
                                                <Button
                                                    variant="text"
                                                    disabled={saving}
                                                    onClick={() => void mutateDecision((current) => restoreCandidateDecision(current, candidate.id), 'Valutazione rimossa.')}
                                                >
                                                    Rimetti da valutare
                                                </Button>
                                            ) : null}
                                        </div>

                                        {isEditing && draft ? (
                                            <div className={styles.editor} data-testid="candidate-correction-editor">
                                                <label className={styles.field}>
                                                    <span>Nome del gruppo</span>
                                                    <input
                                                        type="text"
                                                        className={styles.input}
                                                        value={draft.title}
                                                        onChange={(event) => setDraft({ ...draft, title: event.target.value, error: null })}
                                                    />
                                                </label>

                                                <fieldset className={styles.checkboxList}>
                                                    <legend>Prestazioni incluse</legend>
                                                    {candidate.services.map((service) => {
                                                        const checked = draft.selectedKeys.includes(service.key);
                                                        return (
                                                            <label key={service.key} className={styles.checkboxRow}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={checked}
                                                                    onChange={(event) => {
                                                                        const nextKeys = event.target.checked
                                                                            ? [...draft.selectedKeys, service.key]
                                                                            : draft.selectedKeys.filter((key) => key !== service.key);
                                                                        setDraft({ ...draft, selectedKeys: nextKeys, error: null });
                                                                    }}
                                                                />
                                                                <span>
                                                                    {service.serviceName}
                                                                    {service.serviceCode ? ` (${service.serviceCode})` : ''}
                                                                </span>
                                                            </label>
                                                        );
                                                    })}
                                                </fieldset>

                                                <label className={styles.field}>
                                                    <span>Diagnosi associata</span>
                                                    <select
                                                        className={styles.input}
                                                        value={draft.diagnosisSelection}
                                                        onChange={(event) => setDraft({ ...draft, diagnosisSelection: event.target.value, error: null })}
                                                    >
                                                        <option value={NONE_DIAGNOSIS_VALUE}>Nessuna diagnosi associata</option>
                                                        {candidate.diagnoses.map((diagnosis) => {
                                                            const value = diagnosisOptionValue(diagnosis);
                                                            return (
                                                                <option key={value} value={value}>
                                                                    {diagnosis.description} ({diagnosis.code})
                                                                </option>
                                                            );
                                                        })}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>Nota personale</span>
                                                    <input
                                                        type="text"
                                                        className={styles.input}
                                                        value={draft.note}
                                                        onChange={(event) => setDraft({ ...draft, note: event.target.value, error: null })}
                                                    />
                                                </label>

                                                {draft.error ? (
                                                    <p className={styles.error} role="alert">{draft.error}</p>
                                                ) : null}

                                                <div className={styles.actions}>
                                                    <Button
                                                        variant="primary"
                                                        disabled={saving}
                                                        onClick={() => void submitCorrection(candidate)}
                                                    >
                                                        Salva correzione
                                                    </Button>
                                                    <Button
                                                        variant="text"
                                                        disabled={saving}
                                                        onClick={() => setDraft(null)}
                                                    >
                                                        Annulla
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>
                    ) : null}

                    {phase.kind === 'ready' && phase.analysis.insufficientCandidates.length > 0 ? (
                        <Disclosure
                            title={`Gruppi con dati insufficienti (${phase.analysis.insufficientCandidates.length})`}
                            data-testid="service-candidates-insufficient-disclosure"
                        >
                            <ul className={styles.list}>
                                {phase.analysis.insufficientCandidates.map((candidate) => (
                                    <li key={candidate.id} className={styles.card} data-testid="service-candidate-insufficient-card">
                                        <h4>{formatCandidateDefaultTitle(candidate.services)}</h4>
                                        <p className={styles.meta}>
                                            {sufficiencyNote(
                                                candidate,
                                                phase.analysis.thresholds.minPrescriptionCount,
                                                phase.analysis.thresholds.minPatientCount,
                                            )}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </Disclosure>
                    ) : null}

                    {phase.kind === 'ready' && discardedCandidates.length > 0 ? (
                        <Disclosure
                            title={`Candidati scartati (${discardedCandidates.length})`}
                            data-testid="service-candidates-discarded-disclosure"
                        >
                            <ul className={styles.list}>
                                {discardedCandidates.map((candidate) => {
                                    const decision = findCandidateDecision(reviewStore, candidate.id);
                                    return (
                                        <li key={candidate.id} className={styles.card} data-testid="service-candidate-discarded-card">
                                            <div className={styles.cardHead}>
                                                <h4>{decision?.title ?? formatCandidateDefaultTitle(candidate.services)}</h4>
                                                <span className={styles.badge}>Scartato</span>
                                            </div>
                                            <p className={styles.meta}>
                                                {formatCountLabel(candidate.prescriptionCount, 'prescrizione', 'prescrizioni')} · {formatCountLabel(candidate.patientCount, 'paziente', 'pazienti')}
                                            </p>
                                            <div className={styles.actions}>
                                                <Button
                                                    variant="secondary"
                                                    disabled={saving}
                                                    onClick={() => void mutateDecision((current) => restoreCandidateDecision(current, candidate.id), 'Candidato ripristinato.')}
                                                >
                                                    Ripristina
                                                </Button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Disclosure>
                    ) : null}
                </div>
            </Disclosure>
        </section>
    );
}
