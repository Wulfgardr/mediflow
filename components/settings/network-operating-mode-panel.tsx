/* @Codex */
'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, Loader2, Network, RefreshCw, Server, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
/* @Codex */
import {
    deriveNetworkOperatingModeViewModel,
    type NetworkOverviewPayload,
} from '@/lib/network-operating-mode';

const INPUT_SEGMENT_CLASS = 'inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors';

function Badge({
    children,
    tone = 'neutral',
}: {
    children: ReactNode;
    tone?: 'neutral' | 'success' | 'warning' | 'preview';
}) {
    const toneClass = {
        neutral: 'border-slate-200/80 bg-white/76 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
        success: 'border-slate-200/80 bg-white/76 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200',
        warning: 'border-slate-200/80 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200',
        preview: 'border-slate-200/80 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200',
    }[tone];

    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold', toneClass)}>
            {children}
        </span>
    );
}

export default function NetworkOperatingModePanel() {
    const [overview, setOverview] = useState<NetworkOverviewPayload | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSavingMode, setIsSavingMode] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadOverview = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/system/network-overview', { cache: 'no-store' });
            if (!response.ok) throw new Error('overview failed');
            const data = await response.json() as NetworkOverviewPayload;
            setOverview(data);
        } catch (fetchError) {
            console.error(fetchError);
            setError('Impossibile leggere lo stato rete del nodo locale.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadOverview();
    }, []);

    const viewModel = useMemo(
        () => (overview ? deriveNetworkOperatingModeViewModel(overview) : null),
        [overview]
    );

    const setOperatingMode = async (nextMode: 'local-only' | 'network-home-base') => {
        if (!overview || isSavingMode) return;
        setIsSavingMode(true);
        setError(null);
        try {
            const response = await fetch('/api/settings/network.mode', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: nextMode }),
            });
            if (!response.ok) throw new Error('save failed');
            await loadOverview();
        } catch (saveError) {
            console.error(saveError);
            setError('Impossibile aggiornare la modalità operativa.');
        } finally {
            setIsSavingMode(false);
        }
    };

    return (
        <div className="apple-subsection min-w-[260px] sm:col-span-2">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="section-kicker">Modalità operativa</p>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                        {viewModel?.currentState.title ?? 'Lettura stato nodo'}
                    </h3>
                    <p className="mt-2 max-w-3xl text-xs leading-6 text-slate-500 dark:text-slate-400">
                        {viewModel?.currentState.description ?? 'Lettura dello stato del nodo in corso.'}
                    </p>
                </div>
                {isLoading ? (
                    <Badge tone="neutral">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Lettura
                    </Badge>
                ) : viewModel ? (
                    <Badge tone={viewModel.currentState.preview ? 'preview' : 'success'}>
                        {viewModel.currentState.preview ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                        {viewModel.currentState.badge}
                    </Badge>
                ) : null}
            </div>

            <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                    type="button"
                    disabled={isSavingMode || isLoading}
                    onClick={() => void setOperatingMode('local-only')}
                    className={cn(
                        INPUT_SEGMENT_CLASS,
                        overview?.session.operatingMode === 'local-only'
                            ? 'border-slate-300 bg-slate-50 text-slate-900 dark:border-white/20 dark:bg-white/10 dark:text-slate-100'
                            : 'border-slate-200/80 bg-white/76 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
                    )}
                >
                    <Shield className="h-3.5 w-3.5" />
                    Locale
                </button>
                <button
                    type="button"
                    disabled={isSavingMode || isLoading}
                    onClick={() => void setOperatingMode('network-home-base')}
                    className={cn(
                        INPUT_SEGMENT_CLASS,
                        overview?.session.operatingMode === 'network-home-base'
                            ? 'border-slate-300 bg-slate-50 text-slate-900 dark:border-white/20 dark:bg-white/10 dark:text-slate-100'
                            : 'border-slate-200/80 bg-white/76 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
                    )}
                >
                    {isSavingMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
                    Home-base
                    <Badge tone="preview">Guidata</Badge>
                </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[18px] border border-white/70 bg-white/72 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <Server className="h-3.5 w-3.5" />
                        Nodo centrale
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{overview?.node.displayName ?? 'Nodo locale'}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{viewModel?.nodeStatusLabel ?? 'Locale'}</p>
                </div>
                <div className="rounded-[18px] border border-white/70 bg-white/72 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <RefreshCw className="h-3.5 w-3.5" />
                        Attivazione
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.activationReasonLabel ?? 'Default locale'}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Pairing: {viewModel?.pairingLabel ?? 'Disabilitato'}</p>
                </div>
                <div className="rounded-[18px] border border-white/70 bg-white/72 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <Cpu className="h-3.5 w-3.5" />
                        AI di nodo
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.aiRuntimeLabel ?? 'AI locale'}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{viewModel?.aiLocalRuntimeLabel ?? 'Ollama locale del nodo'}</p>
                </div>
                <div className="rounded-[18px] border border-white/70 bg-white/72 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <Network className="h-3.5 w-3.5" />
                        Replica snapshot
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.currentReplicaState.label ?? 'Backup locale'}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Azione: {viewModel?.replicaPendingActionLabel ?? 'Nessuna'}</p>
                </div>
            </div>

            <div className="mt-5 grid gap-3 xl:grid-cols-2">
                {viewModel?.stateCatalog.map((state) => (
                    <div
                        key={state.code}
                        className={cn(
                            'rounded-[18px] border p-4 transition-colors',
                            state.code === viewModel.currentState.code
                                ? 'border-slate-300 bg-slate-50/80 dark:border-white/20 dark:bg-white/10'
                                : 'border-white/70 bg-white/68 dark:border-white/10 dark:bg-white/5'
                        )}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{state.label}</p>
                            <Badge tone={state.preview ? 'preview' : 'success'}>{state.badge}</Badge>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{state.description}</p>
                    </div>
                ))}
            </div>

            <div className="mt-5 rounded-[20px] border border-white/70 bg-white/66 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">AI locale opzionale</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {viewModel?.aiRuntimeDescription ?? 'Funzione opzionale separata dai dati clinici.'}
                        </p>
                    </div>
                    <Badge tone={
                        viewModel?.aiCapabilityStatus === 'available'
                            ? 'success'
                            : viewModel?.aiCapabilityStatus === 'unavailable'
                                ? 'warning'
                                : 'neutral'
                    }>
                        {viewModel?.aiRuntimeLabel ?? 'AI locale'}
                    </Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Motore locale</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.aiLocalRuntimeLabel ?? 'Ollama locale del nodo'}</p>
                    </div>
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Fallback</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.aiFallbackLabel ?? 'AI non disponibile'}</p>
                    </div>
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Attivazione</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.aiRolloutGateLabel ?? 'Benchmark prima del rollout'}</p>
                    </div>
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Superfici</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.aiSurfaceLabels.join(' / ') ?? 'Patient Insight / Smart Import / Document Synthesis'}</p>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    {viewModel?.aiGuardrails.map((item) => (
                        <Badge key={item} tone="warning">{item}</Badge>
                    ))}
                </div>
            </div>

            <div className="mt-5 rounded-[20px] border border-white/70 bg-white/66 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Replica snapshot governata</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {viewModel?.backupBoundaryLabel ?? 'Il backup v1 resta separato dal mirror di rete'}
                        </p>
                    </div>
                    <Badge tone={viewModel?.currentReplicaState.preview ? 'preview' : 'success'}>
                        {viewModel?.currentReplicaState.badge ?? 'Reale'}
                    </Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Authority</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.replicaAuthorityLabel ?? 'Dispositivo locale'}</p>
                    </div>
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Conflitti</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.replicaConflictModelLabel ?? 'Preflight restore + version check'}</p>
                    </div>
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Ultimo riallineamento</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.lastSyncLabel ?? 'Non ancora disponibile'}</p>
                    </div>
                </div>
            </div>

            <div className="mt-5 rounded-[20px] border border-white/70 bg-white/66 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Profilo rete locale</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {viewModel?.identityPairingBoundaryLabel ?? 'Il pairing del device non sostituisce il login operatore'}
                        </p>
                    </div>
                    <Badge tone={viewModel?.identityCredentialLabel === 'Sessione operatore attiva' ? 'success' : 'warning'}>
                        {viewModel?.identityCredentialLabel ?? 'Credenziali nodo richieste'}
                    </Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Operatore</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.identityOperatorLabel ?? 'Operatore non ancora legato al nodo'}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{viewModel?.identityLoginModeLabel ?? 'PIN-only se esiste un solo account locale'}</p>
                    </div>
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Scope effettivo</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.identityScopeLabel ?? 'Nessun ambulatorio effettivo'}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Origine: {viewModel?.identityScopeSourceLabel ?? 'Nessuna risoluzione'}</p>
                    </div>
                    <div className="rounded-[16px] border border-white/70 bg-white/72 p-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Audit</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{viewModel?.identityAuditLabel ?? 'Solo token di trasporto'}</p>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    {viewModel?.identityLimitations.map((item) => (
                        <Badge key={item} tone="warning">{item}</Badge>
                    ))}
                </div>
            </div>

            <div className="mt-5 grid gap-3 xl:grid-cols-2">
                {viewModel?.replicaStateCatalog.map((state) => (
                    <div
                        key={state.code}
                        className={cn(
                            'rounded-[18px] border p-4 transition-colors',
                            state.code === viewModel.currentReplicaState.code
                                ? 'border-slate-300 bg-slate-50/80 dark:border-white/20 dark:bg-white/10'
                                : 'border-white/70 bg-white/68 dark:border-white/10 dark:bg-white/5'
                        )}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{state.label}</p>
                            <Badge tone={state.preview ? 'preview' : 'success'}>{state.badge}</Badge>
                        </div>
                        <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-200">{state.title}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{state.description}</p>
                    </div>
                ))}
            </div>

            {error ? (
                <div className="mt-4 rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                    {error}
                </div>
            ) : null}
        </div>
    );
}
