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

/* @Codex WUL-684: display names only; report/control codes and decisions stay unchanged. */
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
const DISCLOSURE_SUMMARY_CLASS = 'min-h-11 cursor-pointer content-center text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

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
        <div className="mf-section min-w-0 space-y-4 [overflow-wrap:anywhere]" data-testid="ai-rollout-readiness-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <ShieldAlert className="mt-1 h-5 w-5 shrink-0 text-sky-700 dark:text-sky-200" aria-hidden="true" />
                    <div className="min-w-0">
                        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Verifiche delle funzioni assistite</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            Leggi gli esiti delle verifiche salvate su questo computer. Non sono prove eseguite ora: aggiornare la vista non avvia controlli, non attiva funzioni e non applica blocchi.
                        </p>
                        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            «Solo osservazione» non autorizza l’uso clinico. Le funzioni spente restano spente, anche quando un modello supera una verifica.
                        </p>
                    </div>
                </div>
                <button type="button" onClick={() => void loadArtifacts()}
                    className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-slate-200/70 bg-white/72 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20 dark:hover:text-white">
                    <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Rileggi verifiche
                </button>
            </div>

            {state.status === 'idle' || state.status === 'loading' ? (
                <p role="status" className="text-sm text-slate-600 dark:text-slate-300">Lettura delle verifiche salvate…</p>
            ) : null}
            {state.status === 'missing' ? (
                <div className="border-t border-slate-200/70 pt-4 text-sm leading-6 text-slate-600 dark:border-white/10 dark:text-slate-300">
                    <p>{state.message}</p>
                    <MissingReportHelp />
                </div>
            ) : null}
            {state.status === 'error' ? (
                <div role="alert" className="border-l-2 border-red-300 bg-red-50/80 p-4 text-sm leading-6 text-red-700 dark:border-red-500/40 dark:bg-red-900/10 dark:text-red-200">
                    <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Verifiche salvate non disponibili
                    </div>
                    <p className="mt-2">Premi «Rileggi verifiche» per riprovare. Questo errore non dimostra che una funzione sia pronta o spenta.</p>
                    <details className="mt-2">
                        <summary className={DISCLOSURE_SUMMARY_CLASS}>Dettagli dell’errore per l’assistenza</summary>
                        <p>{state.message}</p>
                    </details>
                </div>
            ) : null}
            {state.status === 'ready' ? (
                <div className="min-w-0 space-y-4">
                    {missingCount === lanes.length ? (
                        <div className="border-t border-slate-200/70 pt-4 text-sm leading-6 text-slate-600 dark:border-white/10 dark:text-slate-300">
                            <p>Nessuna verifica salvata disponibile. Non è possibile dedurre che le funzioni siano pronte; le aree ricevute dal servizio sono elencate qui sotto.</p>
                            <MissingReportHelp />
                        </div>
                    ) : null}
                    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MetricCard label="Solo osservazione" value={String(readyCount)} tone="ready" />
                        <MetricCard label="In attesa" value={String(holdCount)} tone="hold" />
                        <MetricCard label="Blocco richiesto" value={String(rollbackCount)} tone="rollback" />
                        <MetricCard label="Verifiche mancanti" value={String(missingCount)} tone="missing" />
                    </div>
                    <div className="border-t border-slate-200/70 pt-4 dark:border-white/10">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Funzioni spente nelle impostazioni</h4>
                                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    Questa vista è in sola lettura. «Non spenta» descrive solo la scelta nelle impostazioni: non garantisce disponibilità, verifiche superate o uso clinico autorizzato.
                                </p>
                            </div>
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-300" data-testid="ai-rollout-local-control-summary">
                                {disabledControlsCount} funzioni spente su {localControls.length}
                            </p>
                        </div>
                        <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
                            {localControls.map((control) => (
                                <div key={control.lane}
                                    className={cn('min-w-0 border-l-2 px-3 py-2 text-sm',
                                        control.state === 'enabled'
                                            ? 'border-emerald-300 bg-emerald-50/80 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-900/10 dark:text-emerald-200'
                                            : 'border-red-300 bg-red-50/80 text-red-800 dark:border-red-500/40 dark:bg-red-900/10 dark:text-red-200')}
                                    data-testid={`ai-rollout-local-control-${control.lane}`}>
                                    <p className="font-semibold">{LOCAL_CONTROL_LABELS[control.lane]}</p>
                                    <p>{control.state === 'enabled' ? 'Non spenta nelle impostazioni' : 'Spenta nelle impostazioni'}</p>
                                    <details>
                                        <summary className={DISCLOSURE_SUMMARY_CLASS}>Dettagli per l’assistenza</summary>
                                        <p>{control.label} · <code>{control.key}</code> · <code>{control.state}</code></p>
                                    </details>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                        {lanes.map((entry) => (
                            <LaneCard key={entry.lane} entry={entry}
                                localControl={localControlMap.get(entry.lane as RolloutLocalControlLane)} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/* @Codex: diagnostic commands remain copyable but are not ordinary user actions. */
function MissingReportHelp({ lane = 'patient_insight' }: { lane?: RolloutLane }) {
    return <details className="mt-2">
        <summary className={DISCLOSURE_SUMMARY_CLASS}>Dettagli per l’assistenza: verifica mancante</summary>
        <p>Chiedi a chi gestisce MediFlow di controllare il report locale. Il comando seguente è un riferimento tecnico, non una verifica già eseguita né un’azione avviata da questa pagina.</p>
        <p className="mt-2 break-words font-mono text-xs">
            npm run validate:ai-rollout-readiness -- --lane {lane} --report &lt;artifact.json&gt; --fallback-written --owner operatore-demo --license-clear
        </p>
    </details>;
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'ready' | 'hold' | 'rollback' | 'missing' }) {
    return <div className={cn('min-w-0 border-l-2 px-3 py-3',
        tone === 'ready' && 'border-emerald-300 bg-emerald-50/75 dark:border-emerald-500/40 dark:bg-emerald-900/10',
        tone === 'hold' && 'border-amber-300 bg-amber-50/75 dark:border-amber-500/40 dark:bg-amber-900/10',
        tone === 'rollback' && 'border-red-300 bg-red-50/75 dark:border-red-500/40 dark:bg-red-900/10',
        tone === 'missing' && 'border-slate-300 bg-slate-50/75 dark:border-white/20 dark:bg-white/5',
    )} data-testid={`ai-rollout-metric-${tone}`}>
        <span className="block text-sm text-slate-600 dark:text-slate-300">{label}</span>
        <span className="mt-2 block text-base font-semibold text-slate-900 dark:text-white">{value}</span>
    </div>;
}

function LaneCard({ entry, localControl }: {
    entry: RolloutArtifactPayload['lanes'][number];
    localControl?: RolloutArtifactPayload['localControls'][number];
}) {
    const meta = LANE_META[entry.lane];
    const status = entry.report?.status || (entry.available ? 'hold' : 'missing');
    const blockers = entry.report?.blockers || [];
    const warnings = entry.report?.warnings || [];
    const Icon = status === 'shadow-ready' ? CheckCircle2 : status === 'rollback-required' ? AlertTriangle : PauseCircle;
    return <div className="min-w-0 border-t border-slate-200/70 pt-4 dark:border-white/10" data-testid={`ai-rollout-lane-${entry.lane}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <h4 className="text-base font-semibold text-slate-900 dark:text-white">{meta.label}</h4>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{meta.description}</p>
            </div>
            <div className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold',
                status === 'shadow-ready' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
                status === 'hold' && 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
                status === 'rollback-required' && 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200',
                status === 'missing' && 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200',
            )}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{STATUS_LABELS[status]}
            </div>
        </div>
        {localControl ? <div className="mt-3">
            <MiniMetric label="Scelta nelle impostazioni"
                value={localControl.state === 'enabled' ? 'Non spenta · disponibilità da verificare' : 'Spenta nelle impostazioni'}
                tone={localControl.state === 'enabled' ? 'ready' : 'rollback'} />
        </div> : null}
        {entry.available && entry.report ? <>
            <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
                <MiniMetric label="Modello valutato" value={entry.report.selectedModel || 'Non indicato'} />
                <MiniMetric label="Motivi di blocco" value={String(blockers.length)} />
                <MiniMetric label="Avvertenze" value={String(warnings.length)} />
            </div>
            <DetailList className="mt-4" title="Motivi che impediscono di procedere" emptyLabel="Nessun motivo di blocco riportato. Non equivale a un’autorizzazione all’uso."
                tone="blocker" items={blockers.map((blocker) => `${blocker.id || 'unknown'}: ${blocker.message || 'n/d'}`)} />
            <DetailList className="mt-3" title="Avvertenze da valutare" emptyLabel="Nessuna avvertenza riportata."
                tone="warning" items={warnings.map((warning) => `${warning.id || 'unknown'}: ${warning.message || 'n/d'}`)} />
            <details className="mt-3 border-t border-slate-200/70 pt-2 text-sm leading-6 text-slate-600 dark:border-white/10 dark:text-slate-300">
                <summary className={DISCLOSURE_SUMMARY_CLASS}>Dettagli tecnici della verifica</summary>
                <div className="space-y-2">
                    <p>Area: <code>{entry.lane}</code>. Esito: <code>{status}</code>.</p>
                    <p>Stato registrato: <code>{entry.report.currentState || 'n/d'}</code>.</p>
                    {localControl ? <p>Scelta locale: <code>{localControl.state}</code>.</p> : null}
                    <p>Attualità delle prove: {entry.report.evidence?.benchmarkFresh ? 'confermata nel report' : 'non confermata nel report'}.</p>
                    <p>Responsabile della verifica: {entry.report.evidence?.owner || 'Non indicato'}.</p>
                    <p>Ultimo aggiornamento: <span className="font-mono">{entry.updatedAt || 'Non indicato'}</span>.</p>
                    <p>File dei dati (JSON): <code>{entry.jsonPath || 'Non indicato'}</code>.</p>
                    <p>File del resoconto (Markdown): <code>{entry.markdownPath || 'Non indicato'}</code>.</p>
                </div>
            </details>
            {entry.markdown ? <details className="mt-3 border-t border-slate-200/70 pt-2 dark:border-white/10" data-testid={`ai-rollout-markdown-${entry.lane}`}>
                <summary className={`${DISCLOSURE_SUMMARY_CLASS} text-slate-600 dark:text-slate-300`}>Resoconto tecnico completo</summary>
                <pre className="mt-3 max-w-full whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-600 dark:text-slate-300">{entry.markdown}</pre>
            </details> : null}
        </> : <div className="mt-4 border-t border-dashed border-slate-200/80 pt-4 text-sm leading-6 text-slate-600 dark:border-white/10 dark:text-slate-300" data-testid={`ai-rollout-missing-${entry.lane}`}>
            <p>Verifica salvata mancante per questa attività. Nessun esito disponibile: non considerarla pronta.</p>
            <MissingReportHelp lane={entry.lane} />
        </div>}
    </div>;
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: 'ready' | 'rollback' }) {
    return <div className={cn('min-w-0 py-2',
        tone === 'ready' && 'text-emerald-800 dark:text-emerald-200',
        tone === 'rollback' && 'text-red-800 dark:text-red-200',
        !tone && 'text-slate-900 dark:text-white',
    )}>
        <span className="block text-sm text-slate-600 dark:text-slate-300">{label}</span>
        <span className="mt-1 block text-sm font-semibold">{value}</span>
    </div>;
}

function DetailList({ className, title, items, emptyLabel, tone }: {
    className?: string; title: string; items: string[]; emptyLabel: string; tone: 'blocker' | 'warning';
}) {
    return <div className={cn('min-w-0 border-l-2 py-2 pl-3',
        tone === 'blocker' ? 'border-slate-300 dark:border-white/20' : 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-900/5', className,
    )}>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        <div className="mt-2 space-y-1.5">
            {items.length > 0 ? items.map((item) => <p key={item} className="text-sm leading-6 text-slate-600 dark:text-slate-300">{item}</p>)
                : <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{emptyLabel}</p>}
        </div>
    </div>;
}
