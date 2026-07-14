'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, PauseCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type RolloutStatus = 'hold' | 'shadow-ready' | 'rollback-required';
type RolloutLane =
    | 'patient_insight'
    | 'smart_import'
    | 'redaction'
    | 'clinical_entities'
    | 'generative_challenger';
type RolloutLocalControlLane =
    | 'patient_insight'
    | 'smart_import'
    | 'document_synthesis'
    | 'treatment_reasoning'
    | 'ocr';

type RolloutArtifactPayload = {
    lanes: Array<{
        lane: RolloutLane;
        available: boolean;
        updatedAt: string | null;
        jsonPath: string | null;
        markdownPath: string | null;
        markdown: string | null;
        report: {
            status?: RolloutStatus;
            currentState?: string;
            selectedModel?: string | null;
            blockers?: Array<{ id?: string; message?: string; scope?: string }>;
            warnings?: Array<{ id?: string; message?: string }>;
            evidence?: {
                benchmarkFresh?: boolean;
                owner?: string | null;
                reportGeneratedAt?: string | null;
            };
        } | null;
    }>;
    localControls: Array<{
        lane: RolloutLocalControlLane;
        label: string;
        key: string;
        uiDriven: true;
        state: 'enabled' | 'disabled';
    }>;
};

const LANE_META: Record<RolloutLane, { label: string; description: string }> = {
    patient_insight: {
        label: 'Patient Insight',
        description: 'Controlla se Patient Insight puo restare in attesa, entrare in osservazione o richiedere blocco.',
    },
    smart_import: {
        label: 'Smart Import',
        description: 'Mostra se revisione e applicazione documentale sono pronte senza automatizzare il salvataggio.',
    },
    redaction: {
        label: 'Redaction',
        description: 'Riporta esito privacy-first e ostacoli che impediscono la modalita osservazione.',
    },
    clinical_entities: {
        label: 'Clinical Entities',
        description: 'Tiene visibile il controllo del riconoscimento entita cliniche e i motivi di promozione mancata.',
    },
    generative_challenger: {
        label: 'Generative Challenger',
        description: 'Rende leggibile il verdetto dei challenger generativi rispetto alla baseline protetta.',
    },
};

