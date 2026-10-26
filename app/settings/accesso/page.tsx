'use client';

// WUL-297 Accesso: PIN rotation moved from the monolithic settings page.

import { useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import { Disclosure } from '@/components/disclosure';
import styles from '@/components/settings/account-pages.module.css';
import { cn } from '@/lib/utils';
import { useSecurity } from '@/components/security-provider';
import { PassphraseAccessForm } from '@/components/recovery-kit';
import {
    SETTINGS_INPUT_CLASS,
    SETTINGS_LABEL_CLASS,
    SETTINGS_PRIMARY_BUTTON_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS,
} from '@/components/settings/settings-ui';

export default function SettingsAccessPage() {
    const { user, changePin, lock, unlockCredential, preparePassphraseChange } = useSecurity();
    // ADR 0143: on an account that unlocks with a passphrase the PIN no longer rotates the key wrapping.
    const passphrase = unlockCredential === 'passphrase';
    const [pinForm, setPinForm] = useState({ currentPin: '', newPin: '', confirmPin: '' });
    const [isChangingPin, setIsChangingPin] = useState(false);
    const [openForm, setOpenForm] = useState<'passphrase' | 'pin' | null>('passphrase');
    const [pinFeedback, setPinFeedback] = useState<null | { tone: 'success' | 'error'; message: string }>(null);

    const handleChangePin = async () => {
        setPinFeedback(null);

        if (pinForm.newPin !== pinForm.confirmPin) {
            setPinFeedback({ tone: 'error', message: 'La conferma del nuovo PIN non corrisponde.' });
            return;
        }

        setIsChangingPin(true);
        try {
            const result = await changePin(pinForm.currentPin, pinForm.newPin);
            if (!result.ok) {
                setPinFeedback({ tone: 'error', message: result.message });
                return;
            }

            setPinForm({ currentPin: '', newPin: '', confirmPin: '' });
            setPinFeedback({ tone: 'success', message: 'PIN aggiornato con successo. Usa il nuovo PIN dal prossimo sblocco.' });
        } finally {
            setIsChangingPin(false);
        }
    };

    return (
        <section className={styles.page} data-testid="settings-access-section">
            <header className={styles.intro}>
                <h2>Accesso</h2>
                <p>Passphrase, PIN e blocco della sessione.</p>
            </header>

            <Disclosure title={passphrase ? 'Sblocco con passphrase' : 'Passa dal PIN alla passphrase'} headingLevel={3}
                className={styles.section} open={openForm === 'passphrase'}
                onOpenChange={open => setOpenForm(open ? 'passphrase' : null)}>
                <div className={styles.form} data-testid={passphrase ? 'settings-access-passphrase' : 'settings-access-adopt'}>
                    {passphrase ? <>
                        <p className={styles.copy}>Questo archivio si sblocca con la passphrase. Il PIN resta per le conferme di revisione e di ruolo: non apre l’archivio.</p>
                        <p className={styles.copy}>Il cambio aggiorna passphrase e kit di recupero. Il PIN di conferma rimane separato e invariato.</p>
                    </> : <p className={styles.copy}>Il PIN attuale è una protezione transitoria. La passphrase aprirà l’archivio; il PIN resterà solo per le conferme. I backup e le copie Time Machine precedenti non vengono ripuliti. Dopo un ricaricamento, usa Rinnova accesso e inserisci di nuovo il PIN prima di preparare il kit.</p>}
                    <PassphraseAccessForm mode={passphrase ? 'change' : 'adopt'} onPrepare={preparePassphraseChange} />
                </div>
            </Disclosure>

            {!passphrase && <Disclosure title="Cambio PIN" headingLevel={3} className={styles.section}
                open={openForm === 'pin'} onOpenChange={open => setOpenForm(open ? 'pin' : null)}>
                <div className={styles.form} aria-busy={isChangingPin}>
                    <p className={styles.copy}>Ruota il PIN senza toccare la master key: i dati clinici restano leggibili.</p>
                    <div>
                        <label htmlFor="current-pin" className={SETTINGS_LABEL_CLASS}>PIN attuale</label>
                        <input id="current-pin" name="currentPin" type="password" inputMode="numeric"
                            value={pinForm.currentPin} onChange={e => setPinForm({ ...pinForm, currentPin: e.target.value })}
                            placeholder="Inserisci il PIN attuale" autoComplete="current-password" spellCheck={false} className={SETTINGS_INPUT_CLASS} />
                    </div>
                    <div>
                        <label htmlFor="new-pin" className={SETTINGS_LABEL_CLASS}>Nuovo PIN</label>
                        <input id="new-pin" name="newPin" type="password" inputMode="numeric"
                            value={pinForm.newPin} onChange={e => setPinForm({ ...pinForm, newPin: e.target.value })}
                            placeholder="4-8 caratteri" autoComplete="new-password" spellCheck={false} className={SETTINGS_INPUT_CLASS} />
                    </div>
                    <div>
                        <label htmlFor="confirm-pin" className={SETTINGS_LABEL_CLASS}>Conferma nuovo PIN</label>
                        <input id="confirm-pin" name="confirmPin" type="password" inputMode="numeric"
                            value={pinForm.confirmPin} onChange={e => setPinForm({ ...pinForm, confirmPin: e.target.value })}
                            placeholder="Ripeti il nuovo PIN" autoComplete="new-password" spellCheck={false} className={SETTINGS_INPUT_CLASS} />
                    </div>
                    {pinFeedback && <div role="status" className={cn('mf-alert text-xs', pinFeedback.tone === 'success' ? 'mf-alert-success' : 'mf-alert-critical')}>
                        {pinFeedback.message}
                    </div>}
                    <div className={styles.actions}>
                        <button onClick={handleChangePin} disabled={isChangingPin} className={SETTINGS_PRIMARY_BUTTON_CLASS}>
                            <Shield className="w-4 h-4" />{isChangingPin ? 'Aggiornamento...' : 'Aggiorna PIN'}
                        </button>
                    </div>
                </div>
            </Disclosure>}

            <section className={styles.section} aria-labelledby="settings-current-session-title">
                <h3 id="settings-current-session-title" className={styles.heading}>Sessione corrente</h3>
                <div className={styles.row}>
                    <div>
                        <p className={styles.strong}>{user?.displayName || 'Admin'}</p>
                        <p className={styles.copy}>{user?.ambulatoryName || 'Ambulatorio non impostato'}</p>
                        <p className={styles.copy}>Una sola sessione attiva su questa postazione. Il blocco richiede {passphrase ? 'la passphrase' : 'il PIN'} al prossimo accesso.</p>
                    </div>
                    <button type="button" onClick={() => lock()} className={SETTINGS_SECONDARY_BUTTON_CLASS}>
                        <Lock className="h-4 w-4" />{passphrase ? 'Blocca sessione adesso' : 'Rinnova accesso'}
                    </button>
                </div>
            </section>
        </section>
    );
}
