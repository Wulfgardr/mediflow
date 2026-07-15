'use client';

/* @Codex */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
    AlertTriangle,
    BrainCircuit,
    ChevronDown,
    ClipboardList,
    RefreshCw,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import PrivacyBlur from '@/components/privacy-blur';
import {
    AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
    AiTreatmentReasoningDisabledError,
    isAiTreatmentReasoningEnabledValue,
} from '@/lib/ai-treatment-reasoning-kill-switch';
import { db, type Attachment, type ClinicalEntry, type Observation, type Patient, type Therapy } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import {
    countTreatmentReasoningSources,
    DEFAULT_TREATMENT_REASONING_QUESTION,
} from '@/lib/treatment-reasoning-context';
import {
    generatePatientTreatmentReasoningDraft,
    type TreatmentReasoningDraft,
} from '@/lib/treatment-reasoning-service';
import type {
    TreatmentReasoningEvidenceRef,
    TreatmentReasoningSafetySeverity,
    TreatmentReasoningSuggestedAction,
} from '@/lib/treatment-reasoning-contract';
import { DocumentReferenceChip } from '@/components/document-reference-chip';
import {
    semanticSignalSurfaceClass,
    semanticSignalTextClass,
} from '@/components/ui/semantic-signal';

interface TreatmentReasoningPanelProps {
    patient: Patient;
    entries?: ClinicalEntry[];
    therapies?: Therapy[];
    observations?: Observation[];
    attachments?: Attachment[];
}

function severityClasses(severity: TreatmentReasoningSafetySeverity): string {
    if (severity === 'urgent_review') return 'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]';
    if (severity === 'caution') return 'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]';
    return 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink)]';
}

function actionPolicyLabel(action: TreatmentReasoningSuggestedAction): string {
    if (action.writePolicy === 'form_prefill_only') return 'prefill futuro';
    if (action.writePolicy === 'no_write') return 'nessuna scrittura';
    return 'solo revisione';
}

function sourceKindLabel(source: TreatmentReasoningEvidenceRef): string {
    if (source.sourceKind === 'therapy') return 'Terapia';
    if (source.sourceKind === 'diagnosis') return 'Diagnosi';
    if (source.sourceKind === 'observation') return 'Parametro';
    if (source.sourceKind === 'clinical-entry') return 'Diario';
    if (source.sourceKind === 'document-insight') return 'Documento';
    if (source.sourceKind === 'attachment-evidence') return 'Allegato';
    return 'Profilo';
}

