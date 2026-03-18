/* @Codex */
'use client';

import React from 'react';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
/* @Codex */
import type { AuthHealthPayload } from '@/lib/client-auth-api';

/* @Codex */
const formatBytes = (bytes?: number) => {
    if (bytes === undefined) return 'n/a';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${bytes} B`;
    return `${mb.toFixed(1)} MB`;
};

/* @Codex */
const formatBool = (value?: boolean) => {
    if (value === undefined) return 'n/a';
    return value ? 'si' : 'no';
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

    const details = [
        health.db?.dataDir ? ['Cartella dati', health.db.dataDir] : null,
        health.db?.dbPath ? ['Database', health.db.dbPath] : null,
        health.db?.dbSizeBytes !== undefined ? ['Dimensione DB', formatBytes(health.db.dbSizeBytes)] : null,
        health.db?.dbExists !== undefined ? ['DB presente', formatBool(health.db.dbExists)] : null,
        health.db?.dbReadable !== undefined ? ['DB leggibile', formatBool(health.db.dbReadable)] : null,
        health.db?.dbWritable !== undefined ? ['DB scrivibile', formatBool(health.db.dbWritable)] : null,
        health.db?.legacyDbPath ? ['DB legacy', health.db.legacyDbPath] : null,
        health.db?.legacyExists !== undefined ? ['Legacy presente', formatBool(health.db.legacyExists)] : null,
        health.db?.schemaOk !== undefined ? ['Schema ok', formatBool(health.db.schemaOk)] : null
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
                    {onRepair && health.db?.legacyExists && (
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
