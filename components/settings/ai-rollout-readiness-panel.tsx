'use client';

import { formatCountLabel } from '@/lib/format-count';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, PauseCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './ai-utilities.module.css';

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
    | 'treatment_reasoning';

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
    patient_insight: { label: 'Quadro paziente', description: 'Verifiche sulla sintesi del paziente da rivedere.' },
    smart_import: { label: 'Importazione assistita', description: 'Verifiche sui dati proposti dai documenti, prima della tua conferma.' },
    redaction: { label: 'Protezione dei dati identificativi', description: 'Verifiche sulla rimozione dei dati che possono identificare il paziente. Non è un’autorizzazione all’invio.' },
    clinical_entities: { label: 'Riconoscimento delle informazioni cliniche', description: 'Verifiche sul riconoscimento di informazioni cliniche nei documenti.' },
    generative_challenger: { label: 'Confronto tra modelli alternativi', description: 'Verifiche sui modelli alternativi rispetto al modello di riferimento. Nessuna sostituzione automatica.' },
};
const LOCAL_CONTROL_LABELS: Record<RolloutLocalControlLane, string> = {
    patient_insight: 'Quadro paziente', smart_import: 'Importazione assistita',
    document_synthesis: 'Sintesi dei documenti', treatment_reasoning: 'Revisione del trattamento',
};
const STATUS_LABELS: Record<RolloutStatus | 'missing', string> = {
    'shadow-ready': 'Solo osservazione · non uso clinico',
    hold: 'In attesa', 'rollback-required': 'Blocco richiesto', missing: 'Verifica non disponibile',
};
const DISCLOSURE_SUMMARY_CLASS = styles.disclosure;

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
        <div className={styles.panel} data-testid="ai-rollout-readiness-panel">
            <div className={styles.heading}>
                <div className={styles.headingBody}>
                    <ShieldAlert className={styles.icon} aria-hidden="true" />
                    <div className={styles.body}>
                        <h3 className={styles.title}>Verifiche delle funzioni assistite</h3>
                        <p className={styles.prose}>
                            Leggi gli esiti delle verifiche salvate su questo computer. Non sono prove eseguite ora: aggiornare la vista non avvia controlli, non attiva funzioni e non applica blocchi.
                        </p>
                        <p className={styles.prose}>
                            «Solo osservazione» non autorizza l’uso clinico. Le funzioni spente restano spente, anche quando un modello supera una verifica.
                        </p>
                    </div>
                </div>
                <button type="button" onClick={() => void loadArtifacts()}
                    className={styles.button}>
                    <RefreshCw className={styles.icon} aria-hidden="true" />
                    Rileggi verifiche
                </button>
            </div>

            {state.status === 'idle' || state.status === 'loading' ? (
                <p role="status" className={styles.muted}>Lettura delle verifiche salvate…</p>
            ) : null}
            {state.status === 'missing' ? (
                <div className={styles.row}>
                    <p>{state.message}</p>
                    <MissingReportHelp />
                </div>
            ) : null}
            {state.status === 'error' ? (
                <div role="alert" className={cn(styles.notice, styles.critical)}>
                    <div className={styles.status}>
                        <AlertTriangle className={styles.icon} aria-hidden="true" />
                        Verifiche salvate non disponibili
                    </div>
                    <p className={styles.spaced}>Premi «Rileggi verifiche» per riprovare. Questo errore non dimostra che una funzione sia pronta o spenta.</p>
                    <details className={styles.spaced}>
                        <summary className={DISCLOSURE_SUMMARY_CLASS}>Dettagli dell’errore per l’assistenza</summary>
                        <p>{state.message}</p>
                    </details>
                </div>
            ) : null}
            {state.status === 'ready' ? (
                <div className={styles.sections}>
                    {missingCount === lanes.length ? (
                        <div className={styles.row}>
                            <p>Nessuna verifica salvata disponibile. Non è possibile dedurre che le funzioni siano pronte; le aree ricevute dal servizio sono elencate qui sotto.</p>
                            <MissingReportHelp />
                        </div>
                    ) : null}
                    <div className={styles.rows}>
                        <MetricRow label="Solo osservazione" value={String(readyCount)} tone="ready" />
                        <MetricRow label="In attesa" value={String(holdCount)} tone="hold" />
                        <MetricRow label="Blocco richiesto" value={String(rollbackCount)} tone="rollback" />
                        <MetricRow label="Verifiche mancanti" value={String(missingCount)} tone="missing" />
                    </div>
                    <div className={styles.section}>
                        <div className={styles.heading}>
                            <div className={styles.body}>
                                <h4 className={styles.title}>Funzioni spente nelle impostazioni</h4>
                                <p className={styles.prose}>
                                    Questa vista è in sola lettura. «Non spenta» descrive solo la scelta nelle impostazioni: non garantisce disponibilità, verifiche superate o uso clinico autorizzato.
                                </p>
                            </div>
                            <p className={styles.muted} data-testid="ai-rollout-local-control-summary">
                                {formatCountLabel(disabledControlsCount, 'funzione spenta', 'funzioni spente')} su {localControls.length}
                            </p>
                        </div>
                        <div className={styles.rows}>
                            {localControls.map((control) => (
                                <div key={control.lane}
                                    className={cn(styles.row,
                                        control.state === 'enabled'
                                            ? styles.positive
                                            : styles.critical)}
                                    data-testid={`ai-rollout-local-control-${control.lane}`}>
                                    <p className={styles.title}>{LOCAL_CONTROL_LABELS[control.lane]}</p>
                                    <p>{control.state === 'enabled' ? 'Non spenta nelle impostazioni' : 'Spenta nelle impostazioni'}</p>
                                    <details>
                                        <summary className={DISCLOSURE_SUMMARY_CLASS}>Dettagli per l’assistenza</summary>
                                        <p>{control.label} · <code>{control.key}</code> · <code>{control.state}</code></p>
                                    </details>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className={styles.sections}>
                        {lanes.map((entry) => (
                            <LaneSection key={entry.lane} entry={entry}
                                localControl={localControlMap.get(entry.lane as RolloutLocalControlLane)} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function MissingReportHelp({ lane = 'patient_insight' }: { lane?: RolloutLane }) {
    return <details className={styles.spaced}>
        <summary className={DISCLOSURE_SUMMARY_CLASS}>Dettagli per l’assistenza: verifica mancante</summary>
        <p>Chiedi a chi gestisce MediFlow di controllare il report locale. Il comando seguente è un riferimento tecnico, non una verifica già eseguita né un’azione avviata da questa pagina.</p>
        <p className={styles.code}>
            npm run validate:ai-rollout-readiness -- --lane {lane} --report &lt;artifact.json&gt; --fallback-written --owner operatore-demo --license-clear
        </p>
    </details>;
}

function MetricRow({ label, value, tone }: { label: string; value: string; tone: 'ready' | 'hold' | 'rollback' | 'missing' }) {
    return <div className={cn(styles.metricRow,
        tone === 'ready' && styles.positive,
        tone === 'hold' && styles.warning,
        tone === 'rollback' && styles.critical,
        tone === 'missing' && styles.muted,
    )} data-testid={`ai-rollout-metric-${tone}`}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
    </div>;
}

function LaneSection({ entry, localControl }: {
    entry: RolloutArtifactPayload['lanes'][number];
    localControl?: RolloutArtifactPayload['localControls'][number];
}) {
    const meta = LANE_META[entry.lane];
    const status = entry.report?.status || (entry.available ? 'hold' : 'missing');
    const blockers = entry.report?.blockers || [];
    const warnings = entry.report?.warnings || [];
    const Icon = status === 'shadow-ready' ? CheckCircle2 : status === 'rollback-required' ? AlertTriangle : PauseCircle;
    return <div className={styles.section} data-testid={`ai-rollout-lane-${entry.lane}`}>
        <div className={styles.heading}>
            <div className={styles.body}>
                <h4 className={styles.title}>{meta.label}</h4>
                <p className={styles.prose}>{meta.description}</p>
            </div>
            <div className={cn(styles.status,
                status === 'shadow-ready' && styles.positive,
                status === 'hold' && styles.warning,
                status === 'rollback-required' && styles.critical,
                status === 'missing' && styles.muted,
            )}>
                <Icon className={styles.icon} aria-hidden="true" />{STATUS_LABELS[status]}
            </div>
        </div>
        {localControl ? <div className={styles.spaced}>
            <MiniMetric label="Scelta nelle impostazioni"
                value={localControl.state === 'enabled' ? 'Non spenta · disponibilità da verificare' : 'Spenta nelle impostazioni'}
                tone={localControl.state === 'enabled' ? 'ready' : 'rollback'} />
        </div> : null}
        {entry.available && entry.report ? <>
            <div className={styles.rows}>
                <MiniMetric label="Modello valutato" value={entry.report.selectedModel || 'Non indicato'} />
                <MiniMetric label="Motivi di blocco" value={String(blockers.length)} />
                <MiniMetric label="Avvertenze" value={String(warnings.length)} />
            </div>
            <DetailList title="Motivi che impediscono di procedere" emptyLabel="Nessun motivo di blocco riportato. Non equivale a un’autorizzazione all’uso."
                tone="blocker" items={blockers.map((blocker) => `${blocker.id || 'unknown'}: ${blocker.message || 'n/d'}`)} />
            <DetailList className={styles.spaced} title="Avvertenze da valutare" emptyLabel="Nessuna avvertenza riportata."
                tone="warning" items={warnings.map((warning) => `${warning.id || 'unknown'}: ${warning.message || 'n/d'}`)} />
            <details className={styles.row}>
                <summary className={DISCLOSURE_SUMMARY_CLASS}>Dettagli tecnici della verifica</summary>
                <div className={styles.list}>
                    <p>Area: <code>{entry.lane}</code>. Esito: <code>{status}</code>.</p>
                    <p>Stato registrato: <code>{entry.report.currentState || 'n/d'}</code>.</p>
                    {localControl ? <p>Scelta locale: <code>{localControl.state}</code>.</p> : null}
                    <p>Attualità delle prove: {entry.report.evidence?.benchmarkFresh ? 'confermata nel report' : 'non confermata nel report'}.</p>
                    <p>Responsabile della verifica: {entry.report.evidence?.owner || 'Non indicato'}.</p>
                    <p>Ultimo aggiornamento: <span className={styles.value}>{entry.updatedAt || 'Non indicato'}</span>.</p>
                    <p>File dei dati (JSON): <code>{entry.jsonPath || 'Non indicato'}</code>.</p>
                    <p>File del resoconto (Markdown): <code>{entry.markdownPath || 'Non indicato'}</code>.</p>
                </div>
            </details>
            {entry.markdown ? <details className={styles.row} data-testid={`ai-rollout-markdown-${entry.lane}`}>
                <summary className={DISCLOSURE_SUMMARY_CLASS}>Resoconto tecnico completo</summary>
                <pre className={styles.report}>{entry.markdown}</pre>
            </details> : null}
        </> : <div className={styles.row} data-testid={`ai-rollout-missing-${entry.lane}`}>
            <p>Verifica salvata mancante per questa attività. Nessun esito disponibile: non considerarla pronta.</p>
            <MissingReportHelp lane={entry.lane} />
        </div>}
    </div>;
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: 'ready' | 'rollback' }) {
    return <div className={cn(styles.metricRow,
        tone === 'ready' && styles.positive,
        tone === 'rollback' && styles.critical,
    )}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
    </div>;
}

function DetailList({ className, title, items, emptyLabel, tone }: {
    className?: string; title: string; items: string[]; emptyLabel: string; tone: 'blocker' | 'warning';
}) {
    return <div className={cn(styles.row,
        tone === 'blocker' ? styles.muted : styles.warning, className,
    )}>
        <p className={styles.status}>{items.length > 0 ? (tone === 'warning' ? '▲ ' : '✕ ') : null}{title}</p>
        <div className={styles.list}>
            {items.length > 0 ? items.map((item) => <p key={item}>{item}</p>)
                : <p className={styles.muted}>{emptyLabel}</p>}
        </div>
    </div>;
}