function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('it-IT', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function TreatmentReasoningPanel({
    patient,
    entries = [],
    therapies = [],
    observations = [],
    attachments = [],
}: TreatmentReasoningPanelProps) {
    const [draft, setDraft] = useState<TreatmentReasoningDraft | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const treatmentReasoningKillSwitch = useLiveQuery(
        () => db.settings.get(AI_TREATMENT_REASONING_KILL_SWITCH_KEY),
        [],
    );
    const treatmentReasoningEnabled = isAiTreatmentReasoningEnabledValue(treatmentReasoningKillSwitch?.value);
    const sourceSummary = useMemo(
        () => countTreatmentReasoningSources({ patient, entries, therapies, observations, attachments }),
        [patient, entries, therapies, observations, attachments],
    );
    const sourceSummaryItems = [
        ['Terapie', sourceSummary.activeTherapies],
        ['Diagnosi', sourceSummary.diagnoses],
        ['Parametri', sourceSummary.observations],
        ['Diario', sourceSummary.clinicalEntries],
        ['Evidenze', sourceSummary.documentInsights + sourceSummary.attachmentEvidence],
    ];
    const canGenerate = treatmentReasoningEnabled && sourceSummary.total > 0 && !isGenerating;

    if (sourceSummary.total === 0) {
        return null;
    }

    const generateDraft = async () => {
        if (!treatmentReasoningEnabled) {
            setError('Treatment Reasoning è disabilitato localmente. Riattivalo in Impostazioni AI per generare bozze.');
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            const nextDraft = await generatePatientTreatmentReasoningDraft(patient.id, {
                question: DEFAULT_TREATMENT_REASONING_QUESTION,
            });
            setDraft(nextDraft);
        } catch (generationError) {
            if (generationError instanceof AiTreatmentReasoningDisabledError) {
                setError('Treatment Reasoning è disabilitato localmente. Riattivalo in Impostazioni AI per generare bozze.');
            } else {
                setError(generationError instanceof Error ? generationError.message : 'Ragionamento terapeutico non disponibile');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="patient-detail-section overflow-hidden border p-0" data-testid="treatment-reasoning-panel">
            <div className="border-b border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-[color:var(--lume-ink)] text-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)]">
                            <BrainCircuit className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Review terapie</p>
                            <h3 className="mt-1 text-lg font-semibold text-[color:var(--lume-ink)]">Ragionamento terapeutico</h3>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="apple-chip">{sourceSummary.total} fonti</span>
                                <span className="apple-chip">review-only</span>
                                {draft ? (
                                    <span className="break-all text-[10px] font-semibold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                        {draft.model.provider} · {draft.model.model}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={generateDraft}
                        disabled={!canGenerate}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[12px] bg-[color:var(--lume-ink)] px-4 text-xs font-bold text-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)] transition-[background-color,opacity,transform] hover:bg-[color:var(--lume-accent)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {draft ? 'Aggiorna bozza' : 'Genera bozza'}
                    </button>
                </div>
            </div>

            <div className="space-y-4 p-5">
                {!treatmentReasoningEnabled ? (
                    <div className="flex items-start gap-3 rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] p-4 text-sm text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                            <p className="font-semibold">Treatment Reasoning disabilitato</p>
                            <p className="mt-1 text-xs leading-5">Il pannello resta visibile per leggere bozze già generate, ma non avvia nuove chiamate al modello finché il kill switch non viene riattivato.</p>
                            <Link href="/settings/ai/funzioni" className="mt-2 inline-block text-xs font-semibold underline underline-offset-4">
                                Apri Impostazioni AI
                            </Link>
                        </div>
                    </div>
                ) : null}

                {error ? (
                    <div role="alert" className="flex items-start gap-2 rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] p-3 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-5">
                    {sourceSummaryItems.map(([label, value]) => (
                        <div key={label} className="rounded-[14px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)] px-3 py-2">
                            <span className="block text-[9px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">{label}</span>
                            <span className="text-sm font-semibold text-[color:var(--lume-ink)]">{value}</span>
                        </div>
                    ))}
                </div>

                {!draft && !isGenerating ? (
                    <div className="rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-4 text-sm leading-6 text-[color:var(--lume-ink-muted)] transition-colors duration-[var(--lume-dur-firma)]">
                        Bozza da strumento locale per verificare coerenza del piano, rischi e prossime azioni senza scrivere nulla in scheda. La fonte effettiva compare dopo la generazione.
                    </div>
                ) : null}

                {isGenerating ? (
                    <div role="status" aria-live="polite" className="space-y-3 py-8 text-center">
                        <RefreshCw className="mx-auto h-7 w-7 text-[color:var(--lume-ink-muted)]" />
                        <p className="text-xs font-bold uppercase tracking-widest text-[color:var(--lume-ink-muted)]">Chiamata al modello locale...</p>
                    </div>
                ) : null}

                {draft && !isGenerating ? (
                    <div className="space-y-5">
                        <div className="rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-4 text-[color:var(--lume-ink-muted)] transition-colors duration-[var(--lume-dur-firma)] ease-[var(--lume-ease)]">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Bozza da rivedere</p>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--lume-ink-muted)]"><PrivacyBlur intensity="sm">{draft.envelope.data.recommendation || draft.envelope.summary || 'Nessuna raccomandazione utilizzabile.'}</PrivacyBlur></p>
                            <div className="mt-3 flex items-start gap-2 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] pt-3 text-xs leading-5 text-[color:var(--lume-ink-muted)]">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <p>Supporto locale alla revisione: non è una prescrizione, non applica modifiche e richiede verifica clinica.</p>
                            </div>
                        </div>

                        {(!draft.parse.validJson || !draft.parse.validTask || !draft.parse.validEvidenceRefs) ? (
                            <div className={`rounded-[16px] border p-3 text-xs ${semanticSignalSurfaceClass(
                                !draft.parse.validJson || !draft.parse.validTask ? 'critical' : 'warning',
                            )}`}>
                                Contratto parziale: JSON {draft.parse.validJson ? 'ok' : 'non valido'}, schema {draft.parse.validTask ? 'ok' : 'non valido'}, citazioni {draft.parse.validEvidenceRefs ? 'ok' : 'da rivedere'}.
                            </div>
                        ) : null}

                        {draft.envelope.data.caveats.length > 0 ? (
                            <div className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] p-4 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em]">Dati mancanti e limiti</h4>
                                </div>
                                <ul className="mt-3 space-y-2 text-sm leading-5">
                                    {draft.envelope.data.caveats.map((caveat, index) => (
                                        <li key={`${index}-${caveat}`} className="flex gap-2">
                                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--lume-signal-warning)]" />
                                            <span><PrivacyBlur intensity="sm">{caveat}</PrivacyBlur></span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        <div className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <ClipboardList className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Evidenze chiave</h4>
                                </div>
                                {draft.envelope.data.keyEvidence.length === 0 ? (
                                    <p className={`rounded-[14px] border p-3 text-xs ${semanticSignalSurfaceClass('critical')}`}>Nessuna evidenza chiave strutturata.</p>
                                ) : draft.envelope.data.keyEvidence.map((evidence) => (
                                    <div key={evidence.id} className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)] p-3">
                                        <p className="text-sm font-semibold leading-5 text-[color:var(--lume-ink)]"><PrivacyBlur intensity="sm">{evidence.statement}</PrivacyBlur></p>
                                        <DocumentReferenceChip references={evidence.evidenceRefs} />
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Flag e cautele</h4>
                                </div>
                                {draft.envelope.data.safetyFlags.length === 0 ? (
                                    <p className="rounded-[14px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)] p-3 text-xs text-[color:var(--lume-ink-muted)]">Nessun flag strutturato dal modello.</p>
                                ) : draft.envelope.data.safetyFlags.map((flag) => (
                                    <div key={flag.id} className={`rounded-[16px] border p-3 ${severityClasses(flag.severity)}`}>
                                        <p className="text-sm font-semibold"><PrivacyBlur intensity="sm">{flag.label}</PrivacyBlur></p>
                                        <p className="mt-1 text-xs leading-5"><PrivacyBlur intensity="sm">{flag.rationale}</PrivacyBlur></p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {draft.envelope.data.suggestedActions.length > 0 ? (
                            <div className="space-y-3">
                                <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Azioni proposte</h4>
                                <div className="grid gap-3 md:grid-cols-2">
                                    {draft.envelope.data.suggestedActions.map((action) => (
                                        <div key={action.id} className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)] p-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-semibold text-[color:var(--lume-ink)]"><PrivacyBlur intensity="sm">{action.label}</PrivacyBlur></p>
                                                <span className="apple-chip">{actionPolicyLabel(action)}</span>
                                            </div>
                                            <p className="mt-2 text-xs leading-5 text-[color:var(--lume-ink-muted)]"><PrivacyBlur intensity="sm">{action.rationale}</PrivacyBlur></p>
                                            {action.blockedReason ? (
                                                <p className={`mt-2 text-[11px] font-medium ${semanticSignalTextClass('critical')}`}>Blocco: <PrivacyBlur intensity="sm">{action.blockedReason}</PrivacyBlur></p>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {draft.envelope.data.reasoning.length > 0 ? (
                            <details className="group rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)]">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                    Traccia sintetica del ragionamento
                                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                                </summary>
                                <ol className="space-y-2 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] px-4 py-3 text-sm leading-5 text-[color:var(--lume-ink)]">
                                    {draft.envelope.data.reasoning.map((item, index) => (
                                        <li key={`${index}-${item}`} className="flex gap-2">
                                            <span className="font-semibold text-[color:var(--lume-ink-muted)]">{index + 1}.</span>
                                            <span><PrivacyBlur intensity="sm">{item}</PrivacyBlur></span>
                                        </li>
                                    ))}
                                </ol>
                            </details>
                        ) : null}

                        {draft.sources.length > 0 ? (
                            <details className="group rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)]">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                    Fonti usate dal prompt
                                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                                </summary>
                                <div className="space-y-2 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] px-4 py-3">
                                    {draft.sources.slice(0, 10).map((source) => (
                                        <div key={source.id} className="rounded-[12px] bg-[color:var(--lume-surface-focal)] p-3 text-xs">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`apple-chip border ${semanticSignalSurfaceClass('plum')}`}>{sourceKindLabel(source)}</span>
                                                <span className="break-all font-mono text-[10px] text-[color:var(--lume-ink-muted)]">{source.id}</span>
                                            </div>
                                            <p className="mt-1 font-semibold text-[color:var(--lume-ink)]">{source.label}</p>
                                            {source.excerpt ? (
                                                <p className="mt-1 leading-5 text-[color:var(--lume-ink-muted)]">
                                                    <PrivacyBlur intensity="sm">{source.excerpt}</PrivacyBlur>
                                                </p>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </details>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                            <span>Generato {formatDateTime(draft.generatedAt)}</span>
                            {draft.stats ? (
                                <span>
                                    {draft.stats.latency} ms
                                    {draft.stats.tokensIn || draft.stats.tokensOut ? ` · ${draft.stats.tokensIn}/${draft.stats.tokensOut} token` : ''}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
