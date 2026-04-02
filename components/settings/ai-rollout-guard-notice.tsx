'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    collectAiRolloutModelGuards,
    type AiRolloutGuardPayload,
    type AiRolloutGuardSelection,
} from '@/lib/ai-rollout-model-guard';

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
    if (guards.length === 0) return null;

    const tone = guards.some((guard) => guard.status === 'rollback-required') ? 'rollback' : 'hold';

    return (
        <div
            className={cn(
                'rounded-[22px] border p-4 shadow-[0_12px_26px_rgba(15,23,42,0.05)]',
                tone === 'rollback'
                    ? 'border-red-200/70 bg-red-50/75 dark:border-red-500/20 dark:bg-red-900/10'
                    : 'border-amber-200/70 bg-amber-50/75 dark:border-amber-500/20 dark:bg-amber-900/10',
            )}
            data-testid="ai-rollout-guard-notice"
        >
            <div className="flex items-start gap-3">
                <div className={cn(
                    'rounded-2xl p-2.5',
                    tone === 'rollback'
                        ? 'bg-red-100/90 text-red-700 dark:bg-red-500/15 dark:text-red-200'
                        : 'bg-amber-100/90 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
                )}>
                    {tone === 'rollback'
                        ? <AlertTriangle className="h-5 w-5" />
                        : <ShieldAlert className="h-5 w-5" />}
                </div>

                <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Guardrail rollout AI</h4>
                    <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                        Richiamo read-only basato sugli artifact `AI-08`: il salvataggio non viene bloccato, ma i modelli sotto riportati non risultano ancora `shadow-ready`.
                    </p>
                </div>
            </div>

            <div className="mt-4 space-y-3">
                {guards.map((guard) => (
                    <div
                        key={`${guard.model}-${guard.status}`}
                        className="rounded-[18px] border border-white/50 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5"
                        data-testid={`ai-rollout-guard-${guard.model.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`}
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">{guard.model}</span>
                            <span className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                                guard.status === 'rollback-required'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
                            )}>
                                {guard.status}
                            </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                            Ruoli interessati: <span className="font-medium text-slate-800 dark:text-slate-100">{guard.roles.join(', ')}</span>
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                            Lane rilevanti: <span className="font-medium text-slate-800 dark:text-slate-100">{guard.lanes.join(', ')}</span>
                        </p>
                        {guard.blockerMessages.length > 0 ? (
                            <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                                Segnali attivi: {guard.blockerMessages.slice(0, 2).join(' | ')}
                            </p>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
