'use client';

// WUL-297 — Sviluppo: moved from the monolithic settings page.

import { useState } from 'react';
import DataSeeder from '@/components/data-seeder';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsDevelopmentPage() {
    // @Codex
    const [nativeLaunchState, setNativeLaunchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    // @Codex
    const openNativeApp = async () => {
        if (nativeLaunchState === 'loading') return;
        setNativeLaunchState('loading');
        try {
            const res = await fetch('/api/system/native', { method: 'POST' });
            if (!res.ok) throw new Error('Launch failed');
            setNativeLaunchState('success');
            window.setTimeout(() => setNativeLaunchState('idle'), 2000);
        } catch (e) {
            console.error("Native app launch failed", e);
            setNativeLaunchState('error');
        }
    };

    return (
        <section className="space-y-4" data-testid="settings-development-section">
            <SettingsSectionIntro
                kicker="Avanzate"
                title="Sviluppo"
                description="Strumenti per collaudo e manutenzione: dati dimostrativi e avvio della shell nativa."
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="apple-subsection flex flex-col justify-between">
                    <div className="mb-3">
                        <p className="section-kicker">Sviluppo</p>
                        <h4 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Dati dimostrativi</h4>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Genera pazienti e documenti sintetici per verificare la postazione.</p>
                    </div>
                    <div className="flex items-center justify-end">
                        <DataSeeder />
                    </div>
                </div>

                <div className="apple-subsection flex flex-col justify-between">
                    <div className="mb-3">
                        <p className="section-kicker">Desktop</p>
                        <h4 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">App nativa macOS</h4>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Avvia la shell nativa quando disponibile sul sistema.</p>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <button
                            onClick={openNativeApp}
                            disabled={nativeLaunchState === 'loading'}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/76 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10 disabled:text-slate-400"
                        >
                            {nativeLaunchState === 'loading' ? 'Avvio in corso...' : 'Apri app nativa'}
                        </button>
                        {nativeLaunchState === 'success' && (
                            <span className="text-xs text-slate-600 dark:text-slate-300">Aperta</span>
                        )}
                        {nativeLaunchState === 'error' && (
                            <span className="text-xs text-red-600">Errore</span>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
