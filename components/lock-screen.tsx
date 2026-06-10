'use client';

import React, { useState } from 'react';
import { useSecurity } from './security-provider';
import { AlertCircle, KeyRound, Loader2, ShieldCheck, Unlock } from 'lucide-react';
import styles from './kree8/kree8-lock-screen.module.css';

export function LockScreen() {
    const { isLocked, requiresSetup, authErrorMessage, login, setupPin } = useSecurity();
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // If not locked and setup is done, don't render anything
    if (!isLocked && !requiresSetup) return null;

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const success = await login(pin);
            if (!success) {
                setError('');
                setPin('');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Errore durante il login');
            setPin('');
        } finally {
            setLoading(false);
        }
    };

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (pin.length < 4) {
            setError('Il PIN deve essere di almeno 4 caratteri');
            return;
        }
        if (pin !== confirmPin) {
            setError('I PIN non corrispondono');
            return;
        }

        setLoading(true);
        try {
            await setupPin(pin);
        } catch (err) {
            setError('Errore durante il setup');
        } finally {
            setLoading(false);
        }
    };

    const visibleError = error || authErrorMessage;

    return (
        // @Codex WUL-274: lock chrome mirrors the Kree8 live root without changing auth semantics.
        <div className={styles.lockShell} aria-label="MediFlow lock screen">
            <section className={styles.lockCard} aria-labelledby="mediflow-lock-title">
                <div className={styles.brandRow}>
                    <span className={styles.brandMark}>MF</span>
                    <span className={styles.brandWord}>
                        MEDI<b>FLOW</b>
                    </span>
                    <span className={styles.statusPill}>
                        {requiresSetup ? 'setup locale' : 'PIN richiesto'}
                    </span>
                </div>

                <div className={styles.headerBlock}>
                    <div className={styles.kicker}>
                        {requiresSetup ? (
                            <>
                                <ShieldCheck size={13} /> Prima configurazione
                            </>
                        ) : (
                            <>
                                <KeyRound size={13} /> Sessione protetta
                            </>
                        )}
                    </div>
                    <h1 id="mediflow-lock-title" className={styles.title}>
                        {requiresSetup ? 'Crea il tuo PIN' : 'Sblocca MediFlow'}
                    </h1>
                    <p className={styles.subtitle}>
                        {requiresSetup
                            ? 'Crea un PIN per proteggere la sessione locale e la master key.'
                            : 'Sessione bloccata · inserisci il PIN per riprendere il lavoro.'}
                    </p>
                </div>

                <form onSubmit={requiresSetup ? handleSetup : handleLogin} className={styles.form}>
                    <label className={styles.fieldLabel} htmlFor="mediflow-lock-pin">
                        PIN operatore
                    </label>
                    <div className={styles.inputWrap}>
                        <input
                            id="mediflow-lock-pin"
                            type="password"
                            placeholder="Inserisci PIN"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className={styles.pinInput}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="off"
                            aria-invalid={Boolean(visibleError)}
                            aria-describedby={visibleError ? 'mediflow-lock-error' : undefined}
                            disabled={loading}
                            autoFocus
                        />
                    </div>

                    {requiresSetup && (
                        <div className={styles.inputWrap}>
                            <input
                                type="password"
                                placeholder="Conferma PIN"
                                value={confirmPin}
                                onChange={(e) => setConfirmPin(e.target.value)}
                                className={styles.pinInput}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoComplete="off"
                                aria-invalid={Boolean(visibleError)}
                                aria-describedby={visibleError ? 'mediflow-lock-error' : undefined}
                                disabled={loading}
                            />
                        </div>
                    )}

                    {visibleError && (
                        <div
                            key={visibleError}
                            id="mediflow-lock-error"
                            className={styles.errorChip}
                            role="status"
                            aria-live="polite"
                        >
                            <AlertCircle size={12} />
                            <span>{visibleError}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={
                            loading
                            || pin.length < 4
                            || (requiresSetup && confirmPin.length < 4)
                        }
                        className={styles.primaryButton}
                    >
                        {loading ? (
                            <>
                                <Loader2 className={styles.spinner} size={16} />
                                {requiresSetup ? 'Sto configurando...' : 'Sto sbloccando...'}
                            </>
                        ) : requiresSetup ? (
                            'Imposta PIN'
                        ) : (
                            <>
                                <Unlock size={16} /> Sblocca
                            </>
                        )}
                    </button>
                </form>

                <footer className={styles.footer}>
                    <span>Sessione locale</span>
                    <span>Nessun trasferimento di rete</span>
                    <span>Zero-knowledge</span>
                </footer>
            </section>
        </div>
    );
}
