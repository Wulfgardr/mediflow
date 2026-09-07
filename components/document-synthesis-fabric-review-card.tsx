/* @Codex */
'use client';

import { useEffect, useRef, useState } from 'react';
import { FileSearch, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';

import PrivacyBlur from '@/components/privacy-blur';
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
    const [controller] = useState(() => createDocumentSynthesisReviewBrowserController());
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
            const result = await controller.run({ patientId, attachmentId, proposal, ambulatory }, true);
            if (token !== generation.current) return;
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

    const publication = preview?.publication;
    const providerBindingReceipt = publication?.receipt.providerBindingReceipt;
    const modelCausality = publication?.provenance.modelCausality;

    return (
        <section
            className="mt-3 rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-accent)_22%,transparent)] bg-[color:var(--lume-surface-field)] p-3 text-xs"
            data-testid={`document-synthesis-fabric-review-${attachmentId}`}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="flex items-center gap-1.5 font-bold text-[color:var(--lume-ink)]">
                        <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--lume-accent)]" />
                        Sintesi Fabric · sola proposta
                    </p>
                    <p className="mt-1 text-[color:var(--lume-ink-muted)]">
                        Azione manuale, sorgente corrente dell&apos;host, nessuna persistenza clinica automatica.
                    </p>
                </div>
                {phase === 'idle' ? (
                    <button
                        type="button"
                        onClick={load}
                        disabled={!enabled}
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
                            {phase === 'loading' ? 'Caricamento contesto…' : 'Generazione locale…'}
                        </span>
                        <button type="button" className="ui-btn-secondary" data-lume-action="quiet" onClick={reset}>Annulla</button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={reset}
                        className="ui-btn-secondary"
                        data-lume-action="quiet"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset proposta
                    </button>
                )}
            </div>

            {phase === 'confirm' && proposal && (
                <div className="mt-4 grid gap-4 text-sm leading-relaxed">
                    <div className="grid min-w-0 gap-1 break-words">
                        <p><PrivacyBlur>Paziente: {proposal.patientName}</PrivacyBlur></p>
                        <p><PrivacyBlur>Documento: {attachmentName}</PrivacyBlur></p>
                    </div>
                    <label className="grid min-w-0 gap-2 font-medium">
                        Ambulatorio per questa proposta
                        <select className="min-h-[var(--lume-control-height)] w-full min-w-0 rounded-[var(--lume-control-radius)] border border-[color:var(--lume-ink-muted)] bg-[color:var(--lume-surface-focal)] px-3 py-2 text-[color:var(--lume-ink)]" value={ambulatory?.ambulatoryId ?? ''} onChange={(event) => {
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
                        <button type="button" className="ui-btn-primary" data-lume-action="primary" disabled={!enabled || !confirmed || !ambulatory} onClick={run}>Conferma e genera proposta</button>
                        <button type="button" className="ui-btn-secondary" data-lume-action="quiet" onClick={reset}>Annulla</button>
                    </div>
                </div>
            )}

            {!enabled && (
                <p className="mt-3 text-[color:var(--lume-ink-muted)]" role="status">
                    unavailable · la funzione di sintesi è disabilitata localmente.
                </p>
            )}

            {phase === 'terminal' && error && (
                <p
                    className="mt-3 rounded-xl border border-[color:color-mix(in_srgb,var(--lume-signal-warning)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_9%,var(--lume-surface-field))] p-2 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_65%,var(--lume-ink))]"
                    role="status"
                >
                    {error}
                </p>
            )}

            {phase === 'terminal' && publication && providerBindingReceipt && (
                <div className="mt-3 space-y-3" data-testid="document-synthesis-fabric-result">
                    <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--lume-signal-success)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_8%,var(--lume-surface-field))] p-2">
                        <p className="font-bold text-[color:color-mix(in_srgb,var(--lume-signal-success)_65%,var(--lume-ink))]">
                            0 scritture · applicazione non consentita
                        </p>
                        <p className="mt-2 leading-5 text-[color:var(--lume-ink)]">
                            <PrivacyBlur intensity="sm">{publication.output.summary}</PrivacyBlur>
                        </p>
                        <p className="mt-1 text-[color:var(--lume-ink-muted)]">Qualità dichiarata: {publication.output.qualityLevel}</p>
                    </div>

                    <div>
                        <p className="font-bold text-[color:var(--lume-ink)]">Receipt</p>
                        <dl className="mt-1 grid gap-x-3 gap-y-1 text-[color:var(--lume-ink-muted)] sm:grid-cols-[auto_1fr]">
                            <dt>Binding</dt><dd>{providerBindingReceipt.provider} · {providerBindingReceipt.model}</dd>
                            <dt>Esecuzione</dt><dd>{providerBindingReceipt.venue} · egress {providerBindingReceipt.egress} · fallback {providerBindingReceipt.fallback}</dd>
                            <dt>Output</dt><dd className="break-all font-mono text-[10px]">{publication.receipt.outputSha256}</dd>
                        </dl>
                    </div>

                    <div>
                        <p className="font-bold text-[color:var(--lume-ink)]">Provenienza</p>
                        <p className="mt-1 text-[color:var(--lume-ink-muted)]">
                            Autorità: {publication.provenance.sourceSetAuthority} · supporto: {publication.provenance.citationSupport} · causalità modello: {modelCausality}
                        </p>
                    </div>

                    <div>
                        <p className="font-bold text-[color:var(--lume-ink)]">Citazioni</p>
                        <ol className="mt-1 space-y-1.5">
                            {publication.citations.map((citation) => (
                                <li
                                    key={`${citation.label}-${citation.quoteSha256}`}
                                    className="rounded-lg border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] p-2 text-[color:var(--lume-ink-muted)]"
                                >
                                    <span className="font-mono font-bold text-[color:var(--lume-ink)]">{citation.label}</span>
                                    {' · '}
                                    <PrivacyBlur intensity="sm">{citation.quote}</PrivacyBlur>
                                </li>
                            ))}
                        </ol>
                    </div>
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
