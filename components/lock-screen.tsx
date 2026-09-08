'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSecurity } from './security-provider';
import { AlertCircle, Loader2, Unlock } from 'lucide-react';
import styles from './kree8/kree8-lock-screen.module.css';

export function LockScreen() {
    const { isLocked, requiresSetup, authErrorMessage, authRecoveryState, login, setupPin, lock } = useSecurity();
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    // WUL-55: ref + nonce to restore focus to the credential field after a failed login.
    const pinInputRef = useRef<HTMLInputElement>(null);
    const [failedAttempt, setFailedAttempt] = useState(0);
    /* @Codex */
    const previousRecoveryState = useRef(authRecoveryState);

    // A failed login re-enables and clears the input; deterministically restore focus so the
    // operator can retry at once. Guards: !loading = input already enabled; optional chaining =
    // safe across unmount, so a successful login (which unmounts this form) never focuses.
    useEffect(() => {
        if ((failedAttempt > 0 || previousRecoveryState.current === 'pending')
            && !loading && authRecoveryState === 'ready') {
            pinInputRef.current?.focus();
        }
        previousRecoveryState.current = authRecoveryState;
    }, [failedAttempt, loading, authRecoveryState]);

    // If not locked and setup is done, don't render anything
    if (!isLocked && !requiresSetup) return null;

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        /* @Codex: Enter cannot bypass a pending or unconfirmed recovery. */
        if (authRecoveryState !== 'ready') return;
        setLoading(true);
        setError('');

        try {
            const success = await login(pin);
            if (!success) {
                setError('');
                setPin('');
                setFailedAttempt((n) => n + 1);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Errore durante il login');
            setPin('');
            setFailedAttempt((n) => n + 1);
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

    /* @Codex */
    const recoveryPending = authRecoveryState === 'pending';
    const credentialsDisabled = loading || authRecoveryState !== 'ready';
    const visibleError = error || authErrorMessage || (authRecoveryState === 'failed'
        ? 'Chiusura della sessione non confermata. Rinnova di nuovo l’accesso.' : '');
    const recoveryMessage = authRecoveryState === 'required'
        ? 'Una sessione è già attiva. Rinnova l’accesso per usare questa scheda.'
        : recoveryPending ? 'Sto chiudendo la sessione precedente…' : null;

    return (
        // @Codex WUL-55 F2d-A: lock chrome uses the landed Lume identity without changing auth semantics.
        <div className={styles.lockShell} aria-label="MediFlow lock screen">
            <section className={styles.lockCard} aria-labelledby="mediflow-lock-title">
                <div className={styles.brandRow}>
                    <span className={styles.brandMark}>MF</span>
                    <span className={styles.brandWord}>
                        MEDI<b>FLOW</b>
                    </span>
                </div>

                <div className={styles.headerBlock}>
                    <h1 id="mediflow-lock-title" className={styles.title}>
                        {requiresSetup ? 'Crea il tuo PIN' : 'Sblocca MediFlow'}
                    </h1>
                </div>

                <form onSubmit={requiresSetup ? handleSetup : handleLogin} className={styles.form}
                    aria-busy={loading || recoveryPending}>
                    {recoveryMessage && (
                        <p id="mediflow-auth-recovery" role="status" className="px-2 text-center text-sm leading-6">
                            {recoveryMessage}
                        </p>
                    )}
                    {/* @Codex WUL-55: keep the field name for assistive tech without repeating visible copy. */}
                    <label className="sr-only" htmlFor="mediflow-lock-pin">
                        {requiresSetup ? 'Nuovo PIN' : 'PIN operatore'}
                    </label>
                    <div className={styles.inputWrap}>
                        <input
                            id="mediflow-lock-pin"
                            ref={pinInputRef}
                            type="password"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className={styles.pinInput}
                            inputMode="text"
                            autoComplete="off"
                            aria-invalid={Boolean(visibleError)}
                            aria-describedby={visibleError ? 'mediflow-lock-error' : recoveryMessage ? 'mediflow-auth-recovery' : undefined}
                            disabled={credentialsDisabled}
                            autoFocus
                        />
                    </div>

                    {requiresSetup && (
                        <div className={styles.inputWrap}>
                            <label className="sr-only" htmlFor="mediflow-lock-pin-confirm">
                                Conferma PIN
                            </label>
                            <input
                                id="mediflow-lock-pin-confirm"
                                type="password"
                                placeholder="Conferma"
                                value={confirmPin}
                                onChange={(e) => setConfirmPin(e.target.value)}
                                className={styles.pinInput}
                                inputMode="text"
                                autoComplete="off"
                                aria-invalid={Boolean(visibleError)}
                                aria-describedby={visibleError ? 'mediflow-lock-error' : undefined}
                                disabled={credentialsDisabled}
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
                            credentialsDisabled
                            || pin.length < 4
                            || (requiresSetup && confirmPin.length < 4)
                        }
                        className={styles.primaryButton}
                    >
                        {loading || recoveryPending ? (
                            <>
                                <Loader2 className={styles.spinner} size={16} />
                                {recoveryPending ? 'Attendi la conferma…' : requiresSetup ? 'Sto configurando...' : 'Sto sbloccando...'}
                            </>
                        ) : requiresSetup ? (
                            'Imposta'
                        ) : (
                            <>
                                <Unlock size={16} /> Sblocca
                            </>
                        )}
                    </button>
                    {/* @Codex: renewal is explicit because the session may be shared with
                        another tab. The next PIN submission waits for the lock receipt. */}
                    {!requiresSetup && (visibleError || authRecoveryState !== 'ready') && (
                        <div className="text-center text-sm">
                            <button type="button" disabled={loading || recoveryPending}
                                className="min-h-11 px-4 py-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                                onClick={() => {
                                    setPin('');
                                    setError('');
                                    lock();
                                    setFailedAttempt((n) => n + 1);
                                }}>
                                Rinnova accesso
                            </button>
                            <p className="px-2 text-xs leading-5">Chiude la sessione condivisa con le altre schede. Poi inserisci di nuovo il PIN.</p>
                        </div>
                    )}
                </form>
            </section>
        </div>
    );
}
