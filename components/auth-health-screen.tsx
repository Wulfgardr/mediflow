/* @Codex */
'use client';

import React from 'react';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
/* @Codex */
import type { AuthHealthPayload } from '@/lib/security/client-auth-api';

/* @Codex */
type AuthDbState = NonNullable<NonNullable<AuthHealthPayload['db']>['state']>;

/* @Codex */
const formatDbState = (state?: AuthDbState) => {
    switch (state) {
        case 'ready':
            return 'pronto';
        case 'missing':
            return 'assente';
        case 'schema-missing':
            return 'schema mancante';
        case 'unavailable':
            return 'non disponibile';
        default:
            return 'n/d';
    }
};

/* @Codex */
export function AuthHealthScreen({
    health,
    onRetry,
    onRepair,
    isRepairing
}: {
    health: AuthHealthPayload;
    onRetry: () => void;
    /* @Codex */
    onRepair?: () => void;
    /* @Codex */
    isRepairing?: boolean;
}) {
    /* @Codex */
    const friendlyMessage = (() => {
        switch (health.error?.code) {
            case 'DB_NATIVE_DEPENDENCY_INVALID':
                return 'Modulo nativo SQLite incompatibile con il runtime Node corrente (mismatch ABI). È necessario ricompilarlo.';
            case 'DB_NATIVE_DEPENDENCY_MISSING':
                return 'Modulo nativo SQLite mancante. Reinstalla le dipendenze.';
            case 'DB_MISSING':
                return 'Database locale non trovato. Verifica la cartella dati o ripristina un backup.';
            case 'DB_SCHEMA_MISSING':
                return 'Schema del database mancante. Ripristina un DB valido o esegui le migrazioni.';
            case 'DB_QUERY_FAILED':
                return 'Impossibile leggere il database locale. Verifica permessi e integrità del file.';
            case 'DATA_DIR_UNAVAILABLE':
                return 'Cartella dati non accessibile. Verifica permessi e percorso.';
            case 'AUTH_CHECK_FAILED':
                return 'Impossibile verificare lo stato di sicurezza.';
            default:
                return health.error?.message || 'Impossibile verificare lo stato del database locale.';
        }
    })();

    /* @Codex */
    const remediationCommand = health.error?.remediationCommand;
    /* @Codex */
    const nextAction = health.error?.nextAction;

    const details = [
        health.db?.state ? ['Stato archivio', formatDbState(health.db.state)] : null,
        health.error?.category ? ['Categoria', health.error.category] : null,
    ].filter(Boolean) as Array<[string, string]>;

    return (
        <div className="fixed inset-0 z-[100] flex h-screen w-screen items-center justify-center bg-[color:var(--lume-surface-canvas)] p-6">
            <div className="lume-focal w-full max-w-2xl space-y-6 rounded-[var(--lume-radius-panel)] border p-8" style={{ borderColor: 'color-mix(in srgb, var(--lume-ink) 14%, transparent)', background: 'var(--lume-surface-focal)', boxShadow: '0 12px 30px color-mix(in srgb, var(--lume-ink) 20%, transparent)' }}>
                <div className="flex items-start gap-4">
                    <div className="p-3 rounded-2xl bg-orange-100 text-orange-600">
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div className="space-y-2">
                        <h1 className="text-2xl font-bold" style={{ color: 'var(--lume-ink)' }}>Problema Database</h1>
                        <p className="text-sm" style={{ color: 'var(--lume-ink-muted)' }}>{friendlyMessage}</p>
                        {health.error?.code && (
                            <p className="lume-registro text-xs text-orange-700">Codice: {health.error.code}</p>
                        )}
                    </div>
                </div>

                {/* @Codex */}
                {nextAction && (
                    <div className="rounded-2xl border border-orange-100 bg-orange-50/60 p-4 text-sm text-gray-700">
                        <div className="font-semibold text-orange-800 mb-1">Prossima azione</div>
                        <p>{nextAction}</p>
                    </div>
                )}

                {/* @Codex */}
                {remediationCommand && (
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <div className="mb-2 text-xs font-semibold" style={{ color: 'var(--lume-ink-muted)' }}>Comando consigliato (esegui manualmente nel terminale)</div>
                        <code className="lume-registro block break-all whitespace-pre-wrap select-all text-xs" style={{ color: 'var(--lume-ink)' }}>
                            {remediationCommand}
                        </code>
                        <p className="mt-2 text-[11px]" style={{ color: 'var(--lume-ink-muted)' }}>
                            Esegui il comando con lo stesso runtime Node usato per avviare MediFlow. Non eseguito automaticamente per sicurezza.
                        </p>
                    </div>
                )}

                {details.length > 0 && (
                    <div className="rounded-[var(--lume-radius-card)] border bg-[color:var(--lume-surface-field)] p-4" style={{ borderColor: 'color-mix(in srgb, var(--lume-ink) 12%, transparent)' }}>
                        <div className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>
                            <Database className="w-4 h-4 text-orange-500" />
                            Dettagli locale
                        </div>
                        <div className="grid grid-cols-1 gap-2 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                            {details.map(([label, value]) => (
                                <div key={label} className="flex items-center justify-between gap-4">
                                    <span>{label}</span>
                                    <span className="lume-registro break-all" style={{ color: 'var(--lume-ink)' }}>{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={onRetry}
                        className="ui-btn-primary lume-press px-4 py-2 text-sm"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Riprova controllo
                    </button>
                    {/* @Codex */}
                    {onRepair && (
                        <button
                            onClick={onRepair}
                            disabled={isRepairing}
                            className="mf-btn-secondary lume-press px-4 py-2 text-sm disabled:opacity-60"
                        >
                            {isRepairing ? 'Ripristino in corso...' : 'Ripristina DB da legacy'}
                        </button>
                    )}
                </div>

                <p className="text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                    Se hai usato strumenti di pulizia, verifica che la cartella dati e il file{' '}
                    <code className="lume-registro text-[11px]" style={{ color: 'var(--lume-ink)' }}>medical.db</code> non siano
                    stati rimossi o spostati. In caso di dubbi, ripristina un backup locale.
                </p>
            </div>
        </div>
    );
}
