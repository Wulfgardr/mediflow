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
} from '@/lib/patient-document-review';
/* @Codex */
import { buildPatientImportDecision } from '@/lib/patient-import-decision';
/* @Codex */
import { buildPatientDocumentDecision } from '@/lib/patient-document-decision';
/* @Codex */
import DocumentDecisionReviewCard from '@/components/document-decision-review-card';

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
    };
}

/* @Codex */
function qualityTone(level?: 'green' | 'yellow' | 'red') {
    if (level === 'red') {
        return {
            panel: 'border-red-200 bg-red-50/60 dark:border-red-500/20 dark:bg-red-950/10',
            icon: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
            text: 'text-red-700 dark:text-red-200',
        };
    }

    if (level === 'green') {
        return {
            panel: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-950/10',
            icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
            text: 'text-emerald-700 dark:text-emerald-200',
        };
    }

    return {
        panel: 'border-blue-200 bg-blue-50/60 dark:border-blue-500/20 dark:bg-blue-950/10',
        icon: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
        text: 'text-blue-700 dark:text-blue-200',
    };
}

/* @Codex */
function therapyStateBadgeClasses(state: 'active' | 'transition' | 'uncertain' | 'inactive') {
    if (state === 'transition') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200';
    if (state === 'uncertain') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200';
    if (state === 'inactive') return 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300';
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200';
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
    }), [localDraft]);
    /* @Codex */
    const importDecision = useMemo(() => buildPatientImportDecision(localDraft), [localDraft]);
    /* @Codex */
    const documentDecision = useMemo(() => buildPatientDocumentDecision(localDraft), [localDraft]);

    const tone = qualityTone(localDraft.quality?.level);

    return (
        <div className={`glass-panel mb-10 rounded-[32px] border p-6 md:p-8 ${tone.panel}`}>
            <div className="flex flex-col gap-5 border-b border-black/5 pb-6 dark:border-white/5 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone.icon}`}>
                        <ClipboardCheck className="h-6 w-6" />
                    </div>
                    <div className="space-y-2">
                        <div>
                            <p className="section-kicker">Review documento</p>
                            <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                                Conferma cosa applicare al form
                            </h2>
                        </div>
                        <p className={`max-w-3xl text-sm leading-relaxed ${tone.text}`}>
                            In questa slice i dati estratti non entrano piu direttamente nel create patient:
                            puoi confermare, correggere o escludere ogni gruppo prima di applicarli al form.
                        </p>
                        <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                            <span className="rounded-full bg-white/80 px-3 py-1 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                                {localDraft.sourceLabel}
                            </span>
                            <span className="rounded-full bg-white/80 px-3 py-1 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                                Confidenza import {Math.round(localDraft.confidence * 100)}%
                            </span>
                            <span className="rounded-full bg-white/80 px-3 py-1 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                                {counters.fields} campi · {counters.diagnoses} diagnosi · {counters.medications} terapie
                            </span>
                            <span className="rounded-full bg-white/80 px-3 py-1 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                                {importDecision.summary.structuredDiagnosisCount} write diagnosi · {importDecision.summary.structuredTherapyCount} write terapie · {importDecision.summary.noteOnlyTherapyCount} note da riconciliare
                            </span>
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onDismiss}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold uppercase tracking-wide text-slate-600 transition-[border-color,background-color,color] hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-red-400/30 dark:hover:bg-red-950/20 dark:hover:text-red-200"
                >
                    <X className="h-4 w-4" />
                    Scarta import
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
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                            Qualita documento: {localDraft.quality.reason}
                        </p>
                        {localDraft.sourceExcerpt && (
                            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
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
                            <FileText className="h-4 w-4 text-blue-500" />
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                Anagrafica e contatti
                            </h3>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            {localDraft.fields.map((field) => (
                                <div key={field.key} className="rounded-[24px] border border-slate-200/70 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <p className="text-sm font-bold text-slate-900 dark:text-white">{field.label}</p>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{field.sourceLabel}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={field.included}
                                            onChange={() => setLocalDraft((current) => ({
                                                ...current,
                                                fields: current.fields.map((item) => item.key === field.key ? { ...item, included: !item.included } : item),
                                            }))}
                                            className="mt-1 h-4 w-4 rounded-full border-slate-300 text-blue-600 focus:ring-blue-500"
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
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                        />
                                    ) : (
                                        <input
                                            type={field.kind}
                                            value={field.value}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                fields: current.fields.map((item) => item.key === field.key ? { ...item, value: event.target.value } : item),
                                            }))}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
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
                            <Stethoscope className="h-4 w-4 text-rose-500" />
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                Diagnosi candidate
                            </h3>
                        </div>

                        <div className="space-y-3">
                            {localDraft.diagnoses.map((diagnosis) => (
                                <div key={diagnosis.id} className="rounded-[24px] border border-slate-200/70 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">
                                                    {diagnosis.system}
                                                </span>
                                                {diagnosis.confidence && (
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-slate-300">
                                                        {diagnosis.confidence}
                                                    </span>
                                                )}
                                            </div>
                                            {diagnosis.evidence && (
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                    Evidenza: {diagnosis.evidence}
                                                </p>
                                            )}
                                            {diagnosis.blockedReason && (
                                                <p className="text-[11px] text-amber-600 dark:text-amber-300">
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
                                            className="mt-1 h-4 w-4 rounded-full border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-[140px,1fr]">
                                        <input
                                            value={diagnosis.code}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                diagnoses: current.diagnoses.map((item) => item.id === diagnosis.id ? { ...item, code: event.target.value } : item),
                                            }))}
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-mono text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                        />
                                        <input
                                            value={diagnosis.description}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                diagnoses: current.diagnoses.map((item) => item.id === diagnosis.id ? { ...item, description: event.target.value } : item),
                                            }))}
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
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
                            <Pill className="h-4 w-4 text-emerald-500" />
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                Terapie candidate
                            </h3>
                        </div>

                        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/70 p-4 text-xs leading-relaxed text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-950/10 dark:text-emerald-200">
                            Le terapie attive confermate con nome farmaco e posologia verranno salvate come terapia strutturata subito dopo la creazione della scheda.
                            I casi incompleti o non attivi possono restare come promemoria nelle note solo se li mantieni selezionati.
                        </div>

                        <div className="space-y-3">
                            {localDraft.medications.map((medication) => (
                                <div key={medication.id} className="rounded-[24px] border border-slate-200/70 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-bold text-slate-900 dark:text-white">
                                                    {medication.drugName || 'Terapia proposta'}
                                                </p>
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${therapyStateBadgeClasses(medication.therapyState)}`}>
                                                    {therapyStateLabel(medication.therapyState)}
                                                </span>
                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-slate-300">
                                                    {therapyMatchLabel(medication.matchType)}
                                                </span>
                                                {medication.confidence && (
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-slate-300">
                                                        {medication.confidence}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{medication.sourceLabel}</p>
                                            {medication.evidence && (
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                    Evidenza: {medication.evidence}
                                                </p>
                                            )}
                                            {medication.blockedReason && (
                                                <p className="text-[11px] text-amber-600 dark:text-amber-300">
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
                                            className="mt-1 h-4 w-4 rounded-full border-slate-300 text-blue-600 focus:ring-blue-500"
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
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                        />
                                        <input
                                            value={medication.dosage || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                medications: current.medications.map((item) => item.id === medication.id ? { ...item, dosage: event.target.value } : item),
                                            }))}
                                            placeholder="Posologia"
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                        />
                                        <input
                                            value={medication.activePrinciple || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                medications: current.medications.map((item) => item.id === medication.id ? { ...item, activePrinciple: event.target.value } : item),
                                            }))}
                                            placeholder="Principio attivo"
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                        />
                                        <input
                                            value={medication.motivation || ''}
                                            onChange={(event) => setLocalDraft((current) => ({
                                                ...current,
                                                medications: current.medications.map((item) => item.id === medication.id ? { ...item, motivation: event.target.value } : item),
                                            }))}
                                            placeholder="Indicazione / contesto"
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                        />
                                    </div>

                                    {(medication.aic || medication.atc) && (
                                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                                            {medication.aic && (
                                                <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-white/10">
                                                    AIC {medication.aic}
                                                </span>
                                            )}
                                            {medication.atc && (
                                                <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-white/10">
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
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <FileSearch className="h-4 w-4" />
                    L&apos;applicazione al form resta esplicita: nessun campo viene salvato in automatico.
                </div>

                <button
                    type="button"
                    onClick={() => onApply(applyPatientDocumentReview(localDraft))}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-blue-600 px-6 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-blue-500/20 transition-[background-color,opacity,transform] hover:bg-blue-700 active:scale-95"
                >
                    <CheckCircle2 className="h-4 w-4" />
                    Applica al form
                </button>
            </div>
        </div>
    );
}
