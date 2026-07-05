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
        <div className="h-screen w-screen fixed inset-0 z-[100] bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center p-6">
            <div className="w-full max-w-2xl rounded-3xl border border-orange-100 bg-white/80 backdrop-blur-xl shadow-2xl p-8 space-y-6">
                <div className="flex items-start gap-4">
                    <div className="p-3 rounded-2xl bg-orange-100 text-orange-600">
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div className="space-y-2">
                        <h1 className="text-2xl font-bold text-gray-800">Problema Database</h1>
                        <p className="text-sm text-gray-600">{friendlyMessage}</p>
                        {health.error?.code && (
                            <p className="text-xs text-orange-700 font-mono">Codice: {health.error.code}</p>
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
                        <div className="text-xs font-semibold text-gray-600 mb-2">Comando consigliato (esegui manualmente nel terminale)</div>
                        <code className="block font-mono text-xs text-gray-900 break-all whitespace-pre-wrap select-all">
                            {remediationCommand}
                        </code>
                        <p className="text-[11px] text-gray-500 mt-2">
                            Esegui il comando con lo stesso runtime Node usato per avviare MediFlow. Non eseguito automaticamente per sicurezza.
                        </p>
                    </div>
                )}

                {details.length > 0 && (
                    <div className="rounded-2xl border border-orange-100 bg-white p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                            <Database className="w-4 h-4 text-orange-500" />
                            Dettagli locale
                        </div>
                        <div className="grid grid-cols-1 gap-2 text-xs text-gray-600">
                            {details.map(([label, value]) => (
                                <div key={label} className="flex items-center justify-between gap-4">
                                    <span className="text-gray-500">{label}</span>
                                    <span className="font-mono text-gray-800 break-all">{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={onRetry}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-600 text-white text-sm font-semibold shadow hover:bg-orange-700"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Riprova controllo
                    </button>
                    {/* @Codex */}
                    {onRepair && (
                        <button
                            onClick={onRepair}
                            disabled={isRepairing}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold shadow hover:bg-gray-800 disabled:opacity-60"
                        >
                            {isRepairing ? 'Ripristino in corso...' : 'Ripristina DB da legacy'}
                        </button>
                    )}
                </div>

                <p className="text-xs text-gray-500">
                    Se hai usato strumenti di pulizia, verifica che la cartella dati e il file{' '}
                    <code className="font-mono text-[11px] text-gray-700">medical.db</code> non siano
                    stati rimossi o spostati. In caso di dubbi, ripristina un backup locale.
                </p>
            </div>
        </div>
    );
}
