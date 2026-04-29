'use client';

/* @Codex */
import { useEffect, useState } from 'react';
/* @Codex */
import { Accessibility, ExternalLink, FolderOpen, LoaderCircle, RefreshCcw, Search, ShieldAlert, ShieldCheck, SquareMenu } from 'lucide-react';
/* @Codex */
import { completeSissPortalHandoff, prepareSissPortalWindow } from '@/lib/siss';
/* @Codex */
import { buildSissPatientContextSummary, type SissPatientContextAction } from '@/lib/siss-patient-context-shared';
/* @Codex */
import { type ValidatePatientExportResponse } from '@/lib/fse-validate-patient-contract';
/* @Codex */
import {
    SISS_SESSION_OBSERVED_MODULE_LABELS,
    type SissSessionCheckpoint,
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

export default function SissPatientContextPanel({ patientId, patientTaxCode }: Props) {
    const [activeAction, setActiveAction] = useState<SissPatientContextAction | null>(null);
    const [feedback, setFeedback] = useState<FeedbackState | null>(null);
    const [fseReadiness, setFseReadiness] = useState<FseReadinessState>({
        loading: true,
        error: null,
        validation: null,
    });
    const [sessionStatus, setSessionStatus] = useState<SessionStatusState>({
        loading: false,
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
    const readinessTone = validation?.hasErrors
        ? 'error'
        : validation?.hasWarnings
            ? 'warning'
            : validation
                ? 'success'
                : 'neutral';
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

    const sessionHealthClassName = (health: SissSessionHealth) => {
        switch (health) {
            case 'recent':
                return 'border-emerald-200 bg-emerald-50 text-emerald-700';
            case 'stale':
                return 'border-amber-200 bg-amber-50 text-amber-700';
            default:
                return 'border-slate-200 bg-white/70 text-slate-500';
        }
    };

    const remoteSignatureCheckpoint = sessionData?.checkpoints.find((checkpoint) => checkpoint.key === 'remote-signature') ?? null;
    const roleSelectionCheckpoint = sessionData?.checkpoints.find((checkpoint) => checkpoint.key === 'role-selection') ?? null;
    const moduleCheckpoints = sessionData?.checkpoints.filter((checkpoint): checkpoint is SissSessionCheckpoint => (
        checkpoint.key === 'menu'
        || checkpoint.key === 'prescription'
        || checkpoint.key === 'prosthetics'
        || checkpoint.key === 'fse'
        || checkpoint.key === 'registry'
    )) ?? [];

    return (
        <div className="rounded-[28px] border border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-teal-50 p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-cyan-900">
                        <ShieldCheck className="h-4 w-4" />
                        Contesto paziente SISS
                    </div>
                    <p className="text-sm text-slate-700">
                        Apri rapidamente i moduli regionali ufficiali dal gestionale con il codice fiscale del paziente pronto da incollare, dove disponibile.
                    </p>
                    <p className="text-xs leading-5 text-slate-600">
                        Per il prescrittivo MediFlow richiama la webapp ufficiale del Modulo Prescrittivo Regionale; non sostituisce ancora l&apos;interfaccia regionale.
                    </p>
                    {!hasTaxCode && (
                        <p className="text-xs font-medium text-amber-700">
                            Le azioni paziente-specifiche richiedono un codice fiscale valido nel profilo; il Menu SISS puo comunque essere aperto.
                        </p>
                    )}
                </div>

                <div className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {summary.transportMode}
                </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
                <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-slate-500">
                    Sessione browser SISS richiesta
                </span>
                <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-slate-500">
                    Prescrittivo: webapp ufficiale regionale
                </span>
                <span className={`inline-flex items-center rounded-full px-3 py-1 ${
                    summary.patientFiscalCodeReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}>
                    {summary.patientFiscalCodeReady ? 'CF paziente valido' : 'CF paziente mancante o non valido'}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-slate-500">
                    API certificate non disponibili
                </span>
                <span className={`inline-flex items-center rounded-full px-3 py-1 ${
                    readinessTone === 'error'
                        ? 'bg-rose-50 text-rose-700'
                        : readinessTone === 'warning'
                            ? 'bg-amber-50 text-amber-700'
                            : readinessTone === 'success'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-white/70 text-slate-500'
                }`}>
                    {fseReadiness.loading
                        ? 'Pre-check FSE in corso'
                        : validation?.hasErrors
                            ? 'FSE locale con blocchi'
                            : validation?.hasWarnings
                                ? 'FSE locale con warning'
                                : validation
                                    ? 'FSE locale pronta'
                                    : 'Pre-check FSE non disponibile'}
                </span>
            </div>

            <div className="mt-4 rounded-2xl border border-white/70 bg-white/75 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                        <div className="text-sm font-semibold text-slate-900">Stato sessione SISS</div>
                        <p className="text-xs leading-5 text-slate-600">
                            Lettura locale della cronologia Atlas su questa macchina. Mostra segnali osservati di sessione, firma remota e ultimo modulo raggiunto, senza dichiarare uno stato certificato del backend regionale.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void refreshSessionStatus()}
                        disabled={sessionStatus.loading}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                        {sessionStatus.loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                        Aggiorna stato
                    </button>
                </div>

                {sessionStatus.error ? (
                    <p className="mt-3 text-xs font-medium text-rose-700">{sessionStatus.error}</p>
                ) : sessionData ? (
                    <>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 ${sessionHealthClassName(sessionData.sessionHealth)}`}>
                                {sessionData.sessionHealth === 'recent'
                                    ? 'Sessione SISS osservata'
                                    : sessionData.sessionHealth === 'stale'
                                        ? 'Sessione SISS osservata in passato'
                                        : 'Sessione SISS non osservata'}
                            </span>
                            {remoteSignatureCheckpoint && (
                                <span className={`inline-flex items-center rounded-full border px-3 py-1 ${sessionHealthClassName(remoteSignatureCheckpoint.health)}`}>
                                    {remoteSignatureCheckpoint.health === 'recent'
                                        ? 'Firma remota osservata'
                                        : remoteSignatureCheckpoint.health === 'stale'
                                            ? 'Firma remota osservata in passato'
                                            : 'Firma remota non osservata'}
                                </span>
                            )}
                            {roleSelectionCheckpoint && (
                                <span className={`inline-flex items-center rounded-full border px-3 py-1 ${sessionHealthClassName(roleSelectionCheckpoint.health)}`}>
                                    {roleSelectionCheckpoint.health === 'recent'
                                        ? 'Ruolo operatore osservato'
                                        : roleSelectionCheckpoint.health === 'stale'
                                            ? 'Ruolo operatore osservato in passato'
                                            : 'Ruolo operatore non osservato'}
                                </span>
                            )}
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-slate-500">
                                Fonte: Atlas locale
                            </span>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <div className={`rounded-xl border px-3 py-3 ${sessionHealthClassName(sessionData.sessionHealth)}`}>
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ultimo modulo osservato</div>
                                <div className="mt-1 text-sm font-semibold text-slate-900">
                                    {sessionData.lastModule ? SISS_SESSION_OBSERVED_MODULE_LABELS[sessionData.lastModule] : 'Nessuno'}
                                </div>
                                <p className="mt-1 text-xs text-slate-600">
                                    {formatObservedAt(sessionData.lastModuleAt)}
                                </p>
                            </div>
                            {moduleCheckpoints.map((checkpoint) => (
                                <div
                                    key={checkpoint.key}
                                    className={`rounded-xl border px-3 py-3 ${sessionHealthClassName(checkpoint.health)}`}
                                >
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{checkpoint.label}</div>
                                    <div className="mt-1 text-sm font-semibold text-slate-900">
                                        {checkpoint.health === 'recent'
                                            ? 'Osservato di recente'
                                            : checkpoint.health === 'stale'
                                                ? 'Osservato in passato'
                                                : 'Non osservato'}
                                    </div>
                                    <p className="mt-1 text-xs text-slate-600">
                                        {formatObservedAt(checkpoint.observedAt)}
                                    </p>
                                </div>
                            ))}
                        </div>

                        {sessionData.warning && (
                            <p className="mt-3 text-xs font-medium text-amber-700">{sessionData.warning}</p>
                        )}
                    </>
                ) : (
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                        La cronologia Atlas locale non viene letta automaticamente. Usa il controllo manuale quando serve verificare una sessione SISS recente.
                    </p>
                )}
            </div>

            <div className="mt-4 rounded-2xl border border-white/70 bg-white/75 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                        <div className="text-sm font-semibold text-slate-900">Prontezza FSE locale</div>
                        <p className="text-xs leading-5 text-slate-600">
                            Questo controllo usa la validazione locale gia presente nel gestionale per stimare se il paziente e pronto per i profili FSE pilotati oggi.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void refreshFseReadiness()}
                        disabled={fseReadiness.loading}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                        {fseReadiness.loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                        Aggiorna
                    </button>
                </div>

                {fseReadiness.error ? (
                    <p className="mt-3 text-xs font-medium text-rose-700">{fseReadiness.error}</p>
                ) : validation ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className={`rounded-xl border px-3 py-3 ${
                            validation.therapyMedication.errorCount > 0
                                ? 'border-rose-200 bg-rose-50'
                                : validation.therapyMedication.warningCount > 0
                                    ? 'border-amber-200 bg-amber-50'
                                    : 'border-emerald-200 bg-emerald-50'
                        }`}>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Terapie</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">
                                {validation.therapyMedication.total} record
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                                {validation.therapyMedication.errorCount} errori, {validation.therapyMedication.warningCount} warning
                            </p>
                        </div>
                        <div className={`rounded-xl border px-3 py-3 ${
                            validation.observationVitals.errorCount > 0
                                ? 'border-rose-200 bg-rose-50'
                                : validation.observationVitals.warningCount > 0
                                    ? 'border-amber-200 bg-amber-50'
                                    : 'border-emerald-200 bg-emerald-50'
                        }`}>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Osservazioni</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">
                                {validation.observationVitals.total} record
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                                {validation.observationVitals.errorCount} errori, {validation.observationVitals.warningCount} warning
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {ACTIONS.map((item) => {
                    const Icon = item.icon;
                    const isLoading = activeAction === item.action;
                    const state = summary.actionStates.find((actionState) => actionState.action === item.action);

                    return (
                        <button
                            key={item.action}
                            type="button"
                            onClick={() => void startFlow(item.action)}
                            disabled={Boolean(activeAction) || !state?.available}
                            className="flex min-h-28 flex-col items-start justify-between rounded-2xl border border-white/70 bg-white/80 p-4 text-left shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                            <div className="flex w-full items-center justify-between gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-cyan-800">
                                    {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                                </div>
                                <ExternalLink className="h-4 w-4 text-slate-400" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                                <p className="text-xs leading-5 text-slate-600">{item.caption}</p>
                                {state?.reason && (
                                    <p className="text-[11px] font-medium text-amber-700">{state.reason}</p>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="mt-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                    Non ancora integrabile oggi
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {BLOCKED_CAPABILITIES.map((item) => (
                        <div
                            key={item.label}
                            className="flex min-h-28 flex-col items-start justify-between rounded-2xl border border-amber-100 bg-amber-50/70 p-4 text-left"
                        >
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                                <ShieldAlert className="h-4 w-4" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                                <p className="text-xs leading-5 text-slate-600">{item.caption}</p>
                                <p className="text-[11px] font-medium text-amber-700">{item.reason}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <p className="text-xs leading-5 text-slate-600">
                    Il salto da handoff assistito a integrazione nativa richiede un filone dedicato su qualifica SSI, canale A2A e requisiti regionali certificati.
                </p>
            </div>

            {feedback && (
                <div
                    className={`mt-4 rounded-2xl border px-3 py-2 text-sm ${
                        feedback.kind === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : feedback.kind === 'warning'
                                ? 'border-amber-200 bg-amber-50 text-amber-800'
                                : 'border-rose-200 bg-rose-50 text-rose-800'
                    }`}
                    aria-live="polite"
                >
                    <div className="flex items-start gap-2">
                        {feedback.kind === 'error' ? (
                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <div className="space-y-1">
                            <p>{feedback.message}</p>
                            {feedback.correlationId && (
                                <p className="font-mono text-xs opacity-80">
                                    Correlation ID: {feedback.correlationId}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
