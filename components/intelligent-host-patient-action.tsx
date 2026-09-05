'use client';

/* @Codex */

import { Sparkles } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import {
    IntelligentHostBrowserAdapterError,
    createIntelligentHostBrowserAdapter,
} from '@/lib/security/intelligent-host-browser-adapter';

type Phase = 'loading' | 'ready' | 'ready_resynced' | 'activating' | 'active'
    | 'resync_required' | 'resyncing' | 'host_unavailable' | 'session_unavailable'
    | 'outcome_unknown' | 'context_unavailable';
type ViewState = Readonly<{ phase: Phase; expiresAt?: number }>;
const quietButtonClassName = `${workspaceStyles.headerActionButton} min-w-11 sm:min-w-0 disabled:cursor-not-allowed disabled:opacity-[0.55]`;

function expiryLabel(expiresAt: number): string {
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(expiresAt));
}

function messageFor(state: ViewState): string {
    switch (state.phase) {
        case 'loading': return 'Preparazione dell’Host intelligente.';
        case 'ready': return 'Host intelligente pronto per l’attivazione.';
        case 'ready_resynced': return 'Selezione riallineata. Ora puoi attivare l’Host intelligente.';
        case 'activating': return 'Attivazione dell’Host intelligente in corso.';
        case 'active': return `Host intelligente attivo fino alle ${expiryLabel(state.expiresAt as number)}.`;
        case 'resync_required': return 'Selezione non più corrente. Riallineala prima di riprovare.';
        case 'resyncing': return 'Riallineamento della selezione in corso.';
        case 'host_unavailable': return 'Host intelligente non disponibile. Riavvia la sessione per ripartire.';
        case 'session_unavailable': return 'Sessione non disponibile. Sblocca o ricarica la scheda.';
        case 'outcome_unknown': return 'Esito non verificabile. Riavvia la sessione prima di riprovare.';
        case 'context_unavailable': return 'Host intelligente non disponibile: ambulatorio non associato alla scheda.';
        default: {
            const exhaustive: never = state.phase;
            return exhaustive;
        }
    }
}

/* @Codex */
export function IntelligentHostPatientAction({
    patientId,
    ambulatoryId,
}: Readonly<{ patientId: string; ambulatoryId: string | null }>) {
    const [client] = useState(() => createIntelligentHostBrowserAdapter());
    const [state, setState] = useState<ViewState>({ phase: 'loading' });
    const generation = useRef(0);
    const pending = useRef(false);
    const statusId = useId();
    const scope = ambulatoryId ? { patientId, ambulatoryId } : null;

    useEffect(() => {
        const token = ++generation.current;
        pending.current = false;
        client.reset();
        if (!patientId || !ambulatoryId) {
            setState({ phase: 'context_unavailable' });
            return () => {
                generation.current += 1;
                client.reset();
            };
        }
        setState({ phase: 'loading' });
        void client.initialize().then(() => {
            if (token === generation.current) setState({ phase: 'ready' });
        }).catch((error: unknown) => {
            if (token !== generation.current) return;
            const code = error instanceof IntelligentHostBrowserAdapterError ? error.code : null;
            setState({ phase: code === 'session_unavailable' ? 'session_unavailable'
                : code === 'operation_terminal' || code === 'host_unavailable'
                    ? 'host_unavailable' : 'resync_required' });
        });
        return () => {
            generation.current += 1;
            pending.current = false;
            client.reset();
        };
    }, [ambulatoryId, client, patientId]);

    const activate = async () => {
        if (!scope || pending.current
            || (state.phase !== 'ready' && state.phase !== 'ready_resynced')) return;
        pending.current = true;
        const token = ++generation.current;
        setState({ phase: 'activating' });
        try {
            const result = await client.activate(scope, true);
            if (token === generation.current) setState({ phase: 'active', expiresAt: result.expiresAt });
        } catch (error) {
            if (token !== generation.current) return;
            const code = error instanceof IntelligentHostBrowserAdapterError ? error.code : 'activation_outcome_unknown';
            setState({ phase: code === 'selection_resync_required' || code === 'selection_unavailable'
                ? 'resync_required' : code === 'host_unavailable' ? 'host_unavailable'
                    : code === 'session_unavailable' ? 'session_unavailable' : 'outcome_unknown' });
        } finally {
            if (token === generation.current) pending.current = false;
        }
    };

    const resync = async () => {
        if (state.phase !== 'resync_required' || pending.current) return;
        pending.current = true;
        const token = ++generation.current;
        setState({ phase: 'resyncing' });
        try {
            await client.resync();
            if (token === generation.current) setState({ phase: 'ready_resynced' });
        } catch (error) {
            if (token !== generation.current) return;
            const code = error instanceof IntelligentHostBrowserAdapterError ? error.code : null;
            setState({ phase: code === 'session_unavailable' ? 'session_unavailable'
                : code === 'operation_terminal' || code === 'host_unavailable'
                    ? 'host_unavailable' : 'resync_required' });
        } finally {
            if (token === generation.current) pending.current = false;
        }
    };

    const canActivate = Boolean(scope) && (state.phase === 'ready' || state.phase === 'ready_resynced');
    const showPanel = !['loading', 'ready', 'activating'].includes(state.phase);
    const message = messageFor(state);
    const label = state.phase === 'active' ? 'Host attivo'
        : state.phase === 'activating' ? 'Attivazione…' : 'Attiva host';
    const accessibleLabel = state.phase === 'active' ? 'Intelligent Host attivo per questa scheda'
        : state.phase === 'host_unavailable' || state.phase === 'session_unavailable'
            || state.phase === 'outcome_unknown' || state.phase === 'context_unavailable'
            ? 'Intelligent Host non disponibile per questa scheda'
            : state.phase === 'activating' ? 'Attivazione di Intelligent Host per questa scheda'
                : 'Attiva Intelligent Host per questa scheda';

    return (
        <div className={workspaceStyles.headerActionsMenu} data-testid="intelligent-host-patient-action">
            <button
                type="button"
                className={quietButtonClassName}
                data-lume-action="quiet"
                disabled={!canActivate}
                aria-busy={state.phase === 'activating' || state.phase === 'resyncing' || undefined}
                aria-describedby={statusId}
                aria-label={accessibleLabel}
                title={accessibleLabel}
                onClick={activate}
            >
                <Sparkles size={14} aria-hidden="true" />
                <span className="hidden sm:inline">{label}</span>
            </button>
            {showPanel ? (
                <div className={`mf-popover ${workspaceStyles.headerActionsPopover} w-64 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-xs`}>
                    <p id={statusId} role="status" aria-live="polite" aria-atomic="true">{message}</p>
                    {state.phase === 'resync_required' || state.phase === 'resyncing' ? (
                        <button
                            type="button"
                            className={quietButtonClassName}
                            data-lume-action="quiet"
                            disabled={state.phase === 'resyncing'}
                            onClick={resync}
                        >
                            Riallinea selezione
                        </button>
                    ) : null}
                </div>
            ) : (
                <span id={statusId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {message}
                </span>
            )}
        </div>
    );
}
