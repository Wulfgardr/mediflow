'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

type ParliamentPayload = {
    updatedAt: string;
    jsonPath: string;
    markdownPath: string;
    report: {
        parliament?: {
            readiness?: 'hold' | 'prune_ready';
            baselineModel?: string | null;
            challengerModels?: string[];
            rationale?: string;
            protectedModels?: string[];
            recommendedPruneModels?: string[];
        };
    };
};

export default function AiModelParliamentPanel() {
    const [state, setState] = useState<{
        status: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
        payload: ParliamentPayload | null;
        message: string;
    }>({
        status: 'idle',
        payload: null,
        message: '',
    });

    const loadReport = async () => {
        setState((prev) => ({ ...prev, status: 'loading', message: '' }));
        try {
            const response = await fetch('/api/system/ai-parliament', { cache: 'no-store' });
            if (response.status === 404) {
                setState({
                    status: 'missing',
                    payload: null,
                    message: 'Nessun report del parlamento disponibile. Esegui il benchmark da CLI per popolare l’artifact locale.',
                });
                return;
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json() as ParliamentPayload;
            setState({
                status: 'ready',
                payload,
                message: '',
            });
        } catch (error) {
            setState({
                status: 'error',
                payload: null,
                message: error instanceof Error ? error.message : 'Errore imprevisto',
            });
        }
    };

    useEffect(() => {
        void loadReport();
    }, []);

    const parliament = state.payload?.report.parliament;
    const readiness = parliament?.readiness || 'hold';

    return (
        <div className="apple-subsection space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-amber-100/90 p-2.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                        <Scale className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Parlamento AI</h3>
                        <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                            Report read-only di baseline, challenger, modelli protetti e prune candidate. Nessun pruning parte dalla UI.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => void loadReport()}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/72 px-3 py-2 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20 dark:hover:text-white"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', state.status === 'loading' && 'animate-spin')} />
                    Aggiorna
                </button>
            </div>

            {state.status === 'missing' ? (
                <div className="rounded-[20px] border border-dashed border-slate-200/80 bg-white/60 p-4 text-xs leading-6 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                    <p>{state.message}</p>
                    <p className="mt-2 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                        npm run benchmark:model-parliament -- --out &lt;latest.json&gt; --markdown-out &lt;latest.md&gt;
                    </p>
                </div>
            ) : null}

            {state.status === 'error' ? (
                <div className="rounded-[20px] border border-red-200/70 bg-red-50/80 p-4 text-xs leading-6 text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200">
                    <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" />
                        Report non disponibile
                    </div>
                    <p className="mt-2">{state.message}</p>
                </div>
            ) : null}

            {state.status === 'ready' && parliament ? (
                <div className="space-y-4">
                    <div className={cn(
                        'rounded-[20px] border p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)]',
                        readiness === 'prune_ready'
                            ? 'border-emerald-200/70 bg-emerald-50/75 dark:border-emerald-500/20 dark:bg-emerald-900/10'
                            : 'border-amber-200/70 bg-amber-50/75 dark:border-amber-500/20 dark:bg-amber-900/10'
                    )}>
                        <div className="flex items-start gap-2">
                            {readiness === 'prune_ready' ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-200" />
                            ) : (
                                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-200" />
                            )}
                            <div>
                                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                    Stato parlamento: {readiness === 'prune_ready' ? 'prune-ready' : 'hold'}
                                </p>
                                <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                                    {parliament.rationale || 'Nessuna razionale disponibile.'}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MetricCard label="Baseline" value={parliament.baselineModel || 'n/d'} />
                        <MetricCard label="Challenger" value={(parliament.challengerModels || []).length > 0 ? (parliament.challengerModels || []).join(', ') : 'nessuno'} />
                        <MetricCard label="Protetti" value={String((parliament.protectedModels || []).length)} />
                        <MetricCard label="Prune candidate" value={String((parliament.recommendedPruneModels || []).length)} />
                    </div>

                    <ListCard
                        title="Modelli protetti"
                        emptyLabel="Nessun modello protetto."
                        values={parliament.protectedModels || []}
                    />
                    <ListCard
                        title="Prune candidate"
                        emptyLabel="Nessun prune candidate."
                        values={parliament.recommendedPruneModels || []}
                    />

                    <div className="rounded-[18px] border border-slate-200/70 bg-white/72 p-3 text-[11px] leading-5 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                        <p>Aggiornato: <span className="font-mono text-slate-700 dark:text-slate-200">{state.payload?.updatedAt || 'n/d'}</span></p>
                        <p className="mt-1">JSON: <span className="font-mono text-slate-700 dark:text-slate-200">{state.payload?.jsonPath || 'n/d'}</span></p>
                        <p className="mt-1">Markdown: <span className="font-mono text-slate-700 dark:text-slate-200">{state.payload?.markdownPath || 'n/d'}</span></p>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[18px] border border-slate-200/70 bg-white/72 px-3 py-3 dark:border-white/10 dark:bg-white/5">
            <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{label}</span>
            <span className="mt-2 block text-xs font-semibold text-slate-900 dark:text-white">{value}</span>
        </div>
    );
}

function ListCard({ title, values, emptyLabel }: { title: string; values: string[]; emptyLabel: string }) {
    return (
        <div className="rounded-[20px] border border-slate-200/70 bg-white/72 p-4 dark:border-white/10 dark:bg-white/5">
            <h4 className="text-xs font-semibold text-slate-900 dark:text-white">{title}</h4>
            <div className="mt-3 flex flex-wrap gap-2">
                {values.length > 0 ? values.map((value) => (
                    <span
                        key={value}
                        className="rounded-full border border-slate-200/70 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                    >
                        {value}
                    </span>
                )) : (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">{emptyLabel}</span>
                )}
            </div>
        </div>
    );
}
