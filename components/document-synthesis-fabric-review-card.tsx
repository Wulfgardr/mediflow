/* @Codex */
'use client';

import { useEffect, useRef, useState } from 'react';
import { FileSearch, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';

import PrivacyBlur from '@/components/privacy-blur';
import { cn } from '@/lib/utils';
import {
    createDocumentSynthesisBrowserOrchestrator,
    DocumentSynthesisBrowserOrchestratorError,
} from '@/lib/ai-providers/fabric/document-synthesis-browser-orchestrator';
import type { DocumentSynthesisPreviewWire } from '@/lib/ai-providers/fabric/document-synthesis-preview-wire';

type Phase = 'idle' | 'running' | 'terminal';
type DocumentSynthesisFabricReviewCardProps = Readonly<{ attachmentId: string; enabled: boolean }>;

function failureMessage(error: unknown): string {
    if (error instanceof DocumentSynthesisBrowserOrchestratorError) {
        return error.code === 'unsupported_local_extraction'
            ? 'review_required · unsupported_local_extraction — testo locale non disponibile; revisione manuale necessaria.'
            : `unavailable · ${error.code} — la proposta non è utilizzabile.`;
    }
    return 'unavailable · la proposta non è utilizzabile.';
}

function DocumentSynthesisFabricReviewCardSession({
    attachmentId,
    enabled,
}: DocumentSynthesisFabricReviewCardProps) {
    const [orchestrator] = useState(() => createDocumentSynthesisBrowserOrchestrator());
    const generation = useRef(0);
    const running = useRef(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [preview, setPreview] = useState<DocumentSynthesisPreviewWire | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        generation.current += 1;
        running.current = false;
        orchestrator.reset();
        setPreview(null);
        setError(null);
        setPhase('idle');
    };

    useEffect(() => () => {
        generation.current += 1;
        orchestrator.reset();
    }, [orchestrator]);

    const run = async () => {
        if (!enabled || running.current || phase !== 'idle') return;
        running.current = true;
        const token = ++generation.current;
        setError(null);
        setPhase('running');
        try {
            const result = await orchestrator.run(attachmentId);
            if (token !== generation.current) return;
            setPreview(result);
        } catch (runError) {
            if (token !== generation.current) return;
            setError(failureMessage(runError));
        } finally {
            if (token === generation.current) {
                running.current = false;
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
                        onClick={run}
                        disabled={!enabled}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition-colors',
                            enabled
                                ? 'border-[color:color-mix(in_srgb,var(--lume-accent)_28%,transparent)] text-[color:var(--lume-accent)] hover:bg-[color:color-mix(in_srgb,var(--lume-accent)_9%,var(--lume-surface-field))]'
                                : 'cursor-not-allowed border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] text-[color:var(--lume-ink-muted)] opacity-60',
                        )}
                    >
                        <FileSearch className="h-3.5 w-3.5" />
                        Genera proposta
                    </button>
                ) : phase === 'running' ? (
                    <span className="inline-flex items-center gap-1.5 text-[color:var(--lume-accent)]" role="status">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Generazione locale…
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={reset}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] px-2.5 py-1.5 font-medium text-[color:var(--lume-ink-muted)] hover:text-[color:var(--lume-ink)]"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset proposta
                    </button>
                )}
            </div>

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
    return <DocumentSynthesisFabricReviewCardSession key={props.attachmentId} {...props} />;
}
