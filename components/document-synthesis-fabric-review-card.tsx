/* @Codex */
'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { FileSearch, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';

import { FunctionModelPicker, useFunctionModelPicker } from '@/components/function-models/function-model-picker';
import PrivacyBlur from '@/components/privacy-blur';
import disclosure from '@/components/patient-disclosure.module.css';
import {
    DocumentSynthesisBrowserOrchestratorError,
} from '@/lib/ai-providers/fabric/document-synthesis-browser-orchestrator';
import { useSecurity } from '@/components/security-provider';
import { createDocumentSynthesisReviewBrowserController, DocumentSynthesisReviewBrowserControllerError, type DocumentSynthesisContextProposal, type DocumentSynthesisAmbulatoryChoice } from '@/lib/ai-providers/fabric/document-synthesis-review-browser-controller';
import { SmartImportSelectionBrowserAdapterError } from '@/lib/security/smart-import-selection-browser-adapter';
import type { DocumentSynthesisPreviewWire } from '@/lib/ai-providers/fabric/document-synthesis-preview-wire';

type Phase = 'idle' | 'loading' | 'confirm' | 'running' | 'terminal';
type DocumentSynthesisFabricReviewCardProps = Readonly<{ patientId: string; attachmentId: string; attachmentName: string; enabled: boolean }>;

function failureMessage(error: unknown): string {
    if (error instanceof DocumentSynthesisBrowserOrchestratorError
        || error instanceof DocumentSynthesisReviewBrowserControllerError
        || error instanceof SmartImportSelectionBrowserAdapterError) {
        return error.code === 'unsupported_local_extraction'
            ? 'review_required · unsupported_local_extraction — testo locale non disponibile; revisione manuale necessaria.'
            : `unavailable · ${error.code} — la proposta non è utilizzabile.`;
    }
    return 'unavailable · la proposta non è utilizzabile.';
}

