'use client';

// WUL-297 Sviluppo: moved from the monolithic settings page.

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
                kicker="Sistema"
                title="Sviluppo"
                description="Strumenti per collaudo e manutenzione: dati dimostrativi e avvio della shell nativa."
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="mf-section flex flex-col justify-between">
                    <div className="mb-3">
                        <p className="section-kicker">Sviluppo</p>
                        <h4 className="mt-1 text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Dati dimostrativi</h4>
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--lume-ink-muted)' }}>Genera pazienti e documenti sintetici per verificare la postazione.</p>
                    </div>
                    <div className="flex items-center justify-end">
                        <DataSeeder />
                    </div>
                </div>

                <div className="mf-section flex flex-col justify-between">
                    <div className="mb-3">
                        <p className="section-kicker">Desktop</p>
                        <h4 className="mt-1 text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>App nativa macOS</h4>
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--lume-ink-muted)' }}>Avvia la shell nativa quando disponibile sul sistema.</p>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <button
                            onClick={openNativeApp}
                            disabled={nativeLaunchState === 'loading'}
                            className="mf-btn-secondary lume-press disabled:text-[color:var(--lume-ink-muted)]"
                        >
                            {nativeLaunchState === 'loading' ? 'Avvio in corso...' : 'Apri app nativa'}
                        </button>
                        {nativeLaunchState === 'success' && (
                            <span className="text-xs" style={{ color: 'var(--lume-signal-success)' }}>Aperta</span>
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
