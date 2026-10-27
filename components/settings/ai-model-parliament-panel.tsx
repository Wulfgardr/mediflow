'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Scale } from 'lucide-react';
import { Disclosure } from '@/components/disclosure';
import { cn } from '@/lib/utils';
import styles from './ai-utilities.module.css';

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
                    message: 'Nessun report disponibile: genera il benchmark con il comando indicato sotto.',
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
        <div className={styles.panel}>
            <div className={styles.heading}>
                <div className={styles.headingBody}>
                    <Scale className={styles.icon} aria-hidden="true" />
                    <div>
                        <h3 className={styles.title}>Confronto modelli AI</h3>
                        <p className={styles.prose}>
                            Report in sola lettura su modello base, alternative, modelli protetti e candidati da rimuovere.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => void loadReport()}
                    className={styles.button}
                >
                    <RefreshCw className={styles.icon} />
                    Aggiorna
                </button>
            </div>

            {state.status === 'idle' || state.status === 'loading' ? (
                <p role="status" className={styles.muted}>Lettura del report salvato…</p>
            ) : null}

            {state.status === 'missing' ? (
                <div className={styles.row}>
                    <p>{state.message}</p>
                    <p className={styles.code}>
                        npm run benchmark:model-parliament -- --out &lt;latest.json&gt; --markdown-out &lt;latest.md&gt;
                    </p>
                </div>
            ) : null}

            {state.status === 'error' ? (
                <div role="alert" className={cn(styles.notice, styles.critical)}>
                    <div className={styles.title}>
                        <AlertTriangle className={styles.icon} />
                        Report non disponibile
                    </div>
                    <p className={styles.spaced}>Impossibile leggere il report salvato. Usa «Aggiorna» per riprovare.</p>
                    <Disclosure title="Dettagli dell’errore per l’assistenza" className={styles.spaced}>
                        <p>{state.message}</p>
                    </Disclosure>
                </div>
            ) : null}

            {state.status === 'ready' && parliament ? (
                <div className={styles.sections}>
                    <div className={cn(
                        styles.notice,
                        readiness === 'prune_ready'
                            ? styles.positive
                            : styles.warning
                    )}>
                        <div className={styles.headingBody}>
                            {readiness === 'prune_ready' ? (
                                <CheckCircle2 className={styles.icon} />
                            ) : (
                                <AlertTriangle className={styles.icon} />
                            )}
                            <div>
                                <p className={styles.title}>
                                    Stato confronto: {readiness === 'prune_ready' ? 'pronto per revisione' : 'in attesa'}
                                </p>
                                <p className={styles.prose}>
                                    {parliament.rationale || 'Nessuna razionale disponibile.'}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className={styles.rows}>
                        <MetricRow label="Baseline" value={parliament.baselineModel || 'n/d'} />
                        <MetricRow label="Challenger" value={(parliament.challengerModels || []).length > 0 ? (parliament.challengerModels || []).join(', ') : 'nessuno'} />
                        <MetricRow label="Protetti" value={String((parliament.protectedModels || []).length)} />
                        <MetricRow label="Candidati da rimuovere" value={String((parliament.recommendedPruneModels || []).length)} />
                    </div>

                    {scorecard?.summary ? (
                        <div className={styles.section}>
                            <div>
                                <h4 className={styles.title}>Qualità, costo e copertura</h4>
                            </div>

                            <div className={styles.rows}>
                                <MetricRow
                                    label="Miglior qualità"
                                    value={scorecard.summary.bestQualityLabel || scorecard.summary.bestQualityModel || 'n/d'}
                                    meta={typeof scorecard.summary.bestQualityScore === 'number' ? `score ${scorecard.summary.bestQualityScore.toFixed(3)}` : null}
                                />
                                <MetricRow
                                    label="Miglior valore"
                                    value={scorecard.summary.bestValueLabel || scorecard.summary.bestValueModel || 'n/d'}
                                    meta={typeof scorecard.summary.bestValueScore === 'number' ? `score ${scorecard.summary.bestValueScore.toFixed(3)}` : null}
                                />
                                <MetricRow
                                    label="Challenger economico"
                                    value={scorecard.summary.bestValueChallengerLabel || scorecard.summary.bestValueChallengerModel || 'n/d'}
                                    meta={typeof scorecard.summary.fastestAvgLatencyMs === 'number' ? `fastest ${scorecard.summary.fastestAvgLatencyMs.toFixed(1)} ms` : null}
                                />
                                <MetricRow
                                    label="Aree AI"
                                    value={`${scorecard.summary.competitiveLaneCount || 0} competitive`}
                                    meta={`${scorecard.summary.advisoryLaneCount || 0} consultive`}
                                />
                            </div>
                        </div>
                    ) : null}

                    <ModelList
                        title="Modelli protetti"
                        emptyLabel="Nessun modello protetto."
                        values={parliament.protectedModels || []}
                    />
                    <ModelList
                        title="Candidati da rimuovere"
                        emptyLabel="Nessun candidato da rimuovere."
                        values={parliament.recommendedPruneModels || []}
                    />

                    {scorecard?.lanes && scorecard.lanes.length > 0 ? (
                        <div className={styles.section}>
                            <h4 className={styles.title}>Copertura per area AI</h4>
                            <div className={styles.sections}>
                                {scorecard.lanes.map((lane) => (
                                    <div
                                        key={lane.lane}
                                        className={styles.row}
                                    >
                                        <div className={styles.compact}>
                                            <div>
                                                <p className={styles.title}>
                                                    {laneLabel(lane.lane)}
                                                </p>
                                                <p className={styles.muted}>
                                                    {lane.capability}
                                                </p>
                                            </div>
                                            <span className={cn(
                                                styles.status,
                                                laneStateClassName(lane.state),
                                            )}>
                                                {laneStateLabel(lane.state)}
                                            </span>
                                        </div>

                                        <div className={styles.rows}>
                                            <InlineRow label="Focus" value={lane.focusCandidateLabel || lane.focusCandidateModel || 'n/d'} />
                                            <InlineRow label="Eseguibili" value={`${lane.runnableCandidates}/${lane.totalCandidates}`} />
                                            <InlineRow label="Valutati" value={`${lane.benchmarkedCandidates}/${lane.totalCandidates}`} />
                                        </div>

                                        {lane.focusNote ? (
                                            <p className={styles.muted}>
                                                {lane.focusNote}
                                            </p>
                                        ) : null}

                                        {lane.blockers.length > 0 ? (
                                            <div className={cn(styles.list, styles.warning)}>
                                                <p className={styles.status}>Motivi di blocco</p>
                                                {lane.blockers.map((blocker) => (
                                                    <span
                                                        key={`${lane.lane}-${blocker}`}
                                                        className={styles.model}
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

                    <div className={styles.row}>
                        <p>Aggiornato: <span className={styles.value}>{state.payload?.updatedAt || 'n/d'}</span></p>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function MetricRow({ label, value, meta }: { label: string; value: string; meta?: string | null }) {
    return (
        <div className={styles.metricRow}>
            <span className={styles.label}>{label}</span>
            <span className={styles.value}>{value}</span>
            {meta ? (
                <span className={styles.meta}>{meta}</span>
            ) : null}
        </div>
    );
}

function ModelList({ title, values, emptyLabel }: { title: string; values: string[]; emptyLabel: string }) {
    return (
        <div className={styles.row}>
            <h4 className={styles.title}>{title}</h4>
            <div className={styles.list}>
                {values.length > 0 ? values.map((value) => (
                    <span
                        key={value}
                        className={styles.model}
                    >
                        {value}
                    </span>
                )) : (
                    <span className={styles.muted}>{emptyLabel}</span>
                )}
            </div>
        </div>
    );
}

function InlineRow({ label, value }: { label: string; value: string }) {
    return (
        <div className={styles.metricRow}>
            <span className={styles.label}>{label}</span>
            <span className={styles.value}>{value}</span>
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
            return styles.positive;
        case 'benchmark_only':
            return styles.muted;
        case 'integration_pending':
            return styles.muted;
        case 'blocked':
            return styles.critical;
        default:
            return styles.warning;
    }
}
