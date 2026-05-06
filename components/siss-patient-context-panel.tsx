'use client';

/* @Codex */
import { useEffect, useState } from 'react';
/* @Codex */
import { Accessibility, ChevronDown, ExternalLink, FolderOpen, LoaderCircle, RefreshCcw, Search, ShieldAlert, ShieldCheck, SquareMenu } from 'lucide-react';
/* @Codex */
import { completeSissPortalHandoff, prepareSissPortalWindow } from '@/lib/siss';
/* @Codex */
import { buildSissPatientContextSummary, type SissPatientContextAction } from '@/lib/siss-patient-context-shared';
/* @Codex */
import { type ValidatePatientExportResponse } from '@/lib/fse-validate-patient-contract';
/* @Codex */
import { db } from '@/lib/db';
/* @Codex */
import {
    SISS_SESSION_OBSERVED_MODULE_LABELS,
    type SissSessionHealth,
    type SissSessionStatusResponse,
} from '@/lib/siss-session-shared';

type Props = {
    patientId: string;
    patientTaxCode: string | null | undefined;
};

type FeedbackState = {
    kind: 'success' | 'warning' | 'error';
    message: string;
    correlationId?: string | null;
};

type HandoffResponse = {
    status: 'handoff';
    action: SissPatientContextAction;
    title: string;
    mode: 'portal-handoff' | 'certified-api';
    handoffUrl: string;
    clipboardText: string | null;
    correlationId: string;
    message: string;
};

type ContextActionConfig = {
    action: SissPatientContextAction;
    label: string;
    caption: string;
    icon: typeof ExternalLink;
};

type BlockedCapabilityConfig = {
    label: string;
    caption: string;
    reason: string;
};

type FseReadinessState = {
    loading: boolean;
    error: string | null;
    validation: ValidatePatientExportResponse | null;
};

type SessionStatusState = {
    loading: boolean;
    error: string | null;
    status: SissSessionStatusResponse | null;
};

const ACTIONS: ContextActionConfig[] = [
    {
        action: 'prescription.create',
        label: 'Modulo prescrittivo',
        caption: 'Apri la webapp ufficiale del Modulo Prescrittivo Regionale con il CF pronto da incollare.',
        icon: ExternalLink,
    },
    {
        action: 'prosthetics.open',
        label: 'Protesica-RL',
        caption: 'Apri Assistente RL / Protesica-RL con il CF del paziente pronto da incollare.',
        icon: Accessibility,
    },
    {
        action: 'fse.lookup',
        label: 'FSE',
        caption: 'Apri OpeFseIE con il CF del paziente pronto da incollare.',
        icon: FolderOpen,
    },
    {
        action: 'registry.lookup',
        label: 'Anagrafe',
        caption: 'Apri Gaia con il CF del paziente pronto da incollare.',
        icon: Search,
    },
    {
        action: 'menu.open',
        label: 'Menu SISS',
        caption: 'Apri il menu SISS dalla sessione browser attiva.',
        icon: SquareMenu,
    },
];

/* @Codex */
const BLOCKED_CAPABILITIES: BlockedCapabilityConfig[] = [
    {
        label: 'Prescrittivo nativo',
        caption: 'Compilazione e invio direttamente dentro MediFlow.',
        reason: 'Richiede una SSI qualificata SISS e un canale A2A/certificato; il prototipo attuale si ferma all\'handoff browser.',
    },
    {
        label: 'FSE embedded',
        caption: 'Consultazione del fascicolo dentro l\'interfaccia del gestionale.',
        reason: 'Manca ancora uno stack regionale certificato per autenticazione, policy privacy e scambio documentale dentro l\'app.',
    },
    {
        label: 'SGDT',
        caption: 'Accesso contestuale ai percorsi territoriali regionali dal paziente aperto.',
        reason: 'SGDT risulta un applicativo regionale centralizzato; nel prototipo non c\'e ancora un punto di integrazione paziente-scoped adottabile.',
    },
    {
        label: 'Certificati di malattia',
        caption: 'Emissione contestuale del certificato partendo dal paziente MediFlow.',
        reason: 'La documentazione SISS esiste, ma non abbiamo ancora modellato scenario, tracciato e vincoli operativi in un adapter dedicato.',
    },
];

