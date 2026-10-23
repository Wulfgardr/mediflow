'use client';

import { Disclosure } from '@/components/disclosure';
import { formatCountLabel } from '@/lib/format-count';
import design from './treatment-reasoning.module.css';
import { ChoiceField } from '@/components/choice-field';
import { FunctionModelPicker, useFunctionModelPicker } from '@/components/function-models/function-model-picker';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil, RefreshCw } from 'lucide-react';
import { indexTreatmentReasoningSources } from './treatment-reasoning-sources';
import PrivacyBlur from '@/components/privacy-blur';
import {
    AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
    isAiTreatmentReasoningEnabledValue,
} from '@/lib/ai-treatment-reasoning-kill-switch';
import {
    createTreatmentReasoningBrowserController,
    type TreatmentReasoningPublication,
} from '@/lib/ai-providers/fabric/treatment-reasoning-browser-controller';
import {
    SmartImportContextProposalBrowserAdapterError,
    type SmartImportAmbulatoryChoice,
    type SmartImportContextProposal,
} from '@/lib/security/smart-import-patient-context-browser-adapter';
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
const PREVIEW_UNAVAILABLE_ERROR = 'Anteprima non disponibile. Verifica sessione, selezione e il motore scelto; nessun fallback automatico.';
const CONTEXT_UNAVAILABLE_ERROR = 'Impossibile leggere paziente e ambulatori. Controlla la sessione e riprova.';
const AMBULATORY_MISSING_ERROR = 'Aggiungi un ambulatorio nelle impostazioni, poi riprova.';

function severityClasses(severity: SafetySeverity): string {
    switch (severity) {
        case 'urgent_review': return design.critical;
        case 'caution': return design.warning;
        case 'info': return design.information;
        default: { const exhaustive: never = severity; return exhaustive; }
    }
}

