'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    collectAiRolloutLocalControlGuards,
    collectAiRolloutModelGuards,
    type AiRolloutGuardPayload,
    type AiRolloutGuardSelection,
} from '@/lib/ai-rollout-model-guard';

/* @Codex WUL-684: translate presentation values; do not change model/role matching. */
const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
    'Patient Insight': 'Quadro paziente', 'Smart Import': 'Importazione assistita',
    Redaction: 'Protezione dei dati identificativi',
    'Clinical Entities': 'Riconoscimento delle informazioni cliniche',
    'Generative Challenger': 'Confronto tra modelli alternativi',
};
const LOCAL_ACTIVITY_LABELS = {
    patient_insight: 'Quadro paziente', smart_import: 'Importazione assistita',
    document_synthesis: 'Sintesi dei documenti', treatment_reasoning: 'Revisione del trattamento',
} as const;
const DIAGNOSTIC_SUMMARY_CLASS = 'min-h-11 cursor-pointer content-center text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

export default function AiRolloutGuardNotice({
    selections,
}: {
    selections: AiRolloutGuardSelection[];
}) {
    const [payload, setPayload] = useState<AiRolloutGuardPayload | null>(null);
    const selectionKey = selections.map((selection) => selection.model.trim()).join('|');

    useEffect(() => {
        let cancelled = false;

        const loadPayload = async () => {
            try {
                const response = await fetch('/api/system/ai-rollout-readiness', { cache: 'no-store' });
                if (!response.ok) return;
                const nextPayload = await response.json() as AiRolloutGuardPayload;
                if (!cancelled) {
                    setPayload(nextPayload);
                }
            } catch {
                // Keep the consumer silent on read-only fetch failures.
            }
        };

        void loadPayload();
        return () => {
            cancelled = true;
        };
    }, [selectionKey]);

    const guards = collectAiRolloutModelGuards(payload, selections);
    const localControlGuards = collectAiRolloutLocalControlGuards(payload, selections);
    if (guards.length === 0 && localControlGuards.length === 0) return null;

    const tone = guards.some((guard) => guard.status === 'rollback-required') ? 'rollback' : 'hold';

    return (
        <div className={cn('min-w-0 border-l-2 p-4 [overflow-wrap:anywhere]',
            tone === 'rollback'
                ? 'border-red-300 bg-red-50/75 dark:border-red-500/40 dark:bg-red-900/10'
                : 'border-amber-300 bg-amber-50/75 dark:border-amber-500/40 dark:bg-amber-900/10',
        )} data-testid="ai-rollout-guard-notice" role="status">
            <div className="flex items-start gap-3">
                <div className={cn('shrink-0 pt-1', tone === 'rollback' ? 'text-red-700 dark:text-red-200' : 'text-amber-700 dark:text-amber-200')}>
                    {tone === 'rollback' ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : <ShieldAlert className="h-5 w-5" aria-hidden="true" />}
                </div>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Avvertenze sulle funzioni e sui modelli</h4>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        Puoi salvare le impostazioni, ma il salvataggio non supera i blocchi e non accende le funzioni spente. Controlla i motivi indicati prima di procedere.
                    </p>
                </div>
            </div>
            <div className="mt-4 space-y-4">
                {guards.map((guard) => (
                    <div key={`${guard.model}-${guard.status}`} className="min-w-0 border-t border-slate-300/70 pt-3 dark:border-white/15"
                        data-testid={`ai-rollout-guard-${guard.model.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`}>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{guard.model}</span>
                            <span className={cn('max-w-full rounded-full px-2 py-1 text-sm font-semibold',
                                guard.status === 'rollback-required' ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
                            )}>{guard.status === 'rollback-required' ? 'Blocco richiesto' : 'In attesa di verifica'}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            Attività interessate: <span className="font-medium text-slate-800 dark:text-slate-100">{guard.lanes.map((lane) => ACTIVITY_LABELS[lane] ?? lane).join(', ')}</span>
                        </p>
                        {guard.blockerMessages.length > 0 ? (
                            <div className="mt-2 space-y-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
                                <p className="font-semibold">Motivi che impediscono di procedere, come riportati dalla verifica:</p>
                                {guard.blockerMessages.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}
                            </div>
                        ) : null}
                        <details className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            <summary className={DIAGNOSTIC_SUMMARY_CLASS}>Dettagli per l’assistenza</summary>
                            <p>Configurazioni coinvolte: {guard.roles.join(', ')}.</p>
                            <p>Aree tecniche: {guard.lanes.join(', ')}. Esito: <code>{guard.status}</code>.</p>
                        </details>
                    </div>
                ))}
                {localControlGuards.map((guard) => (
                    <div key={`local-${guard.lane}`} className="min-w-0 border-t border-slate-300/70 pt-3 dark:border-white/15" data-testid={`ai-rollout-local-guard-${guard.lane}`}>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{LOCAL_ACTIVITY_LABELS[guard.lane]}</span>
                            <span className="max-w-full rounded-full bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-200">Spenta nelle impostazioni</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            La funzione è spenta per scelta nelle impostazioni. Scegliere o salvare un modello non la riattiva e non ne dimostra la disponibilità.
                        </p>
                        <details className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            <summary className={DIAGNOSTIC_SUMMARY_CLASS}>Dettagli per l’assistenza</summary>
                            <p>Funzione tecnica: {guard.label} (<code>{guard.lane}</code>). Stato: <code>{guard.state}</code>.</p>
                            <p>Configurazioni coinvolte: {guard.roles.join(', ')}.</p>
                        </details>
                    </div>
                ))}
            </div>
        </div>
    );
}
