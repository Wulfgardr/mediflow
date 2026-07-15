'use client';

/* @Codex */
import { useEffect, useMemo, useState } from 'react';
/* @Codex */
import {
    AlertTriangle,
    CheckCircle2,
    ClipboardCheck,
    FileSearch,
    FileText,
    Pill,
    Stethoscope,
    X,
} from 'lucide-react';
/* @Codex */
import {
    applyPatientDocumentReview,
    type PatientDocumentReviewDraft,
    type ReviewedPatientImportDefaults,
} from '@/lib/domain/documents/patient-document-review';
/* @Codex */
import { buildPatientImportDecision } from '@/lib/domain/documents/patient-import-decision';
/* @Codex */
import { buildPatientDocumentDecision } from '@/lib/domain/documents/patient-document-decision';
/* @Codex */
import DocumentDecisionReviewCard from '@/components/document-decision-review-card';
import { confidenceLabel } from '@/lib/ai-labels';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import { therapySuggestionStateSignal } from '@/lib/ui-semantic-signal';

interface PatientDocumentImportReviewProps {
    draft: PatientDocumentReviewDraft;
    onApply: (reviewedDefaults: ReviewedPatientImportDefaults) => void;
    onDismiss: () => void;
}

/* @Codex */
function cloneDraft(draft: PatientDocumentReviewDraft): PatientDocumentReviewDraft {
    return {
        ...draft,
        quality: draft.quality ? { ...draft.quality } : undefined,
        fields: draft.fields.map((field) => ({ ...field })),
        diagnoses: draft.diagnoses.map((diagnosis) => ({ ...diagnosis })),
        medications: draft.medications.map((medication) => ({ ...medication })),
        servicePrescriptions: (draft.servicePrescriptions ?? []).map((item) => ({ ...item })),
    };
}

/* @Codex */
function qualityTone(level?: 'green' | 'yellow' | 'red') {
    if (level === 'red') {
        return {
            panel: 'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))]',
            icon: 'bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]',
            text: 'text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]',
        };
    }

    if (level === 'green') {
        return {
            panel: 'border-[color:color-mix(in_srgb,var(--lume-signal-success)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))]',
            icon: 'bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]',
            text: 'text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]',
        };
    }

    if (level === 'yellow') {
        return {
            panel: 'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))]',
            icon: 'bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]',
            text: 'text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]',
        };
    }

    return {
        panel: 'border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-focal)]',
        icon: 'bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] text-[color:var(--lume-accent)]',
        text: 'text-[color:var(--lume-ink-muted)]',
    };
}

/* @Codex */
function therapyStateBadgeClasses(state: 'active' | 'transition' | 'uncertain' | 'inactive') {
    return semanticSignalSurfaceClass(therapySuggestionStateSignal(state));
}

/* @Codex */
function therapyStateLabel(state: 'active' | 'transition' | 'uncertain' | 'inactive') {
    if (state === 'transition') return 'transizione';
    if (state === 'uncertain') return 'incerta';
    if (state === 'inactive') return 'non attiva';
    return 'attiva';
}

/* @Codex */
function therapyMatchLabel(matchType: 'catalog' | 'manual' | 'none') {
    if (matchType === 'catalog') return 'match AIFA';
    if (matchType === 'manual') return 'manuale';
    return 'senza match';
}

