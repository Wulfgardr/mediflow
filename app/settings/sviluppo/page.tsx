'use client';

// WUL-297 Sviluppo: moved from the monolithic settings page.

import { useState } from 'react';
import DataSeeder from '@/components/data-seeder';
import styles from '@/components/settings/maintenance-pages.module.css';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';

export default function SettingsDevelopmentPage() {
    const [nativeLaunchState, setNativeLaunchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

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
        <section className={styles.page} data-testid="settings-development-section">
            <header className={styles.intro}><h2>Sviluppo</h2><p>Strumenti per collaudo e manutenzione: dati dimostrativi e avvio della shell nativa.</p></header>
            <DataSeeder />
            <section className={styles.section} aria-labelledby="native-launch-title">
                <h3 id="native-launch-title" className={styles.heading}>Applicazione nativa</h3>
                <p>Avvia la shell nativa quando disponibile sul sistema.</p>
                <div className={styles.actions}>
                    <button onClick={openNativeApp} disabled={nativeLaunchState === 'loading'} className={SETTINGS_SECONDARY_BUTTON_CLASS}>{nativeLaunchState === 'loading' ? 'Avvio in corso...' : 'Apri applicazione nativa'}</button>
                    {nativeLaunchState === 'success' && <p role="status">Richiesta di apertura inviata.</p>}
                    {nativeLaunchState === 'error' && <p role="alert">Impossibile inviare la richiesta di apertura.</p>}
                </div>
            </section>
        </section>
    );
}
