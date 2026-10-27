'use client';

// WUL-297 Zona pericolo: isolated surface with explicit typed confirmation.

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import styles from '@/components/settings/maintenance-pages.module.css';
import { ViewState } from '@/components/ui/view-state';
import { SETTINGS_INPUT_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

const RESET_CONFIRM_KEYWORD = 'RESET';

export default function SettingsDangerZonePage() {
    const [confirmText, setConfirmText] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const [resetOutcome, setResetOutcome] = useState<'sessions_unconfirmed' | 'unknown' | null>(null);
    const { showToast } = useToast();
    const confirm = useConfirm();
    const confirmed = confirmText.trim().toUpperCase() === RESET_CONFIRM_KEYWORD;

    const resetOnboarding = async () => {
        if (!confirmed || isResetting || resetOutcome) return;
        const { confirmed: proceed } = await confirm({
            title: 'Ripristinare la configurazione iniziale?',
            message: 'Gli account saranno eliminati e sarà necessaria una nuova configurazione iniziale.',
            confirmLabel: 'Ripristina configurazione',
            tone: 'danger',
        });
        if (!proceed) return;
        setIsResetting(true);
        try {
            const res = await fetch('/api/auth/reset', { method: 'POST' });
            if (res.ok) {
                window.location.href = '/';
            } else {
                const outcome = await res.json().catch(() => null) as { code?: string } | null;
                if (res.status === 500 && outcome?.code === 'RESET_AUTHORITY_COMMIT_FAILED') setResetOutcome('sessions_unconfirmed');
                else if (res.status >= 500) setResetOutcome('unknown');
                else showToast({ tone: 'error', title: 'Errore durante il reset' });
            }
        } catch (e) {
            console.error(e);
            setResetOutcome('unknown');
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <section className={styles.page} data-testid="settings-danger-zone-section">
            <header className={styles.intro}><h2>Zona pericolo</h2><p>Operazioni che riportano la postazione a uno stato precedente. Richiedono riconfigurazione.</p></header>
            <section className={styles.section}>
                <h3 className={styles.heading}><AlertTriangle aria-hidden />Ripristina configurazione iniziale</h3>
                <p>Elimina gli account e richiede una nuova configurazione iniziale.</p>
                <label className={styles.fieldLabel}><span>Scrivi <strong>{RESET_CONFIRM_KEYWORD}</strong> per abilitare il reset.</span>
                    <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={RESET_CONFIRM_KEYWORD}
                        autoComplete="off" spellCheck={false} data-testid="danger-zone-confirm-input" className={SETTINGS_INPUT_CLASS} readOnly={isResetting} />
                </label>
                {resetOutcome && <div>
                    <ViewState state="error" title={resetOutcome === 'sessions_unconfirmed' ? 'Reset eseguito, ma la chiusura delle sessioni non è stata confermata.' : 'Esito del reset non confermato. Verifica l’accesso prima di procedere.'} />
                    <Link href="/settings/accesso" className={SETTINGS_SECONDARY_BUTTON_CLASS}>Accesso</Link>
                </div>}
                <div className={styles.actions}><button onClick={resetOnboarding} disabled={!confirmed || isResetting || resetOutcome !== null} data-testid="danger-zone-reset-button" className={SETTINGS_SECONDARY_BUTTON_CLASS}>{isResetting ? 'Reset in corso...' : 'Ripristina configurazione'}</button></div>
            </section>
        </section>
    );
}