export default function PatientDocumentImportReview({
    draft,
    onApply,
    onDismiss,
}: PatientDocumentImportReviewProps) {
    const [localDraft, setLocalDraft] = useState(() => cloneDraft(draft));

    useEffect(() => {
        setLocalDraft(cloneDraft(draft));
    }, [draft]);

    const counters = useMemo(() => ({
        fields: localDraft.fields.filter((field) => field.included).length,
        diagnoses: localDraft.diagnoses.filter((diagnosis) => diagnosis.included).length,
        medications: localDraft.medications.filter((medication) => medication.included).length,
        servicePrescriptions: (localDraft.servicePrescriptions ?? []).filter((item) => item.included).length,
    }), [localDraft]);
    /* @Codex */
    const importDecision = useMemo(() => buildPatientImportDecision(localDraft), [localDraft]);
    /* @Codex */
    const documentDecision = useMemo(() => buildPatientDocumentDecision(localDraft), [localDraft]);

    const tone = qualityTone(localDraft.quality?.level);

    return (
        <div className={`lume-panel rounded-[32px] border p-6 md:p-8 ${tone.panel}`}>
            <div className="flex flex-col gap-5 border-b border-black/5 pb-6 dark:border-white/5 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone.icon}`}>
                        <ClipboardCheck className="h-6 w-6" />
                    </div>
                    <div className="space-y-2">
                        <div>
                            <p className="section-kicker">Controllo documento</p>
                            <h2 className="text-2xl font-black tracking-tight text-[color:var(--lume-ink)]">
                                Scegli cosa portare nella scheda
                            </h2>
                        </div>
                        <p className={`max-w-3xl text-sm leading-relaxed ${tone.text}`}>
                            I dati estratti restano in bozza: puoi confermare, correggere o escludere
                            ogni gruppo prima di applicarlo alla scheda.
                        </p>
                        <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                            <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-3 py-1 text-[color:var(--lume-ink-muted)]">
                                {localDraft.sourceLabel}
                            </span>
                            <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-3 py-1 text-[color:var(--lume-ink-muted)]">
                                Confidenza import {Math.round(localDraft.confidence * 100)}%
                            </span>
                            <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-3 py-1 text-[color:var(--lume-ink-muted)]">
                                {counters.fields} campi · {counters.diagnoses} diagnosi · {counters.medications} terapie · {counters.servicePrescriptions} prestazioni
                            </span>
                            <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-3 py-1 text-[color:var(--lume-ink-muted)]">
                                {importDecision.summary.structuredDiagnosisCount} diagnosi pronte · {importDecision.summary.structuredTherapyCount} terapie pronte · {importDecision.summary.servicePrescriptionProposalCount} prestazioni proposte · {importDecision.summary.noteOnlyTherapyCount} note da ricontrollare
                            </span>
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onDismiss}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 text-xs font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)] transition-[border-color,background-color,color] hover:border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] hover:text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]"
                >
                    <X className="h-4 w-4" />
                    Scarta documento
                </button>
            </div>

            {localDraft.quality?.reason && (
                <div className={`mt-5 flex items-start gap-3 rounded-[24px] border p-4 ${tone.panel}`}>
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${tone.icon}`}>
                        {localDraft.quality?.level === 'red' ? (
                            <AlertTriangle className="h-4 w-4" />
                        ) : (
                            <CheckCircle2 className="h-4 w-4" />
                        )}
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-bold text-[color:var(--lume-ink)]">
                            Qualità documento: {localDraft.quality.reason}
                        </p>
                        {localDraft.sourceExcerpt && (
                            <p className="text-xs leading-relaxed text-[color:var(--lume-ink-muted)]">
                                Estratto fonte: &ldquo;{localDraft.sourceExcerpt}&rdquo;
                            </p>
                        )}
                    </div>
                </div>
            )}

            <div className="mt-5">
                <DocumentDecisionReviewCard decision={documentDecision} />
            </div>

            <div className="mt-6 space-y-6">
                {localDraft.fields.length > 0 && (
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <FileText className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--lume-ink-muted)]">
                                Anagrafica e contatti
                            </h3>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            {localDraft.fields.map((field) => (
                                <div key={field.key} className="rounded-[24px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <p className="text-sm font-bold text-[color:var(--lume-ink)]">{field.label}</p>
                                            <p className="text-[11px] text-[color:var(--lume-ink-muted)]">{field.sourceLabel}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={field.included}
                                            onChange={() => setLocalDraft((current) => ({
                                                ...current,
                                                fields: current.fields.map((item) => item.key === field.key ? { ...item, included: !item.included } : item),
                                            }))}
                                            className="mt-1 h-4 w-4 rounded-full border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] text-[color:var(--lume-accent)] focus:ring-[color:var(--lume-accent)]"
                                        />
                                    </div>

                                    {field.kind === 'textarea' ? (
                                        <textarea
                                            value={field.value}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                fields: current.fields.map((item) => item.key === field.key ? { ...item, value: event.target.value } : item),
                                            }))}
                                            rows={4}
                                            className="w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                    ) : (
                                        <input
                                            type={field.kind}
                                            value={field.value}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                fields: current.fields.map((item) => item.key === field.key ? { ...item, value: event.target.value } : item),
                                            }))}
                                            className="w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {localDraft.diagnoses.length > 0 && (
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <Stethoscope className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--lume-ink-muted)]">
                                Diagnosi candidate
                            </h3>
                        </div>

                        <div className="space-y-3">
                            {localDraft.diagnoses.map((diagnosis) => (
                                <div key={diagnosis.id} className="rounded-[24px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                                    {diagnosis.system}
                                                </span>
                                                {diagnosis.confidence && (
                                                    <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                                        {confidenceLabel(diagnosis.confidence)}
                                                    </span>
                                                )}
                                            </div>
                                            {diagnosis.evidence && (
                                                <p className="text-[11px] text-[color:var(--lume-ink-muted)]">
                                                    Evidenza: {diagnosis.evidence}
                                                </p>
                                            )}
                                            {diagnosis.blockedReason && (
                                                <p className="text-[11px] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                                                    {diagnosis.blockedReason}
                                                </p>
                                            )}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={diagnosis.included}
                                            onChange={() => setLocalDraft((current) => ({
                                                ...current,
                                                diagnoses: current.diagnoses.map((item) => item.id === diagnosis.id ? { ...item, included: !item.included } : item),
                                            }))}
                                            className="mt-1 h-4 w-4 rounded-full border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] text-[color:var(--lume-accent)] focus:ring-[color:var(--lume-accent)]"
                                        />
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-[140px,1fr]">
                                        <input
                                            value={diagnosis.code}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                diagnoses: current.diagnoses.map((item) => item.id === diagnosis.id ? { ...item, code: event.target.value } : item),
                                            }))}
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm font-mono text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                        <input
                                            value={diagnosis.description}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                diagnoses: current.diagnoses.map((item) => item.id === diagnosis.id ? { ...item, description: event.target.value } : item),
                                            }))}
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {(localDraft.servicePrescriptions ?? []).length > 0 && (
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <ClipboardCheck className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--lume-ink-muted)]">
                                Prestazioni prescritte
                            </h3>
                        </div>

                        <div className="rounded-[8px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4 text-xs leading-relaxed text-[color:var(--lume-ink-muted)]">
                            Queste voci sono visite, esami, imaging o riabilitazione: restano fuori dal piano farmacologico e vengono proposte per il dominio dedicato.
                        </div>

                        <div className="space-y-3">
                            {(localDraft.servicePrescriptions ?? []).map((item) => (
                                <div key={item.id} className="rounded-[8px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-bold text-[color:var(--lume-ink)]">{item.serviceName}</p>
                                                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                                    {item.category ?? 'other'}
                                                </span>
                                                {item.confidence && (
                                                    <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                                        {confidenceLabel(item.confidence)}
                                                    </span>
                                                )}
                                            </div>
                                            {item.evidence && (
                                                <p className="text-[11px] text-[color:var(--lume-ink-muted)]">
                                                    Evidenza: {item.evidence}
                                                </p>
                                            )}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={item.included}
                                            onChange={() => setLocalDraft((current) => ({
                                                ...current,
                                                servicePrescriptions: (current.servicePrescriptions ?? []).map((candidate) => (
                                                    candidate.id === item.id ? { ...candidate, included: !candidate.included } : candidate
                                                )),
                                            }))}
                                            className="mt-1 h-4 w-4 rounded-full border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] text-[color:var(--lume-accent)] focus:ring-[color:var(--lume-accent)]"
                                        />
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-2">
                                        <input
                                            value={item.serviceName}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                servicePrescriptions: (current.servicePrescriptions ?? []).map((candidate) => candidate.id === item.id ? { ...candidate, serviceName: event.target.value } : candidate),
                                            }))}
                                            placeholder="Nome prestazione"
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                        <input
                                            value={item.serviceCode || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                servicePrescriptions: (current.servicePrescriptions ?? []).map((candidate) => candidate.id === item.id ? { ...candidate, serviceCode: event.target.value } : candidate),
                                            }))}
                                            placeholder="Codice prestazione"
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                        <input
                                            value={item.clinicalQuestion || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                servicePrescriptions: (current.servicePrescriptions ?? []).map((candidate) => candidate.id === item.id ? { ...candidate, clinicalQuestion: event.target.value } : candidate),
                                            }))}
                                            placeholder="Quesito clinico"
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                        <input
                                            value={item.provider || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                servicePrescriptions: (current.servicePrescriptions ?? []).map((candidate) => candidate.id === item.id ? { ...candidate, provider: event.target.value } : candidate),
                                            }))}
                                            placeholder="Struttura / specialita"
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {localDraft.medications.length > 0 && (
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <Pill className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--lume-ink-muted)]">
                                Terapie candidate
                            </h3>
                        </div>

                        <div className="rounded-[24px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4 text-xs leading-relaxed text-[color:var(--lume-ink-muted)]">
                            Le terapie attive confermate con nome farmaco e posologia verranno salvate come terapia strutturata subito dopo la creazione della scheda.
                            I casi incompleti o non attivi possono restare come promemoria nelle note solo se li mantieni selezionati.
                        </div>

                        <div className="space-y-3">
                            {localDraft.medications.map((medication) => (
                                <div key={medication.id} className="rounded-[24px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-bold text-[color:var(--lume-ink)]">
                                                    {medication.drugName || 'Terapia proposta'}
                                                </p>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${therapyStateBadgeClasses(medication.therapyState)}`}>
                                                    {therapyStateLabel(medication.therapyState)}
                                                </span>
                                                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                                    {therapyMatchLabel(medication.matchType)}
                                                </span>
                                                {medication.confidence && (
                                                    <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                                        {confidenceLabel(medication.confidence)}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-[color:var(--lume-ink-muted)]">{medication.sourceLabel}</p>
                                            {medication.evidence && (
                                                <p className="text-[11px] text-[color:var(--lume-ink-muted)]">
                                                    Evidenza: {medication.evidence}
                                                </p>
                                            )}
                                            {medication.blockedReason && (
                                                <p className="text-[11px] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                                                    {medication.blockedReason}
                                                </p>
                                            )}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={medication.included}
                                            onChange={() => setLocalDraft((current) => ({
                                                ...current,
                                                medications: current.medications.map((item) => item.id === medication.id ? { ...item, included: !item.included } : item),
                                            }))}
                                            className="mt-1 h-4 w-4 rounded-full border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] text-[color:var(--lume-accent)] focus:ring-[color:var(--lume-accent)]"
                                        />
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-2">
                                        <input
                                            value={medication.drugName}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                medications: current.medications.map((item) => item.id === medication.id ? { ...item, drugName: event.target.value } : item),
                                            }))}
                                            placeholder="Nome farmaco"
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                        <input
                                            value={medication.dosage || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                medications: current.medications.map((item) => item.id === medication.id ? { ...item, dosage: event.target.value } : item),
                                            }))}
                                            placeholder="Posologia"
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                        <input
                                            value={medication.activePrinciple || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                medications: current.medications.map((item) => item.id === medication.id ? { ...item, activePrinciple: event.target.value } : item),
                                            }))}
                                            placeholder="Principio attivo"
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                        <input
                                            value={medication.motivation || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                medications: current.medications.map((item) => item.id === medication.id ? { ...item, motivation: event.target.value } : item),
                                            }))}
                                            placeholder="Indicazione / contesto"
                                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-4 py-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_24%,transparent)]"
                                        />
                                    </div>

                                    {(medication.aic || medication.atc) && (
                                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                            {medication.aic && (
                                                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-1">
                                                    AIC {medication.aic}
                                                </span>
                                            )}
                                            {medication.atc && (
                                                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-1">
                                                    ATC {medication.atc}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-black/5 pt-6 dark:border-white/5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs text-[color:var(--lume-ink-muted)]">
                    <FileSearch className="h-4 w-4" />
                    Il passaggio alla scheda resta esplicito: nessun campo viene salvato in automatico.
                </div>

                <button
                    type="button"
                    onClick={() => onApply(applyPatientDocumentReview(localDraft))}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[color:var(--lume-accent)] px-6 text-xs font-bold uppercase tracking-wide text-[color:var(--lume-surface-focal)] shadow-lg transition-[background-color,opacity,transform] hover:bg-[color:color-mix(in_srgb,var(--lume-accent)_82%,var(--lume-ink))] active:scale-95"
                >
                    <CheckCircle2 className="h-4 w-4" />
                    Porta nella scheda
                </button>
            </div>
        </div>
    );
}
