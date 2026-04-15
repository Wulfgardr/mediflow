'use client';

/* @Codex */
import { useState } from 'react';
/* @Codex */
import { ExternalLink, FolderOpen, LoaderCircle, Search, ShieldAlert, ShieldCheck, SquareMenu } from 'lucide-react';
/* @Codex */
import { completeSissPortalHandoff } from '@/lib/siss';
/* @Codex */
import { buildSissPatientContextSummary, type SissPatientContextAction } from '@/lib/siss-patient-context-shared';

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

const ACTIONS: ContextActionConfig[] = [
    {
        action: 'prescription.create',
        label: 'Prescrizione',
        caption: 'Apri direttamente la compilazione prescrittiva con il CF pronto da incollare.',
        icon: ExternalLink,
    },
    {
        action: 'fse.lookup',
        label: 'FSE',
        caption: 'Apri il fascicolo con il CF del paziente pronto da incollare.',
        icon: FolderOpen,
    },
    {
        action: 'registry.lookup',
        label: 'Anagrafe',
        caption: 'Apri l\'anagrafe regionale con il CF del paziente pronto da incollare.',
        icon: Search,
    },
    {
        action: 'menu.open',
        label: 'Menu SISS',
        caption: 'Apri il menu SISS dalla sessione browser attiva.',
        icon: SquareMenu,
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

    const summary = buildSissPatientContextSummary({ patientTaxCode });
    const hasTaxCode = summary.patientFiscalCodeReady;

    const startFlow = async (action: SissPatientContextAction) => {
        setActiveAction(action);
        setFeedback(null);

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
            });

            setFeedback({
                kind: handoffResult.success ? 'success' : 'warning',
                message: `${payload.title}: ${handoffResult.message}`,
                correlationId: payload.correlationId,
            });
        } catch (error) {
            setFeedback({
                kind: 'error',
                message: error instanceof Error ? error.message : 'Errore inatteso nel flusso SISS',
            });
        } finally {
            setActiveAction(null);
        }
    };

    return (
        <div className="rounded-[28px] border border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-teal-50 p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-cyan-900">
                        <ShieldCheck className="h-4 w-4" />
                        Contesto paziente SISS
                    </div>
                    <p className="text-sm text-slate-700">
                        Apri rapidamente i moduli regionali del paziente dal gestionale con il codice fiscale pronto da incollare, dove disponibile.
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
                <span className={`inline-flex items-center rounded-full px-3 py-1 ${
                    summary.patientFiscalCodeReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}>
                    {summary.patientFiscalCodeReady ? 'CF paziente valido' : 'CF paziente mancante o non valido'}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-slate-500">
                    API certificate non disponibili
                </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
