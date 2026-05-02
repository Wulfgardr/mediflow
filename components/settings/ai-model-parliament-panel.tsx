'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

type ParliamentLaneState =
    | 'competitive'
    | 'hold'
    | 'benchmark_only'
    | 'integration_pending'
    | 'blocked';

type ParliamentScorecard = {
    summary?: {
        bestQualityModel?: string | null;
        bestQualityLabel?: string | null;
        bestQualityScore?: number | null;
        bestValueModel?: string | null;
        bestValueLabel?: string | null;
        bestValueScore?: number | null;
        bestValueChallengerModel?: string | null;
        bestValueChallengerLabel?: string | null;
        fastestModel?: string | null;
        fastestLabel?: string | null;
        fastestAvgLatencyMs?: number | null;
        competitiveLaneCount?: number;
        advisoryLaneCount?: number;
    };
    lanes?: Array<{
        lane: string;
        capability: string;
        tasks: string[];
        state: ParliamentLaneState;
        totalCandidates: number;
        runnableCandidates: number;
        benchmarkedCandidates: number;
        focusCandidateLabel?: string | null;
        focusCandidateModel?: string | null;
        bestValueModel?: string | null;
        blockers: string[];
        focusNote?: string | null;
    }>;
};

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
        scorecard?: ParliamentScorecard;
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
    const scorecard = state.payload?.report.scorecard;
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

                    {scorecard?.summary ? (
                        <div className="space-y-3">
                            <div>
                                <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Scorecard capability / economics</h4>
                                <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                                    Advisory only: aiuta a leggere valore, latenza e copertura delle lane senza cambiare baseline o pruning dalla UI.
                                </p>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <MetricCard
                                    label="Miglior qualità"
                                    value={scorecard.summary.bestQualityLabel || scorecard.summary.bestQualityModel || 'n/d'}
                                    meta={typeof scorecard.summary.bestQualityScore === 'number' ? `score ${scorecard.summary.bestQualityScore.toFixed(3)}` : null}
                                />
                                <MetricCard
                                    label="Miglior valore"
                                    value={scorecard.summary.bestValueLabel || scorecard.summary.bestValueModel || 'n/d'}
                                    meta={typeof scorecard.summary.bestValueScore === 'number' ? `score ${scorecard.summary.bestValueScore.toFixed(3)}` : null}
                                />
                                <MetricCard
                                    label="Challenger economico"
                                    value={scorecard.summary.bestValueChallengerLabel || scorecard.summary.bestValueChallengerModel || 'n/d'}
                                    meta={typeof scorecard.summary.fastestAvgLatencyMs === 'number' ? `fastest ${scorecard.summary.fastestAvgLatencyMs.toFixed(1)} ms` : null}
                                />
                                <MetricCard
                                    label="Lane"
                                    value={`${scorecard.summary.competitiveLaneCount || 0} competitive`}
                                    meta={`${scorecard.summary.advisoryLaneCount || 0} advisory`}
                                />
                            </div>
                        </div>
                    ) : null}

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

                    {scorecard?.lanes && scorecard.lanes.length > 0 ? (
                        <div className="rounded-[20px] border border-slate-200/70 bg-white/72 p-4 dark:border-white/10 dark:bg-white/5">
                            <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Lane capabilities</h4>
                            <div className="mt-3 space-y-3">
                                {scorecard.lanes.map((lane) => (
                                    <div
                                        key={lane.lane}
                                        className="rounded-[16px] border border-slate-200/70 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/5"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div>
                                                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                                    {laneLabel(lane.lane)}
                                                </p>
                                                <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                                                    {lane.capability}
                                                </p>
                                            </div>
                                            <span className={cn(
                                                'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]',
                                                laneStateClassName(lane.state),
                                            )}>
                                                {laneStateLabel(lane.state)}
                                            </span>
                                        </div>

                                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                                            <InlineMetric label="Focus" value={lane.focusCandidateLabel || lane.focusCandidateModel || 'n/d'} />
                                            <InlineMetric label="Runnable" value={`${lane.runnableCandidates}/${lane.totalCandidates}`} />
                                            <InlineMetric label="Benchmarked" value={`${lane.benchmarkedCandidates}/${lane.totalCandidates}`} />
                                        </div>

                                        {lane.focusNote ? (
                                            <p className="mt-3 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                                                {lane.focusNote}
                                            </p>
                                        ) : null}

                                        {lane.blockers.length > 0 ? (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {lane.blockers.map((blocker) => (
                                                    <span
                                                        key={`${lane.lane}-${blocker}`}
                                                        className="rounded-full border border-slate-200/70 bg-white/80 px-2.5 py-1 text-[10px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                                                    >
                                                        {blocker}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

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

function MetricCard({ label, value, meta }: { label: string; value: string; meta?: string | null }) {
    return (
        <div className="rounded-[18px] border border-slate-200/70 bg-white/72 px-3 py-3 dark:border-white/10 dark:bg-white/5">
            <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{label}</span>
            <span className="mt-2 block text-xs font-semibold text-slate-900 dark:text-white">{value}</span>
            {meta ? (
                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{meta}</span>
            ) : null}
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

function InlineMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[12px] border border-slate-200/70 bg-white/80 px-2.5 py-2 dark:border-white/10 dark:bg-white/5">
            <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">{label}</span>
            <span className="mt-1 block text-[11px] font-medium text-slate-700 dark:text-slate-200">{value}</span>
        </div>
    );
}

function laneLabel(lane: string) {
    switch (lane) {
        case 'generative':
            return 'Generative';
        case 'pii':
            return 'PII / Redaction';
        case 'clinical_entities':
            return 'Clinical entities';
        case 'embedding':
            return 'Embedding';
        default:
            return lane;
    }
}

function laneStateLabel(state: ParliamentLaneState) {
    switch (state) {
        case 'competitive':
            return 'competitive';
        case 'benchmark_only':
            return 'benchmark-only';
        case 'integration_pending':
            return 'integration';
        default:
            return state;
    }
}

function laneStateClassName(state: ParliamentLaneState) {
    switch (state) {
        case 'competitive':
            return 'border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200';
        case 'benchmark_only':
            return 'border-sky-200/70 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200';
        case 'integration_pending':
            return 'border-violet-200/70 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200';
        case 'blocked':
            return 'border-red-200/70 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200';
        default:
            return 'border-amber-200/70 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200';
    }
}
