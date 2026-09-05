'use client';

/* @Codex */
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { DocumentReferenceChip } from '@/components/document-reference-chip';
import PrivacyBlur from '@/components/privacy-blur';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import {
    AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
    isAiTreatmentReasoningEnabledValue,
} from '@/lib/ai-treatment-reasoning-kill-switch';
import {
    createTreatmentReasoningBrowserController,
    type TreatmentReasoningPublication,
} from '@/lib/ai-providers/fabric/treatment-reasoning-browser-controller';
import { db, type Attachment, type ClinicalEntry, type Observation, type Patient, type Therapy } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { countTreatmentReasoningSources } from '@/lib/treatment-reasoning-context';

interface TreatmentReasoningPanelProps {
    patient: Patient;
    entries?: ClinicalEntry[];
    therapies?: Therapy[];
    observations?: Observation[];
    attachments?: Attachment[];
}

type SafetySeverity = TreatmentReasoningPublication['value']['data']['safetyFlags'][number]['severity'];
type SuggestedAction = TreatmentReasoningPublication['value']['data']['suggestedActions'][number];
type ScopedValue<T> = Readonly<{ contextRevision: string; value: T }>;

const LOCAL_DISABLED_ERROR = 'Treatment Reasoning è disabilitato nel controllo locale. Riattivalo in Impostazioni AI per chiedere una nuova anteprima.';
const PREVIEW_UNAVAILABLE_ERROR = 'Anteprima non disponibile. Verifica sessione, selezione e disponibilità di ATHENA locale, poi riprova.';

function severityClasses(severity: SafetySeverity): string {
    switch (severity) {
        case 'urgent_review':
            return 'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]';
        case 'caution':
            return 'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]';
        case 'info':
            return 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink)]';
        default: {
            const exhaustive: never = severity;
            return exhaustive;
        }
    }
}