function DocumentSynthesisFabricReviewCardSession({
    patientId,
    attachmentId,
    attachmentName,
    enabled,
}: DocumentSynthesisFabricReviewCardProps) {
    const picker = useFunctionModelPicker('document_synthesis', patientId, attachmentId, enabled);
    const [controller] = useState(() => createDocumentSynthesisReviewBrowserController({ fetch: picker.client.fetch }));
    const [proposal, setProposal] = useState<DocumentSynthesisContextProposal | null>(null);
    const [ambulatory, setAmbulatory] = useState<DocumentSynthesisAmbulatoryChoice | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const generation = useRef(0);
    const running = useRef(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [preview, setPreview] = useState<DocumentSynthesisPreviewWire | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        generation.current += 1;
        running.current = false;
        controller.reset();
        setAmbulatory(null);
        setProposal(null);
        setConfirmed(false);
        setPreview(null);
        setError(null);
        setPhase('idle');
    };

    useEffect(() => () => {
        generation.current += 1;
        controller.reset();
    }, [controller]);

    const resetFromContext = useEffectEvent(reset);
    const resetFromChoice = useEffectEvent(() => { if (phase === 'running') reset(); else { setPreview(null); setConfirmed(false); } });
    useEffect(() => { resetFromContext(); }, [picker.active, picker.view.blocked]);
    useEffect(() => { resetFromChoice(); }, [picker.view.choice]);

    const load = async () => {
        if (!enabled || running.current || phase !== 'idle') return;
        running.current = true; const token = ++generation.current;
        setPhase('loading'); setError(null);
        try {
            const value = await controller.readProposal(patientId);
            if (token !== generation.current) return;
            setProposal(value); setPhase('confirm');
        } catch (loadError) {
            if (token !== generation.current) return;
            setError(failureMessage(loadError)); setPhase('terminal');
        } finally { if (token === generation.current) running.current = false; }
    };

    const run = async () => {
        if (!enabled || running.current || phase !== 'confirm' || !confirmed || !proposal || !ambulatory) return;
        running.current = true;
        const token = ++generation.current;
        setError(null);
        setPhase('running');
        try {
            const modelToken = await picker.client.begin();
            const result = await controller.run({ patientId, attachmentId, proposal, ambulatory }, true);
            if (token !== generation.current) return;
            if (!picker.client.isCurrent(modelToken)) return;
            setPreview(result);
        } catch (runError) {
            if (token !== generation.current) return;
            setError(failureMessage(runError));
        } finally {
            if (token === generation.current) {
                running.current = false;
                setProposal(null); setAmbulatory(null); setConfirmed(false);
                setPhase('terminal');
            }
        }
    };

    const cancelPreview = () => { picker.client.reset(picker.active); reset(); };
    const publication = picker.active ? preview?.publication : undefined;
    const providerBindingReceipt = publication?.receipt.providerBindingReceipt;
    const modelCausality = publication?.provenance.modelCausality;

    return (
        <section
            className={disclosure.synthesis}
            data-testid={`document-synthesis-fabric-review-${attachmentId}`}
            aria-busy={phase === 'loading' || phase === 'running'}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h4 className="flex items-center gap-2 font-semibold text-[color:var(--lume-ink)]">
                        <ShieldCheck className="h-4 w-4 text-[color:var(--lume-accent)]" aria-hidden="true" />
                        Sintesi da rivedere
                    </h4>
                    <p className="mt-1 text-[color:var(--lume-ink-muted)]">
                        Un riepilogo da confrontare con il documento. La cartella rimane invariata.
                    </p>
                </div>
                {phase === 'idle' ? (
                    <button
                        type="button"
                        onClick={load}
                        disabled={!enabled || !picker.active}
                        className="ui-btn-primary"
                        data-lume-action="primary"
                    >
                        <FileSearch className="h-3.5 w-3.5" />
                        Genera proposta
                    </button>
                ) : phase === 'confirm' ? null : phase === 'running' || phase === 'loading' ? (
                    <>
                        <span className="inline-flex items-center gap-1.5 text-[color:var(--lume-accent)]" role="status">
                            <Loader2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {phase === 'loading' ? 'Caricamento contesto…' : picker.view.remote ? 'Preparazione / proposta OpenAI…' : 'Generazione locale…'}
                        </span>
                        <button type="button" className="ui-btn-secondary" data-lume-action="quiet" onClick={cancelPreview}>Annulla</button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={cancelPreview}
                        className="ui-btn-secondary"
                        data-lume-action="quiet"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {error ? 'Prepara un nuovo tentativo' : 'Chiudi proposta'}
                    </button>
                )}
            </div>

            {/* The result reports the executed model, not a new selectable configuration. */}
            {phase !== 'terminal' && <FunctionModelPicker picker={picker} />}
            {phase === 'confirm' && proposal && (
                <div className="mt-4 grid gap-4 text-sm leading-relaxed">
                    <div className="grid min-w-0 gap-1 break-words">
                        <p><PrivacyBlur>Paziente: {proposal.patientName}</PrivacyBlur></p>
                        <p><PrivacyBlur>Documento: {attachmentName}</PrivacyBlur></p>
                    </div>
                    <label className="grid min-w-0 gap-2 font-medium">
                        Ambulatorio per questa proposta
                        <select className="min-h-[var(--lume-control-height)] w-full min-w-0 rounded-[var(--lume-control-radius)] border border-[color:var(--lume-ink-muted)] bg-[color:var(--lume-surface-focal)] px-3 py-2 text-[color:var(--lume-ink)]" value={ambulatory?.ambulatoryId ?? ''} onChange={(event) => {
                            picker.client.reset(picker.active);
                            setAmbulatory(proposal.ambulatories.find((choice) => choice.ambulatoryId === event.target.value) ?? null);
                            setConfirmed(false);
                        }}>
                            <option value="">Scegli l’ambulatorio</option>
                            {proposal.ambulatories.map((choice) => (
                                <option key={choice.ambulatoryId} value={choice.ambulatoryId}>
                                    {choice.name}{choice.address ? ` · ${choice.address}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>
                    <p className="text-[color:var(--lume-ink-muted)]">Scegli l’ambulatorio in cui segui questo paziente. L’applicazione verificherà l’associazione prima di procedere.</p>
                    <label className="flex min-h-[var(--lume-control-height)] items-start gap-3">
                        <input className="mt-1 h-4 w-4 shrink-0 accent-[var(--lume-accent)]" type="checkbox" disabled={!ambulatory} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                        <span>Confermo paziente, documento e ambulatorio per una proposta in sola lettura, senza scritture cliniche.</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                        <button type="button" className="ui-btn-primary" data-lume-action="primary" disabled={!enabled || !confirmed || !ambulatory || !picker.canGenerate} onClick={run}>Conferma e genera proposta</button>
                        <button type="button" className="ui-btn-secondary" data-lume-action="quiet" onClick={cancelPreview}>Annulla</button>
                    </div>
                </div>
            )}

            {!enabled && (
                <p className="mt-3 text-[color:var(--lume-ink-muted)]" role="status">
                    La funzione di sintesi è disabilitata localmente.
                </p>
            )}

            {phase === 'terminal' && error && (
                <div className="mt-3">
                    <p role="status" className="text-[color:var(--lume-ink)]">
                        {error.startsWith('review_required · unsupported_local_extraction')
                            ? 'Testo locale non disponibile. È necessaria la revisione manuale del documento.'
                            : 'Sintesi non disponibile. La cartella rimane invariata.'}
                    </p>
                    <details className={disclosure.disclosure}>
                        <summary>Dettagli dell’esito</summary>
                        <p>{error}</p>
                    </details>
                </div>
            )}

            {phase === 'terminal' && publication && providerBindingReceipt && (
                <div className="mt-4 grid min-w-0 gap-4" data-testid="document-synthesis-fabric-result">
                    {/* @Codex: summary, sources and receipt share the document reading plane. */}
                    <div className={disclosure.synthesisSection}>
                        <p className="font-semibold text-[color:var(--lume-ink)]">Riepilogo da rivedere</p>
                        <p className="mt-2 break-words text-[color:var(--lume-ink)]">
                            <PrivacyBlur intensity="sm">{publication.output.summary}</PrivacyBlur>
                        </p>
                        <p className="mt-3 text-[color:var(--lume-ink-muted)]">Questa proposta non aggiunge né modifica informazioni nella cartella.</p>
                    </div>

                    <div className={disclosure.synthesisSection}>
                        <p className="font-semibold text-[color:var(--lume-ink)]">{providerBindingReceipt.provider === 'chatgpt_subscription' ? 'Elaborato con OpenAI' : 'Elaborato sul computer'}</p>
                        <dl className="mt-2 grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
                            <dt className="text-[color:var(--lume-ink-muted)]">Servizio</dt><dd className="text-[color:var(--lume-ink)]">{providerBindingReceipt.provider === 'chatgpt_subscription' ? 'OpenAI · abbonamento ChatGPT · contesto redatto' : 'Ollama · locale'}</dd>
                            <dt className="text-[color:var(--lume-ink-muted)]">Modello usato</dt><dd className="break-words text-[color:var(--lume-ink)]">{providerBindingReceipt.model}</dd>
                        </dl>
                        <p className="mt-3 text-[color:var(--lume-ink-muted)]">{providerBindingReceipt.provider === 'chatgpt_subscription' ? 'Contenuto redatto inviato con consenso esplicito. Condizioni e conservazione del servizio ChatGPT applicabili. Nessun fallback.' : 'Nessun invio a provider esterni e nessun passaggio a un altro modello.'}</p>
                    </div>

                    <details className={disclosure.disclosure}>
                        <summary>Citazioni dal documento <span className={disclosure.count}>{publication.citations.length}</span></summary>
                        <p className="mt-1 text-[color:var(--lume-ink-muted)]">I passaggi citati sono stati riscontrati nel testo estratto. Confrontali con il riepilogo.</p>
                        <ol className="mt-3 grid gap-3">
                            {publication.citations.map((citation) => (
                                <li
                                    key={`${citation.label}-${citation.quoteSha256}`}
                                    className={`${disclosure.citation} text-[color:var(--lume-ink)]`}
                                >
                                    <p className="font-semibold">{citation.label} · <PrivacyBlur intensity="sm">{attachmentName}</PrivacyBlur></p>
                                    <blockquote className="mt-2 whitespace-pre-wrap break-words"><PrivacyBlur intensity="sm">{citation.quote}</PrivacyBlur></blockquote>
                                </li>
                            ))}
                        </ol>
                    </details>

                    <details className={disclosure.disclosure}>
                        <summary>Dettagli di verifica</summary>
                        <div className="grid min-w-0 gap-3 pb-4 text-sm leading-relaxed text-[color:var(--lume-ink-muted)]">
                            <p>0 scritture · applicazione non consentita</p>
                            <p>Qualità dichiarata dal modello: {publication.output.qualityLevel}. È una sua valutazione, non una verifica clinica indipendente.</p>
                            <p>Le citazioni documentano i riferimenti restituiti; non ricostruiscono il ragionamento interno del modello.</p>
                            <dl className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
                                <dt>Binding</dt><dd className="break-words">{providerBindingReceipt.provider} · {providerBindingReceipt.model}</dd>
                                <dt>Esecuzione</dt><dd className="break-words">{providerBindingReceipt.venue} · egress {providerBindingReceipt.egress} · fallback {providerBindingReceipt.fallback}</dd>
                                <dt>Output SHA-256</dt><dd className="break-all font-mono">{publication.receipt.outputSha256}</dd>
                                <dt>Provenienza</dt><dd className="break-all">{publication.provenance.sourceSetAuthority} · {publication.provenance.citationSupport}</dd>
                                <dt>Causalità del modello</dt><dd>{modelCausality}</dd>
                            </dl>
                        </div>
                    </details>
                </div>
            )}
        </section>
    );
}

export default function DocumentSynthesisFabricReviewCard(props: DocumentSynthesisFabricReviewCardProps) {
    const { isLocked } = useSecurity();
    if (isLocked) return null;
    return <DocumentSynthesisFabricReviewCardSession key={JSON.stringify([props.patientId, props.attachmentId, props.attachmentName, props.enabled])} {...props} />;
}
