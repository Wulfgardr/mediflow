'use client';

/* @Codex */
import { useState } from 'react';
import { ExternalLink, LoaderCircle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { completeSissPortalHandoff, prepareSissPortalWindow } from '@/lib/siss';

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
    mode: 'portal-handoff' | 'certified-api';
    handoffUrl: string;
    clipboardText: string | null;
    correlationId: string;
    message: string;
};

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
        'mode' in value &&
        (value.mode === 'portal-handoff' || value.mode === 'certified-api')
    );
}

export default function SissPrescriptionPanel({ patientId, patientTaxCode }: Props) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [feedback, setFeedback] = useState<FeedbackState | null>(null);

    const hasTaxCode = /^[A-Z0-9]{11,16}$/.test((patientTaxCode ?? '').trim().toUpperCase());

    const startFlow = async () => {
        setIsSubmitting(true);
        setFeedback(null);

        const popupWindow = prepareSissPortalWindow();
        if (!popupWindow) {
            setFeedback({
                kind: 'error',
                message: 'Il browser ha bloccato l\'apertura del portale SISS. Consenti i popup e riprova.',
            });
            setIsSubmitting(false);
            return;
        }

        try {
            const response = await fetch('/api/siss/prescription', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ patientId }),
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
                message: handoffResult.message,
                correlationId: payload.correlationId,
            });
        } catch (error) {
            popupWindow.close();
            setFeedback({
                kind: 'error',
                message: error instanceof Error ? error.message : 'Errore inatteso nel flusso SISS',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                        <ShieldCheck className="h-4 w-4" />
                        Modulo Prescrittivo Regionale
                    </div>
                    <p className="text-sm text-slate-700">
                        Avvia il flusso dal backend locale e apri la webapp ufficiale del Modulo Prescrittivo Regionale con il codice fiscale pronto da incollare.
                    </p>
                    <p className="text-xs leading-5 text-slate-600">
                        Questa slice resta webapp-assisted: MediFlow prepara il contesto paziente, ma l'atto prescrittivo resta nella sessione SISS ufficiale.
                    </p>
                    {!hasTaxCode && (
                        <p className="text-xs font-medium text-amber-700">
                            Serve un codice fiscale valido nel profilo paziente prima di procedere.
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={startFlow}
                    disabled={isSubmitting || !hasTaxCode}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                    {isSubmitting ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                        <ExternalLink className="h-4 w-4" />
                    )}
                    Apri modulo prescrittivo
                </button>
            </div>

            {feedback && (
                <div
                    className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
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