function actionPolicyLabel(action: SuggestedAction): string {
    switch (action.writePolicy) {
        case 'form_prefill_only':
            return 'prefill futuro';
        case 'no_write':
            return 'nessuna scrittura';
        case 'review_only':
            return 'solo revisione';
        default: {
            const exhaustive: never = action.writePolicy;
            return exhaustive;
        }
    }
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
    const [controller] = useState(() => createTreatmentReasoningBrowserController());
    const operation = useRef(0);
    const contextRevision = `${patient.id}:${patient.version ?? 'unversioned'}`;
    const [publicationState, setPublicationState] = useState<ScopedValue<TreatmentReasoningPublication> | null>(null);
    const [runningRevision, setRunningRevision] = useState<string | null>(null);
    const [errorState, setErrorState] = useState<ScopedValue<string> | null>(null);
    const treatmentReasoningKillSwitch = useLiveQuery(
        () => db.settings.get(AI_TREATMENT_REASONING_KILL_SWITCH_KEY),
        [],
        undefined,
        ['settings'],
    );
    const treatmentReasoningEnabled = isAiTreatmentReasoningEnabledValue(treatmentReasoningKillSwitch?.value);
    const sourceSummary = useMemo(
        () => countTreatmentReasoningSources({ patient, entries, therapies, observations, attachments }),
        [patient, entries, therapies, observations, attachments],
    );
    const publication = publicationState?.contextRevision === contextRevision ? publicationState.value : null;
    const error = errorState?.contextRevision === contextRevision ? errorState.value : null;
    const isGenerating = runningRevision === contextRevision;
    const sourceSummaryItems = [
        ['Terapie', sourceSummary.activeTherapies],
        ['Diagnosi', sourceSummary.diagnoses],
        ['Parametri', sourceSummary.observations],
        ['Diario', sourceSummary.clinicalEntries],
        ['Evidenze', sourceSummary.documentInsights + sourceSummary.attachmentEvidence],
    ];
    const canGenerate = treatmentReasoningEnabled && sourceSummary.total > 0 && !isGenerating;

    useEffect(() => {
        operation.current += 1;
        controller.reset();
        return () => {
            operation.current += 1;
            controller.reset();
        };
    }, [controller, patient.id, patient.version]);

    if (sourceSummary.total === 0) {
        return null;
    }

    const generatePreview = async () => {
        if (!treatmentReasoningEnabled) {
            setErrorState({ contextRevision, value: LOCAL_DISABLED_ERROR });
            return;
        }

        const token = ++operation.current;
        setRunningRevision(contextRevision);
        setErrorState(null);

        try {
            const proposal = await controller.readProposal();
            const nextPublication = await controller.run({
                patientId: patient.id,
                proposal,
                contextInput: {
                    patient,
                    entries,
                    therapies,
                    observations,
                    attachments,
                },
            }, true);
            if (operation.current === token) {
                setPublicationState({ contextRevision, value: nextPublication });
            }
        } catch {
            if (operation.current === token) {
                setErrorState({ contextRevision, value: PREVIEW_UNAVAILABLE_ERROR });
            }
        } finally {
            if (operation.current === token) {
                setRunningRevision(null);
            }
        }
    };

    return (
        <div className="patient-detail-section overflow-hidden border p-0" data-testid="treatment-reasoning-panel">
            <div className="border-b border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-[color:var(--lume-ink)] text-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)]">
                            <BrainCircuit className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Review terapie</p>
                            <h3 className="mt-1 text-lg font-semibold text-[color:var(--lume-ink)]">Ragionamento terapeutico</h3>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="apple-chip">{sourceSummary.total} fonti</span>
                                <span className="apple-chip">review-only</span>
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                    ATHENA MLX · locale
                                </span>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={generatePreview}
                        disabled={!canGenerate}
                        aria-describedby="treatment-reasoning-boundary-note"
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[12px] bg-[color:var(--lume-ink)] px-4 text-xs font-bold text-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)] transition-[background-color,opacity,transform] hover:bg-[color:var(--lume-accent)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                        {publication ? 'Aggiorna bozza' : 'Genera bozza'}
                    </button>
                    <p id="treatment-reasoning-boundary-note" className="sr-only">
                        Anteprima locale di sola revisione. Non scrive né applica modifiche alla scheda clinica.
                    </p>
                </div>
            </div>

            <div className="space-y-4 p-5">
                {!treatmentReasoningEnabled ? (
                    <div className="flex items-start gap-3 rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] p-4 text-sm text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <div>
                            <p className="font-semibold">Treatment Reasoning disabilitato</p>
                            <p className="mt-1 text-xs leading-5">Il controllo locale impedisce di avviare nuove anteprime da questo pannello. Il gate del server resta l’autorità finale su ogni richiesta.</p>
                            <Link href="/settings/ai/funzioni" className="mt-2 inline-block text-xs font-semibold underline underline-offset-4">
                                Apri Impostazioni AI
                            </Link>
                        </div>
                    </div>
                ) : null}

                {error ? (
                    <div role="alert" className="flex items-start gap-2 rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] p-3 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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

                {!publication && !isGenerating ? (
                    <div className="rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-4 text-sm leading-6 text-[color:var(--lume-ink-muted)] transition-colors duration-[var(--lume-dur-firma)]">
                        Anteprima manuale da ATHENA locale per verificare coerenza, rischi e prossime azioni. Non modifica la scheda e richiede sempre revisione clinica.
                    </div>
                ) : null}

                {isGenerating ? (
                    <div role="status" aria-live="polite" className="space-y-3 py-8 text-center">
                        <RefreshCw className="mx-auto h-7 w-7 animate-spin text-[color:var(--lume-ink-muted)]" aria-hidden="true" />
                        <p className="text-xs font-bold uppercase tracking-widest text-[color:var(--lume-ink-muted)]">Preparazione anteprima locale...</p>
                    </div>
                ) : null}

                {publication && !isGenerating ? (
                    <div className="space-y-5">
                        <div className="rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-4 text-[color:var(--lume-ink-muted)] transition-colors duration-[var(--lume-dur-firma)] ease-[var(--lume-ease)]">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-[color:var(--lume-ink-muted)]" aria-hidden="true" />
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Anteprima da rivedere</p>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                                <PrivacyBlur intensity="sm">{publication.value.data.recommendation || publication.value.summary}</PrivacyBlur>
                            </p>
                            {publication.value.summary !== publication.value.data.recommendation ? (
                                <p className="mt-2 text-xs leading-5 text-[color:var(--lume-ink-muted)]">
                                    <PrivacyBlur intensity="sm">{publication.value.summary}</PrivacyBlur>
                                </p>
                            ) : null}
                            <div className="mt-3 flex items-start gap-2 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] pt-3 text-xs leading-5 text-[color:var(--lume-ink-muted)]">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <p>Supporto locale alla revisione: non è una prescrizione, esegue 0 scritture e non applica modifiche.</p>
                            </div>
                        </div>

                        {publication.value.data.caveats.length > 0 ? (
                            <div className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] p-4 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em]">Dati mancanti e limiti</h4>
                                </div>
                                <ul className="mt-3 space-y-2 text-sm leading-5">
                                    {publication.value.data.caveats.map((caveat, index) => (
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
                                    <ClipboardList className="h-4 w-4 text-[color:var(--lume-ink-muted)]" aria-hidden="true" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Evidenze chiave</h4>
                                </div>
                                {publication.value.data.keyEvidence.length === 0 ? (
                                    <p className={`rounded-[14px] border p-3 text-xs ${semanticSignalSurfaceClass('critical')}`}>Nessuna evidenza chiave strutturata.</p>
                                ) : publication.value.data.keyEvidence.map((evidence) => (
                                    <div key={evidence.id} className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)] p-3">
                                        <p className="text-sm font-semibold leading-5 text-[color:var(--lume-ink)]"><PrivacyBlur intensity="sm">{evidence.statement}</PrivacyBlur></p>
                                        <DocumentReferenceChip references={[...evidence.evidenceRefs]} />
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-[color:var(--lume-ink-muted)]" aria-hidden="true" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Flag e cautele</h4>
                                </div>
                                {publication.value.data.safetyFlags.length === 0 ? (
                                    <p className="rounded-[14px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)] p-3 text-xs text-[color:var(--lume-ink-muted)]">Nessun flag strutturato da ATHENA.</p>
                                ) : publication.value.data.safetyFlags.map((flag) => (
                                    <div key={flag.id} className={`rounded-[16px] border p-3 ${severityClasses(flag.severity)}`}>
                                        <p className="text-sm font-semibold"><PrivacyBlur intensity="sm">{flag.label}</PrivacyBlur></p>
                                        <p className="mt-1 text-xs leading-5"><PrivacyBlur intensity="sm">{flag.rationale}</PrivacyBlur></p>
                                        <DocumentReferenceChip references={[...flag.evidenceRefs]} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {publication.value.data.suggestedActions.length > 0 ? (
                            <div className="space-y-3">
                                <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Azioni proposte</h4>
                                <div className="grid gap-3 md:grid-cols-2">
                                    {publication.value.data.suggestedActions.map((action) => (
                                        <div key={action.id} className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)] p-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-semibold text-[color:var(--lume-ink)]"><PrivacyBlur intensity="sm">{action.label}</PrivacyBlur></p>
                                                <span className="apple-chip">{actionPolicyLabel(action)}</span>
                                            </div>
                                            <p className="mt-2 text-xs leading-5 text-[color:var(--lume-ink-muted)]"><PrivacyBlur intensity="sm">{action.rationale}</PrivacyBlur></p>
                                            <DocumentReferenceChip references={[...action.evidenceRefs]} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {publication.value.data.reasoning.length > 0 ? (
                            <details className="group rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)]">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                    Traccia sintetica del ragionamento
                                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                                </summary>
                                <ol className="space-y-2 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] px-4 py-3 text-sm leading-5 text-[color:var(--lume-ink)]">
                                    {publication.value.data.reasoning.map((item, index) => (
                                        <li key={`${index}-${item}`} className="flex gap-2">
                                            <span className="font-semibold text-[color:var(--lume-ink-muted)]">{index + 1}.</span>
                                            <span><PrivacyBlur intensity="sm">{item}</PrivacyBlur></span>
                                        </li>
                                    ))}
                                </ol>
                            </details>
                        ) : null}

                        <details className="group rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)]">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                Fonti citate per claim
                                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <div className="space-y-2 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] px-4 py-3">
                                {publication.sourceBindings.map((binding) => (
                                    <div key={binding.claimPath} className="rounded-[12px] bg-[color:var(--lume-surface-focal)] p-3 text-xs">
                                        <span className="break-all font-mono text-[10px] text-[color:var(--lume-ink-muted)]">{binding.claimPath}</span>
                                        <p className="mt-1 font-semibold leading-5 text-[color:var(--lume-ink)]"><PrivacyBlur intensity="sm">{binding.claim}</PrivacyBlur></p>
                                        <DocumentReferenceChip references={[...binding.evidenceRefs]} />
                                    </div>
                                ))}
                            </div>
                        </details>

                        <details className="group rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)]">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                Receipt, provenienza e currentness
                                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <dl className="grid gap-3 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] px-4 py-3 text-xs sm:grid-cols-2">
                                <div>
                                    <dt className="font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Provider attestato</dt>
                                    <dd className="mt-1 text-[color:var(--lume-ink)]">{publication.attestation.provider === 'athena_mlx' ? 'ATHENA MLX · locale' : publication.attestation.provider}</dd>
                                </div>
                                <div>
                                    <dt className="font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Stato</dt>
                                    <dd className="mt-1 text-[color:var(--lume-ink)]">{publication.attestation.readiness} · {publication.review} · {publication.writesPerformed} scritture</dd>
                                </div>
                                <div>
                                    <dt className="font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Currentness</dt>
                                    <dd className="mt-1 text-[color:var(--lume-ink)]">Acquisita {formatDateTime(publication.capturedAt)}</dd>
                                </div>
                                <div>
                                    <dt className="font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Revisione sorgente</dt>
                                    <dd className="mt-1 break-all font-mono text-[10px] text-[color:var(--lume-ink)]">{publication.sourceRevision}</dd>
                                </div>
                                <div>
                                    <dt className="font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Receipt Fabric</dt>
                                    <dd className="mt-1 break-all text-[color:var(--lume-ink)]">{publication.fabricReceipt.venue} · {publication.fabricReceipt.egressProfile.id}@{publication.fabricReceipt.egressProfile.version} · egress {publication.fabricReceipt.egressProfile.egress}</dd>
                                </div>
                                <div>
                                    <dt className="font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Provenienza</dt>
                                    <dd className="mt-1 break-all text-[color:var(--lume-ink)]">{publication.provenance.preprocessing.join(' → ')}</dd>
                                </div>
                                <div>
                                    <dt className="font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Attestazione receipt</dt>
                                    <dd className="mt-1 break-all font-mono text-[10px] text-[color:var(--lume-ink)]">{publication.attestation.receiptRef}</dd>
                                </div>
                                <div>
                                    <dt className="font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Attestazione provenienza</dt>
                                    <dd className="mt-1 break-all font-mono text-[10px] text-[color:var(--lume-ink)]">{publication.attestation.provenanceRef}</dd>
                                </div>
                            </dl>
                        </details>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