function isHandoffResponse(value: unknown): value is HandoffResponse {
    return (
        typeof value === 'object' &&
        value !== null &&
        'status' in value &&
        value.status === 'handoff' &&
        'handoffUrl' in value &&
        typeof value.handoffUrl === 'string' &&
        'clipboardText' in value &&
        (typeof value.clipboardText === 'string' || value.clipboardText === null) &&
        'correlationId' in value &&
        typeof value.correlationId === 'string' &&
        'message' in value &&
        typeof value.message === 'string' &&
        'action' in value &&
        typeof value.action === 'string' &&
        'title' in value &&
        typeof value.title === 'string' &&
        'mode' in value &&
        (value.mode === 'portal-handoff' || value.mode === 'certified-api')
    );
}

/* @Codex */
function healthDotClassName(health: SissSessionHealth) {
    switch (health) {
        case 'recent':
            return 'graphite-status-dot is-recent';
        case 'stale':
            return 'graphite-status-dot is-stale';
        default:
            return 'graphite-status-dot is-absent';
    }
}

/* @Codex */
function healthLabel(health: SissSessionHealth, recent: string, stale: string, absent: string) {
    if (health === 'recent') return recent;
    if (health === 'stale') return stale;
    return absent;
}

export default function SissPatientContextPanel({ patientId, patientTaxCode }: Props) {
    const [activeAction, setActiveAction] = useState<SissPatientContextAction | null>(null);
    const [feedback, setFeedback] = useState<FeedbackState | null>(null);
    const [fseReadiness, setFseReadiness] = useState<FseReadinessState>({
        loading: true,
        error: null,
        validation: null,
    });
    const [sessionStatus, setSessionStatus] = useState<SessionStatusState>({
        loading: true,
        error: null,
        status: null,
    });

    const summary = buildSissPatientContextSummary({ patientTaxCode });
    const hasTaxCode = summary.patientFiscalCodeReady;

    const refreshFseReadiness = async () => {
        setFseReadiness((current) => ({
            loading: true,
            error: null,
            validation: current.validation,
        }));

        try {
            const response = await fetch(`/api/fse/validate-patient?patientId=${encodeURIComponent(patientId)}`);
            const payload = await response.json().catch(() => null) as ValidatePatientExportResponse | { error?: string } | null;

            if (!response.ok) {
                const message = payload && 'error' in payload && typeof payload.error === 'string'
                    ? payload.error
                    : 'Pre-check FSE non disponibile';
                setFseReadiness({
                    loading: false,
                    error: message,
                    validation: null,
                });
                return;
            }

            setFseReadiness({
                loading: false,
                error: null,
                validation: payload as ValidatePatientExportResponse,
            });
        } catch (error) {
            setFseReadiness({
                loading: false,
                error: error instanceof Error ? error.message : 'Errore inatteso nel pre-check FSE',
                validation: null,
            });
        }
    };

    const refreshSessionStatus = async () => {
        setSessionStatus((current) => ({
            loading: true,
            error: null,
            status: current.status,
        }));

        try {
            const response = await fetch('/api/siss/session-status');
            const payload = await response.json().catch(() => null) as SissSessionStatusResponse | { error?: string } | null;

            if (!response.ok) {
                const message = payload && 'error' in payload && typeof payload.error === 'string'
                    ? payload.error
                    : 'Stato sessione SISS non disponibile';
                setSessionStatus({
                    loading: false,
                    error: message,
                    status: null,
                });
                return;
            }

            setSessionStatus({
                loading: false,
                error: null,
                status: payload as SissSessionStatusResponse,
            });
        } catch (error) {
            setSessionStatus({
                loading: false,
                error: error instanceof Error ? error.message : 'Errore inatteso nel controllo sessione SISS',
                status: null,
            });
        }
    };

    useEffect(() => {
        void refreshFseReadiness();
        void refreshSessionStatus();
    }, [patientId]);

    const startFlow = async (action: SissPatientContextAction) => {
        setActiveAction(action);
        setFeedback(null);

        const popupWindow = prepareSissPortalWindow();
        if (!popupWindow) {
            setFeedback({
                kind: 'error',
                message: 'Il browser ha bloccato l\'apertura del portale SISS. Consenti i popup e riprova.',
            });
            setActiveAction(null);
            return;
        }

        try {
            const response = await fetch('/api/siss/context', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ patientId, action }),
            });

            const payload = await response.json().catch(() => null) as HandoffResponse | {
                error?: string;
                correlationId?: string | null;
            } | null;
            const errorMessage = payload && 'error' in payload && typeof payload.error === 'string'
                ? payload.error
                : 'Flusso SISS non disponibile';
            const errorCorrelationId = payload && 'correlationId' in payload && typeof payload.correlationId === 'string'
                ? payload.correlationId
                : null;

            if (!response.ok) {
                popupWindow.close();
                setFeedback({
                    kind: 'error',
                    message: errorMessage,
                    correlationId: errorCorrelationId,
                });
                return;
            }

            if (!isHandoffResponse(payload)) {
                throw new Error('Risposta SISS non valida');
            }

            const handoffResult = await completeSissPortalHandoff({
                handoffUrl: payload.handoffUrl,
                clipboardText: payload.clipboardText ?? undefined,
                successMessage: payload.message,
                popupWindow,
            });
            if (!handoffResult.opened) {
                popupWindow.close();
            }

            setFeedback({
                kind: handoffResult.success ? 'success' : handoffResult.opened ? 'warning' : 'error',
                message: `${payload.title}: ${handoffResult.message}`,
                correlationId: payload.correlationId,
            });

            if (handoffResult.opened) {
                const actionConfig = ACTIONS.find((item) => item.action === action);
                const now = new Date();
                void db.sissHandoffs.add({
                    id: crypto.randomUUID(),
                    patientId,
                    action,
                    moduleLabel: actionConfig?.label ?? payload.title,
                    reason: 'Handoff avviato dal pannello contesto paziente SISS.',
                    startedAt: now,
                    outcome: 'started',
                    correlationId: payload.correlationId,
                    createdAt: now,
                    updatedAt: now,
                }).catch((logError) => {
                    console.warn('[MediFlow] SISS handoff diary write failed:', logError);
                });
            }
        } catch (error) {
            popupWindow.close();
            setFeedback({
                kind: 'error',
                message: error instanceof Error ? error.message : 'Errore inatteso nel flusso SISS',
            });
        } finally {
            setActiveAction(null);
        }
    };

    const validation = fseReadiness.validation;
    const readinessTone: 'success' | 'warning' | 'critical' | 'muted' = validation?.hasErrors
        ? 'critical'
        : validation?.hasWarnings
            ? 'warning'
            : validation
                ? 'success'
                : 'muted';
    const readinessLabel = fseReadiness.loading
        ? 'Pre-check FSE…'
        : validation?.hasErrors
            ? 'FSE: blocchi'
            : validation?.hasWarnings
                ? 'FSE: warning'
                : validation
                    ? 'FSE pronta'
                    : 'Pre-check FSE non disponibile';
    const sessionData = sessionStatus.status;

    const formatObservedAt = (value: string | null) => {
        if (!value) return 'Non osservato';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;

        return new Intl.DateTimeFormat('it-IT', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).format(date);
    };

    const remoteSignatureCheckpoint = sessionData?.checkpoints.find((checkpoint) => checkpoint.key === 'remote-signature') ?? null;
    const roleSelectionCheckpoint = sessionData?.checkpoints.find((checkpoint) => checkpoint.key === 'role-selection') ?? null;
    return (
        <section className="patient-detail-section border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.94)] p-5 md:p-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                    <p className="section-kicker">Contesto SISS</p>
                    <h2 className="mt-1 flex items-center gap-2 text-base font-semibold text-[color:var(--mf-ink)] md:text-[17px]">
                        <ShieldCheck className="h-4 w-4 text-[color:var(--mf-primary)]" />
                        Contesto paziente SISS
                    </h2>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--mf-muted)]">
                        Handoff verso le webapp regionali ufficiali (prescrittivo, FSE, anagrafe). Nessuna integrazione SISS nativa certificata: il CF viene preparato per il copia-incolla.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="graphite-chip">{summary.transportMode}</span>
                    <span className={`graphite-chip ${hasTaxCode ? 'graphite-chip-tone-success' : 'graphite-chip-tone-warning'}`}>
                        {hasTaxCode ? 'CF pronto' : 'CF mancante'}
                    </span>
                    <span className={`graphite-chip graphite-chip-tone-${readinessTone}`}>
                        {readinessLabel}
                    </span>
                </div>
            </header>

            {!hasTaxCode && (
                <p className="mt-2 text-[11.5px] font-medium text-[color:var(--mf-warning)]">
                    Le azioni paziente-specifiche richiedono un codice fiscale valido nel profilo; il Menu SISS resta apribile.
                </p>
            )}

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="graphite-block">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--mf-muted)]">
                            Sessione SISS
                        </h3>
                        <button
                            type="button"
                            onClick={() => void refreshSessionStatus()}
                            disabled={sessionStatus.loading}
                            className="graphite-mini-btn"
                            aria-label="Aggiorna stato sessione SISS"
                        >
                            {sessionStatus.loading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                            Aggiorna
                        </button>
                    </div>

                    {sessionStatus.error ? (
                        <p className="mt-2 text-[11.5px] font-medium text-[color:var(--mf-critical)]">{sessionStatus.error}</p>
                    ) : sessionData ? (
                        <>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className={`graphite-chip ${
                                    sessionData.sessionHealth === 'recent'
                                        ? 'graphite-chip-tone-success'
                                        : sessionData.sessionHealth === 'stale'
                                            ? 'graphite-chip-tone-warning'
                                            : 'graphite-chip-tone-muted'
                                }`}>
                                    <span className={healthDotClassName(sessionData.sessionHealth)} aria-hidden />
                                    {healthLabel(sessionData.sessionHealth, 'Sessione attiva', 'Sessione vista', 'Sessione assente')}
                                </span>
                                {remoteSignatureCheckpoint && (
                                    <span className={`graphite-chip ${
                                        remoteSignatureCheckpoint.health === 'recent'
                                            ? 'graphite-chip-tone-success'
                                            : remoteSignatureCheckpoint.health === 'stale'
                                                ? 'graphite-chip-tone-warning'
                                                : 'graphite-chip-tone-muted'
                                    }`}>
                                        <span className={healthDotClassName(remoteSignatureCheckpoint.health)} aria-hidden />
                                        {healthLabel(remoteSignatureCheckpoint.health, 'Firma remota', 'Firma vista', 'Firma assente')}
                                    </span>
                                )}
                                {roleSelectionCheckpoint && (
                                    <span className={`graphite-chip ${
                                        roleSelectionCheckpoint.health === 'recent'
                                            ? 'graphite-chip-tone-success'
                                            : roleSelectionCheckpoint.health === 'stale'
                                                ? 'graphite-chip-tone-warning'
                                                : 'graphite-chip-tone-muted'
                                    }`}>
                                        <span className={healthDotClassName(roleSelectionCheckpoint.health)} aria-hidden />
                                        {healthLabel(roleSelectionCheckpoint.health, 'Ruolo confermato', 'Ruolo visto', 'Ruolo assente')}
                                    </span>
                                )}
                            </div>

                            <dl className="mt-3 grid gap-1">
                                <div className="graphite-row">
                                    <dt className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--mf-muted)]">Ultimo modulo</dt>
                                    <dd className="flex items-center gap-2 text-right">
                                        <span className="font-semibold text-[color:var(--mf-ink)]">
                                            {sessionData.lastModule ? SISS_SESSION_OBSERVED_MODULE_LABELS[sessionData.lastModule] : '—'}
                                        </span>
                                        <span className="text-[11px] text-[color:var(--mf-muted)]">{formatObservedAt(sessionData.lastModuleAt)}</span>
                                    </dd>
                                </div>
                            </dl>

                            <p className="mt-2 text-[10.5px] uppercase tracking-wide text-[color:var(--mf-muted)]">
                                Fonte: {sessionData.browserProfile ? `Atlas ${sessionData.browserProfile}` : 'Atlas locale'}
                            </p>

                            {sessionData.warning && (
                                <p className="mt-2 text-[11.5px] font-medium text-[color:var(--mf-warning)]">{sessionData.warning}</p>
                            )}
                        </>
                    ) : (
                        <p className="mt-2 text-[11.5px] text-[color:var(--mf-muted)]">Lettura locale Atlas in corso…</p>
                    )}
                </div>

                <div className="graphite-block">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--mf-muted)]">
                            Pre-check FSE
                        </h3>
                        <button
                            type="button"
                            onClick={() => void refreshFseReadiness()}
                            disabled={fseReadiness.loading}
                            className="graphite-mini-btn"
                            aria-label="Aggiorna pre-check FSE"
                        >
                            {fseReadiness.loading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                            Aggiorna
                        </button>
                    </div>

                    <p className="mt-1 text-[11.5px] leading-5 text-[color:var(--mf-muted)]">
                        Validazione locale per stimare la prontezza dei profili FSE pilotati.
                    </p>

                    {fseReadiness.error ? (
                        <p className="mt-2 text-[11.5px] font-medium text-[color:var(--mf-critical)]">{fseReadiness.error}</p>
                    ) : validation ? (
                        <dl className="mt-2 grid gap-1">
                            <div className="graphite-row">
                                <dt className="flex items-center gap-2 text-[11.5px] text-[color:var(--mf-ink)]">
                                    <span className={`graphite-status-dot ${
                                        validation.therapyMedication.errorCount > 0
                                            ? 'is-stale'
                                            : validation.therapyMedication.warningCount > 0
                                                ? 'is-stale'
                                                : 'is-recent'
                                    }`} aria-hidden />
                                    Terapie
                                </dt>
                                <dd className="text-right text-[11px] text-[color:var(--mf-muted)]">
                                    <span className="font-semibold text-[color:var(--mf-ink)]">{validation.therapyMedication.total}</span>
                                    <span className="ml-2">err {validation.therapyMedication.errorCount}</span>
                                    <span className="ml-2">warn {validation.therapyMedication.warningCount}</span>
                                </dd>
                            </div>
                            <div className="graphite-row">
                                <dt className="flex items-center gap-2 text-[11.5px] text-[color:var(--mf-ink)]">
                                    <span className={`graphite-status-dot ${
                                        validation.observationVitals.errorCount > 0
                                            ? 'is-stale'
                                            : validation.observationVitals.warningCount > 0
                                                ? 'is-stale'
                                                : 'is-recent'
                                    }`} aria-hidden />
                                    Osservazioni
                                </dt>
                                <dd className="text-right text-[11px] text-[color:var(--mf-muted)]">
                                    <span className="font-semibold text-[color:var(--mf-ink)]">{validation.observationVitals.total}</span>
                                    <span className="ml-2">err {validation.observationVitals.errorCount}</span>
                                    <span className="ml-2">warn {validation.observationVitals.warningCount}</span>
                                </dd>
                            </div>
                        </dl>
                    ) : null}
                </div>
            </div>

            <div className="mt-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--mf-muted)]">
                    Apri webapp regionale
                </h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {ACTIONS.map((item) => {
                        const Icon = item.icon;
                        const isLoading = activeAction === item.action;
                        const state = summary.actionStates.find((actionState) => actionState.action === item.action);
                        const disabled = Boolean(activeAction) || !state?.available;

                        return (
                            <button
                                key={item.action}
                                type="button"
                                onClick={() => void startFlow(item.action)}
                                disabled={disabled}
                                className="siss-action-btn"
                                title={item.caption}
                            >
                                <div className="siss-action-btn-head">
                                    {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                                    <span className="min-w-0 truncate">{item.label}</span>
                                    <ExternalLink className="ml-auto h-3 w-3 text-[color:var(--mf-muted)]" />
                                </div>
                                <p className="siss-action-btn-caption line-clamp-1">{item.caption}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            <details className="group mt-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[10px] border border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,252,247,0.78)] px-3 py-2 text-[12.5px] font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,123,104,0.26)] dark:border-[color:rgba(255,247,240,0.08)] dark:bg-white/4">
                    <span className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-[color:var(--mf-warning)]" />
                        Non integrabile oggi
                        <span className="graphite-chip graphite-chip-tone-muted">{BLOCKED_CAPABILITIES.length}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 text-[color:var(--mf-muted)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 siss-blocked-list">
                    {BLOCKED_CAPABILITIES.map((item) => (
                        <div key={item.label} className="siss-blocked-item">
                            <div className="siss-blocked-item-label">{item.label}</div>
                            <p className="siss-blocked-item-caption">{item.caption}</p>
                            <p className="siss-blocked-item-reason">{item.reason}</p>
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-[11.5px] leading-5 text-[color:var(--mf-muted)]">
                    Il salto da handoff assistito a integrazione nativa richiede un filone dedicato su qualifica SSI, canale A2A e requisiti regionali certificati.
                </p>
            </details>

            {feedback && (
                <div
                    className={`mt-4 siss-feedback ${
                        feedback.kind === 'success'
                            ? 'siss-feedback-success'
                            : feedback.kind === 'warning'
                                ? 'siss-feedback-warning'
                                : 'siss-feedback-error'
                    }`}
                    aria-live="polite"
                >
                    <div className="flex items-start gap-2">
                        {feedback.kind === 'error' ? (
                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <div className="min-w-0 space-y-1">
                            <p className="break-words">{feedback.message}</p>
                            {feedback.correlationId && (
                                <p className="font-mono text-[11px] opacity-80 break-all">
                                    Correlation ID: {feedback.correlationId}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