function actionPolicyLabel(action: SuggestedAction): string {
    switch (action.writePolicy) {
        case 'form_prefill_only':
            return 'Solo preparazione, senza applicazione';
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
    const picker = useFunctionModelPicker('treatment_reasoning', `${patient.id}:${patient.version}`);
    const [controller] = useState(() => createTreatmentReasoningBrowserController({ fetch: picker.client.fetch }));
    const operation = useRef(0);
    // close same-render double activation before React can publish busy state.
    const handler = useRef(false);
    const contextRevision = `${patient.id}:${patient.version ?? 'unversioned'}`;
    const [publicationState, setPublicationState] = useState<ScopedValue<TreatmentReasoningPublication> | null>(null);
    const [runningRevision, setRunningRevision] = useState<string | null>(null);
    const [errorState, setErrorState] = useState<ScopedValue<string> | null>(null);
    const [proposal, setProposal] = useState<SmartImportContextProposal | null>(null);
    const [ambulatory, setAmbulatory] = useState<SmartImportAmbulatoryChoice | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [loadingProposal, setLoadingProposal] = useState(false);
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
    const publication = picker.active && publicationState?.contextRevision === contextRevision ? publicationState.value : null;
    const [sourcesOpen, setSourcesOpen] = useState(false);
    const sourceDetailsId = useId();
    const boundaryNoteId = useId();
    const confirmationNoteId = useId();
    const proposalSources = useMemo(() => indexTreatmentReasoningSources(publication ? [
        ...publication.sourceBindings.map(binding => binding.evidenceRefs),
        ...publication.value.data.keyEvidence.map(evidence => evidence.evidenceRefs),
        ...publication.value.data.safetyFlags.map(flag => flag.evidenceRefs),
        ...publication.value.data.suggestedActions.map(action => action.evidenceRefs),
    ] : []), [publication]);
    const sourceReferences = (references: readonly string[]) => references.length > 0 && <div className={design.sources}>
        {references.map(reference => <button key={reference} type="button" aria-controls={sourceDetailsId}
            aria-label={`${proposalSources.find(source => source.reference === reference)?.label ?? 'Riferimento'}: espandi le fonti della proposta`}
            onClick={() => { setSourcesOpen(true); }}>
            {proposalSources.find(source => source.reference === reference)?.label ?? 'Riferimento'}
        </button>)}
    </div>;
    const error = errorState?.contextRevision === contextRevision ? errorState.value : null;
    const isGenerating = runningRevision === contextRevision;
    const isBusy = loadingProposal || isGenerating;
    const sourceSummaryItems = [
        ['Terapie', sourceSummary.activeTherapies],
        ['Diagnosi', sourceSummary.diagnoses],
        ['Parametri', sourceSummary.observations],
        ['Diario', sourceSummary.clinicalEntries],
        ['Evidenze', sourceSummary.documentInsights + sourceSummary.attachmentEvidence],
    ];
    const canPrepare = treatmentReasoningEnabled && sourceSummary.total > 0 && !isBusy && !proposal && picker.canGenerate;

    useEffect(() => {
        operation.current += 1;
        controller.reset();
        handler.current = false;
        setPublicationState(null); setRunningRevision(null); setErrorState(null);
        setProposal(null); setAmbulatory(null); setConfirmed(false); setLoadingProposal(false);
        return () => {
            operation.current += 1;
            controller.reset();
        };
    }, [controller, patient.id, patient.version, picker.active, picker.view.choice, picker.view.blocked, treatmentReasoningEnabled]);

    if (sourceSummary.total === 0) {
        return null;
    }

    const loadProposal = async () => {
        if (!treatmentReasoningEnabled) {
            setErrorState({ contextRevision, value: LOCAL_DISABLED_ERROR });
            return;
        }
        if (handler.current) return;

        handler.current = true;
        const token = ++operation.current;
        setLoadingProposal(true);
        setErrorState(null);

        try {
            const nextProposal = await controller.readProposal(patient.id);
            if (operation.current === token) {
                setProposal(nextProposal); setAmbulatory(null); setConfirmed(false);
            }
        } catch (loadError) {
            if (operation.current === token) {
                const message = loadError instanceof SmartImportContextProposalBrowserAdapterError && loadError.code === 'context_missing'
                    ? AMBULATORY_MISSING_ERROR : CONTEXT_UNAVAILABLE_ERROR;
                setErrorState({ contextRevision, value: message });
            }
        } finally {
            if (operation.current === token) {
                handler.current = false;
                setLoadingProposal(false);
            }
        }
    };

    const generatePreview = async () => {
        if (!treatmentReasoningEnabled || !proposal || !ambulatory || !confirmed || isBusy || handler.current) return;
        handler.current = true;
        const token = ++operation.current; const currentProposal = proposal; const currentAmbulatory = ambulatory;
        setRunningRevision(contextRevision); setErrorState(null);
        try {
            const modelToken = await picker.client.begin();
            if (operation.current !== token || !picker.client.isCurrent(modelToken)) return;
            const nextPublication = await controller.run({
                patientId: patient.id,
                proposal: currentProposal,
                ambulatory: currentAmbulatory,
                contextInput: {
                    patient,
                    entries,
                    therapies,
                    observations,
                    attachments,
                },
            }, true);
            if (operation.current === token && picker.client.isCurrent(modelToken)) {
                setPublicationState({ contextRevision, value: nextPublication });
                setProposal(null); setAmbulatory(null); setConfirmed(false);
            }
        } catch {
            if (operation.current === token) {
                setErrorState({ contextRevision, value: PREVIEW_UNAVAILABLE_ERROR });
            }
        } finally {
            if (operation.current === token) {
                handler.current = false;
                setRunningRevision(null);
            }
        }
    };

    const cancelProposal = () => {
        operation.current += 1; handler.current = false; controller.reset(); setProposal(null); setAmbulatory(null); setConfirmed(false); setLoadingProposal(false);
    };

    return (
        <Disclosure title="Proposte" headingLevel={3}>
        <section className={design.panel} data-testid="treatment-reasoning-panel" aria-label="Ragionamento terapeutico">
            {!treatmentReasoningEnabled ? <div className={design.notice}>
                <p className={design.strong}>Ragionamento terapeutico spento</p>
                <Link href="/settings/ai/funzioni">Apri le funzioni cliniche</Link>
            </div> : <>
            <header className={design.header}>
                <h4>Ragionamento terapeutico</h4>
                <p className={design.meta}>Supporto alle terapie · solo revisione. Nessuna modifica alla cartella.</p>
            </header>

            <dl className={design.sourceCounts} aria-label="Fonti disponibili per la proposta">
                {sourceSummaryItems.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
            </dl>

            <div className={design.modelSelection}>
                <FunctionModelPicker picker={picker} />
            </div>

            {error && <div role="alert" className={design.error}>
                <span aria-hidden="true">✕</span><p>{error}</p>
            </div>}

            {proposal && !isGenerating ? (
                <div className={design.preparation}>
                    <h5>Conferma il contesto</h5>
                    <p><PrivacyBlur>Paziente: {proposal.patientName}</PrivacyBlur></p>
                    <ChoiceField label="Ambulatorio per questa proposta" value={ambulatory?.ambulatoryId ?? ''}
                            onChange={(event) => { setAmbulatory(proposal.ambulatories.find((row) => row.ambulatoryId === event.target.value) ?? null); setConfirmed(false); }}>
                            <option value="">Scegli l’ambulatorio</option>
                            {proposal.ambulatories.map((row) => <option key={row.ambulatoryId} value={row.ambulatoryId}>{row.name}{row.address ? ` · ${row.address}` : ''}</option>)}
                        </ChoiceField>
                    <label className={design.confirmation}>
                        <input type="checkbox" disabled={!ambulatory} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                        <span>Confermo paziente e ambulatorio per una proposta da rivedere. La cartella resta invariata.</span>
                    </label>
                    <div className={design.actionBar}>
                        <p id={confirmationNoteId} className={design.meta}>
                            {!ambulatory ? 'Scegli l’ambulatorio e conferma paziente e ambulatorio prima di generare.'
                                : !confirmed ? 'Conferma paziente e ambulatorio prima di generare.'
                                : !picker.canGenerate ? 'Verifica il modello e i prerequisiti indicati prima di generare.'
                                : 'Verranno usate solo le fonti del contesto confermato.'}
                        </p>
                        <div className={design.actions}>
                            <button type="button" className="mf-button-secondary" onClick={cancelProposal}>Annulla</button>
                            <button type="button" className="mf-button-secondary" aria-describedby={confirmationNoteId} disabled={!treatmentReasoningEnabled || !ambulatory || !confirmed || !picker.canGenerate || isBusy} onClick={generatePreview}>Conferma e genera proposta</button>
                        </div>
                    </div>
                </div>
            ) : !isGenerating && !picker.view.remote?.state && !picker.view.remote?.loading ? (
                <div className={design.actionBar}>
                    <p id={boundaryNoteId} className={design.meta}>
                        {!picker.canGenerate ? 'Verifica il modello e i prerequisiti indicati prima di preparare una proposta.'
                            : 'La preparazione richiede la conferma di paziente e ambulatorio. Non avvia una generazione automatica.'}
                    </p>
                    <button type="button" onClick={loadProposal} disabled={!canPrepare}
                        aria-describedby={boundaryNoteId} className="mf-button-secondary">
                        {loadingProposal ? 'Preparazione…' : publication ? 'Prepara una nuova proposta' : 'Prepara proposta'}
                    </button>
                </div>
            ) : null}
            {!publication && !isBusy && !proposal && <p className={design.meta}>
                Anteprima manuale per verificare coerenza, rischi e prossime azioni. Non modifica la scheda e richiede sempre revisione clinica.
            </p>}

            {isGenerating && <div role="status" aria-live="polite" className={design.loading}>
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                <p>Preparazione della proposta…</p>
            </div>}

            {publication && !isGenerating && <article className={design.proposal} data-testid="treatment-reasoning-proposal" data-ink-state="proposal">
                <header className={design.proposalHeader}>
                    <h5><Pencil size={14} aria-hidden="true" />Proposta</h5>
                    <p className={design.meta}>Da verificare sulle fonti · {formatDateTime(publication.capturedAt)}</p>
                    <p className={design.meta}>Supporto alla revisione: non è una prescrizione, esegue 0 scritture e non applica modifiche.</p>
                </header>
                <div className={design.recommendation}>
                    <p className={design.groupLabel}>Indicazione da valutare</p>
                    <p className={design.pencil}><PrivacyBlur intensity="sm">{publication.value.data.recommendation || publication.value.summary}</PrivacyBlur></p>
                    {sourceReferences((publication.sourceBindings.find(binding => binding.claimPath === 'data.recommendation')?.evidenceRefs ?? []))}
                    {publication.value.summary !== publication.value.data.recommendation && <>
                        <p className={design.pencil}><PrivacyBlur intensity="sm">{publication.value.summary}</PrivacyBlur></p>
                        {sourceReferences((publication.sourceBindings.find(binding => binding.claimPath === 'summary')?.evidenceRefs ?? []))}
                    </>}
                </div>

                {(publication.value.data.caveats.length > 0 || publication.value.data.safetyFlags.length > 0) && <section className={design.group}>
                    <h5>Cautele e informazioni mancanti</h5>
                    {publication.value.data.safetyFlags.map(flag => <div key={flag.id} className={`${design.signal} ${severityClasses(flag.severity)}`}>
                        <span aria-hidden="true">{flag.severity === 'urgent_review' ? '◆' : flag.severity === 'caution' ? '▲' : 'ℹ'}</span>
                        <div><p className={design.strong}>{flag.severity === 'urgent_review' ? 'Revisione urgente' : flag.severity === 'caution' ? 'Cautela' : 'Informazione'} · <PrivacyBlur intensity="sm">{flag.label}</PrivacyBlur></p>
                            <p><PrivacyBlur intensity="sm">{flag.rationale}</PrivacyBlur></p>
                            {sourceReferences(flag.evidenceRefs)}
                        </div>
                    </div>)}
                    {publication.value.data.caveats.map((caveat, index) => <div key={`${index}-${caveat}`} className={`${design.signal} ${design.warning}`}>
                        <span aria-hidden="true">▲</span><p><PrivacyBlur intensity="sm">{caveat}</PrivacyBlur></p>
                    </div>)}
                </section>}

                <div className={design.reviewColumns}>
                    <section className={design.group}>
                        <h5>Elementi a sostegno</h5>
                        {publication.value.data.keyEvidence.length === 0 ? <p className={design.meta}>Nessuna evidenza chiave strutturata.</p>
                            : publication.value.data.keyEvidence.map(evidence => <div key={evidence.id} className={design.proposalRow}>
                                <p className={design.pencil}><PrivacyBlur intensity="sm">{evidence.statement}</PrivacyBlur></p>
                                {sourceReferences(evidence.evidenceRefs)}
                            </div>)}
                    </section>
                    {publication.value.data.suggestedActions.length > 0 && <section className={design.group}>
                        <h5>Azioni da valutare</h5>
                        {publication.value.data.suggestedActions.map(action => <div key={action.id} className={design.proposalRow}>
                            <p className={design.strong}><PrivacyBlur intensity="sm">{action.label}</PrivacyBlur></p>
                            <p className={design.pencil}><PrivacyBlur intensity="sm">{action.rationale}</PrivacyBlur></p>
                            {sourceReferences(action.evidenceRefs)}
                            <p className={design.meta}>{actionPolicyLabel(action)}</p>
                        </div>)}
                    </section>}
                </div>

                {publication.value.data.reasoning.length > 0 && <Disclosure className={design.details} title="Come è stata formulata">
                    <ol>{publication.value.data.reasoning.map((item, index) => <li key={`${index}-${item}`} className={design.pencil}><PrivacyBlur intensity="sm">{item}</PrivacyBlur></li>)}</ol>
                </Disclosure>}
                <Disclosure className={design.details} open={sourcesOpen} onOpenChange={setSourcesOpen} contentId={sourceDetailsId} title="Fonti della proposta">
                    <dl className={design.sourceIndex}>{proposalSources.map(source => <div key={source.reference}>
                        <dt>{source.label}</dt><dd><code>{source.reference}</code></dd>
                    </div>)}</dl>
                    <div>{publication.sourceBindings.map(binding => <div key={binding.claimPath} className={design.proposalRow}>
                        <p className={design.meta}>Passaggio <code>{binding.claimPath}</code></p>
                        <p className={design.pencil}><PrivacyBlur intensity="sm">{binding.claim}</PrivacyBlur></p>
                        {sourceReferences(binding.evidenceRefs)}
                    </div>)}</div>
                </Disclosure>
                <Disclosure className={design.details} title="Origine e dettagli della generazione">
                    <p className={design.meta}>Receipt, provenienza e currentness</p>
                    <dl className={design.origin}>
                        <div><dt>Servizio utilizzato</dt><dd>{publication.attestation.provider === 'chatgpt_subscription' ? 'OpenAI · abbonamento ChatGPT · contesto redatto' : publication.attestation.provider === 'athena_mlx' ? 'ATHENA MLX · locale' : 'ATHENA Transformers · CPU locale'}</dd></div>
                        <div><dt>Stato verificato</dt><dd>{publication.attestation.provider === 'chatgpt_subscription' ? 'Consenso sui byte redatti · nessuna ammissione clinica implicita' : publication.attestation.readiness} · {publication.review} · {publication.writesPerformed} scritture</dd></div>
                        {publication.schemaVersion === 'mediflow.ai.treatment-reasoning-publication.v2' && <div><dt>Motore e artefatto attestati</dt><dd>{publication.attestation.model} · {publication.attestation.platform} · ammissione {publication.attestation.admissionRevision}<br />SHA-256 {publication.attestation.artifactDigest}</dd></div>}
                        <div><dt>Contesto acquisito</dt><dd>{formatDateTime(publication.capturedAt)}</dd></div>
                        <div><dt>Revisione delle fonti</dt><dd><code>{publication.sourceRevision}</code></dd></div>
                        <div><dt>Ricevuta di esecuzione</dt><dd>{publication.fabricReceipt.provider === 'chatgpt_subscription' ? <>OpenAI · {publication.fabricReceipt.model} · {publication.fabricReceipt.effort} · testo redatto inviato con consenso</> : <>{publication.fabricReceipt.venue} · {publication.fabricReceipt.egressProfile.id}@{publication.fabricReceipt.egressProfile.version} · egress {publication.fabricReceipt.egressProfile.egress}</>}</dd></div>
                        <div><dt>Preparazione delle fonti</dt><dd>{publication.provenance.preprocessing.join(' → ')}</dd></div>
                        <div><dt>Identificativo della ricevuta</dt><dd><code>{publication.attestation.provider === 'chatgpt_subscription' ? publication.attestation.outputSha256 : publication.attestation.receiptRef}</code></dd></div>
                        <div><dt>Identificativo della provenienza</dt><dd><code>{publication.attestation.provider === 'chatgpt_subscription' ? publication.attestation.sourceSha256 : publication.attestation.provenanceRef}</code></dd></div>
                    </dl>
                </Disclosure>
            </article>}
            </>}
        </section>
        </Disclosure>
    );
}