export default function AiRolloutReadinessPanel() {
    const [state, setState] = useState<{
        status: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
        payload: RolloutArtifactPayload | null;
        message: string;
    }>({
        status: 'idle',
        payload: null,
        message: '',
    });

    const loadArtifacts = async () => {
        setState((prev) => ({ ...prev, status: 'loading', message: '' }));
        try {
            const response = await fetch('/api/system/ai-rollout-readiness', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json() as RolloutArtifactPayload;
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
        void loadArtifacts();
    }, []);

    const lanes = state.payload?.lanes || [];
    const readyCount = lanes.filter((lane) => lane.report?.status === 'shadow-ready').length;
    const holdCount = lanes.filter((lane) => lane.report?.status === 'hold').length;
    const rollbackCount = lanes.filter((lane) => lane.report?.status === 'rollback-required').length;
    const missingCount = lanes.filter((lane) => !lane.available).length;
    const localControls = state.payload?.localControls || [];
    const localControlMap = new Map(localControls.map((control) => [control.lane, control]));
    const disabledControlsCount = localControls.filter((control) => control.state === 'disabled').length;

    return (
        <div className="mf-section space-y-4" data-testid="ai-rollout-readiness-panel">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-sky-100/90 p-2.5 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">
                        <ShieldAlert className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Stato rilascio AI locale</h3>
                        <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                            Mostra gli esiti salvati dal validator locale. Da qui non si promuovono modelli e non si avviano blocchi.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => void loadArtifacts()}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/72 px-3 py-2 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20 dark:hover:text-white"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Aggiorna
                </button>
            </div>

            {state.status === 'missing' ? (
                <div className="rounded-[20px] border border-dashed border-slate-200/80 bg-white/60 p-4 text-xs leading-6 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                    <p>{state.message}</p>
                    <p className="mt-2 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                        npm run validate:ai-rollout-readiness -- --lane patient_insight --report &lt;artifact.json&gt; --fallback-written --owner leonardo --license-clear
                    </p>
                </div>
            ) : null}

            {state.status === 'error' ? (
                <div className="rounded-[20px] border border-red-200/70 bg-red-50/80 p-4 text-xs leading-6 text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200">
                    <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" />
                        Report locali non disponibili
                    </div>
                    <p className="mt-2">{state.message}</p>
                </div>
            ) : null}

            {state.status === 'ready' ? (
                <div className="space-y-4">
                    {missingCount === lanes.length ? (
                        <div className="rounded-[20px] border border-dashed border-slate-200/80 bg-white/60 p-4 text-xs leading-6 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                            <p>Nessun esito locale disponibile al momento. La governance AI resta comunque osservabile: tutte le aree note sono elencate qui sotto come report mancanti.</p>
                            <p className="mt-2 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                                npm run validate:ai-rollout-readiness -- --lane patient_insight --report &lt;artifact.json&gt; --fallback-written --owner leonardo --license-clear
                            </p>
                        </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MetricCard label="Pronte in osservazione" value={String(readyCount)} tone="ready" />
                        <MetricCard label="In attesa" value={String(holdCount)} tone="hold" />
                        <MetricCard label="Blocco richiesto" value={String(rollbackCount)} tone="rollback" />
                        <MetricCard label="Report mancanti" value={String(missingCount)} tone="missing" />
                    </div>

                    <div className="rounded-[20px] border border-slate-200/70 bg-white/72 p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/5">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Controlli locali
                                </p>
                                <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                                    Stato in sola lettura degli interruttori locali per le funzioni già disponibili.
                                </p>
                            </div>
                            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300" data-testid="ai-rollout-local-control-summary">
                                {disabledControlsCount} disattivati su {localControls.length}
                            </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {localControls.map((control) => (
                                <div
                                    key={control.lane}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em]',
                                        control.state === 'enabled'
                                            ? 'border-emerald-200/70 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-200'
                                            : 'border-red-200/70 bg-red-50/80 text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200'
                                    )}
                                    data-testid={`ai-rollout-local-control-${control.lane}`}
                                >
                                    <span>{control.label}</span>
                                    <span>{control.state}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                        {lanes.map((entry) => (
                            <LaneCard
                                key={entry.lane}
                                entry={entry}
                                localControl={localControlMap.get(entry.lane as RolloutLocalControlLane)}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'ready' | 'hold' | 'rollback' | 'missing' }) {
    return (
        <div className={cn(
            'rounded-[18px] border px-3 py-3',
            tone === 'ready' && 'border-emerald-200/70 bg-emerald-50/75 dark:border-emerald-500/20 dark:bg-emerald-900/10',
            tone === 'hold' && 'border-amber-200/70 bg-amber-50/75 dark:border-amber-500/20 dark:bg-amber-900/10',
            tone === 'rollback' && 'border-red-200/70 bg-red-50/75 dark:border-red-500/20 dark:bg-red-900/10',
            tone === 'missing' && 'border-slate-200/70 bg-slate-50/75 dark:border-white/10 dark:bg-white/5',
        )} data-testid={`ai-rollout-metric-${tone}`}>
            <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{label}</span>
            <span className="mt-2 block text-xs font-semibold text-slate-900 dark:text-white">{value}</span>
        </div>
    );
}

function LaneCard({
    entry,
    localControl,
}: {
    entry: RolloutArtifactPayload['lanes'][number];
    localControl?: RolloutArtifactPayload['localControls'][number];
}) {
    const meta = LANE_META[entry.lane];
    const status = entry.report?.status || (entry.available ? 'hold' : 'missing');
    const blockers = entry.report?.blockers || [];
    const warnings = entry.report?.warnings || [];
    const Icon = status === 'shadow-ready'
        ? CheckCircle2
        : status === 'rollback-required'
            ? AlertTriangle
            : PauseCircle;

    return (
        <div
            className="rounded-[20px] border border-slate-200/70 bg-white/72 p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/5"
            data-testid={`ai-rollout-lane-${entry.lane}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="text-xs font-semibold text-slate-900 dark:text-white">{meta.label}</h4>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{meta.description}</p>
                </div>
                <div className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
                    status === 'shadow-ready' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
                    status === 'hold' && 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
                    status === 'rollback-required' && 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200',
                    status === 'missing' && 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200',
                )}>
                    <Icon className="h-3.5 w-3.5" />
                    {status}
                </div>
            </div>

            {localControl ? (
                <div className="mt-3">
                    <MiniMetric
                        label="Local control"
                        value={localControl.state}
                        tone={localControl.state === 'enabled' ? 'ready' : 'rollback'}
                    />
                </div>
            ) : null}

            {entry.available && entry.report ? (
                <>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <MiniMetric label="Current state" value={entry.report.currentState || 'n/d'} />
                        <MiniMetric label="Selected model" value={entry.report.selectedModel || 'n/d'} />
                        <MiniMetric label="Blocker" value={String(blockers.length)} />
                        <MiniMetric label="Warning" value={String(warnings.length)} />
                    </div>

                    <div className="mt-4 space-y-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                        <p>
                            Benchmark fresh:{' '}
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                                {entry.report.evidence?.benchmarkFresh ? 'yes' : 'no'}
                            </span>
                        </p>
                        <p>
                            Owner:{' '}
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                                {entry.report.evidence?.owner || 'n/d'}
                            </span>
                        </p>
                        <p>
                            Aggiornato:{' '}
                            <span className="font-mono text-slate-700 dark:text-slate-200">{entry.updatedAt || 'n/d'}</span>
                        </p>
                        <p>
                            JSON:{' '}
                            <span className="font-mono text-slate-700 dark:text-slate-200">{entry.jsonPath || 'n/d'}</span>
                        </p>
                        <p>
                            Markdown:{' '}
                            <span className="font-mono text-slate-700 dark:text-slate-200">{entry.markdownPath || 'n/d'}</span>
                        </p>
                    </div>

                    <DetailList
                        className="mt-4"
                        title="Blocker"
                        emptyLabel="Nessun blocker attivo."
                        tone="blocker"
                        items={blockers.map((blocker) => `${blocker.id || 'unknown'}: ${blocker.message || 'n/d'}`)}
                    />
                    <DetailList
                        className="mt-3"
                        title="Warning"
                        emptyLabel="Nessun warning."
                        tone="warning"
                        items={warnings.map((warning) => `${warning.id || 'unknown'}: ${warning.message || 'n/d'}`)}
                    />

                    {entry.markdown ? (
                        <details
                            className="mt-3 rounded-[18px] border border-slate-200/70 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/5"
                            data-testid={`ai-rollout-markdown-${entry.lane}`}
                        >
                            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                Preview markdown
                            </summary>
                            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                                {entry.markdown}
                            </pre>
                        </details>
                    ) : null}
                </>
            ) : (
                <div
                    className="mt-4 rounded-[18px] border border-dashed border-slate-200/80 bg-slate-50/70 p-4 text-[11px] leading-5 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                    data-testid={`ai-rollout-missing-${entry.lane}`}
                >
                    <p>Report locale mancante per questa area AI. Nessun esito salvato da mostrare.</p>
                    <p className="mt-2 font-mono text-[10px] text-slate-700 dark:text-slate-200">
                        npm run validate:ai-rollout-readiness -- --lane {entry.lane} --report &lt;artifact.json&gt; --fallback-written --owner leonardo --license-clear
                    </p>
                </div>
            )}
        </div>
    );
}

function MiniMetric({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: 'ready' | 'rollback';
}) {
    return (
        <div className={cn(
            'rounded-[16px] border px-3 py-3',
            tone === 'ready' && 'border-emerald-200/70 bg-emerald-50/75 dark:border-emerald-500/20 dark:bg-emerald-900/10',
            tone === 'rollback' && 'border-red-200/70 bg-red-50/75 dark:border-red-500/20 dark:bg-red-900/10',
            !tone && 'border-slate-200/70 bg-slate-50/80 dark:border-white/10 dark:bg-white/5',
        )}>
            <span className="block text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{label}</span>
            <span className="mt-1 block text-xs font-semibold text-slate-900 dark:text-white">{value}</span>
        </div>
    );
}

function DetailList({
    className,
    title,
    items,
    emptyLabel,
    tone,
}: {
    className?: string;
    title: string;
    items: string[];
    emptyLabel: string;
    tone: 'blocker' | 'warning';
}) {
    return (
        <div className={cn(
            'rounded-[18px] border p-3',
            tone === 'blocker'
                ? 'border-slate-200/70 bg-slate-50/80 dark:border-white/10 dark:bg-white/5'
                : 'border-amber-200/50 bg-amber-50/60 dark:border-amber-500/15 dark:bg-amber-900/5',
            className,
        )}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{title}</p>
            <div className="mt-2 space-y-1.5">
                {items.length > 0 ? items.map((item) => (
                    <p key={item} className="text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                        {item}
                    </p>
                )) : (
                    <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">{emptyLabel}</p>
                )}
            </div>
        </div>
    );
}
