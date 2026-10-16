'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSecurity } from './security-provider';
import { PassphraseAccessForm } from './recovery-kit';
import { AlertCircle, Loader2, Unlock } from 'lucide-react';
import { checkPassphrase } from '@/lib/security/unlock-credential';
import { LONG_PIN_CONFIRM_LABEL, LONG_PIN_NOTICE } from '@/lib/security/unlock-plan';
import styles from './kree8/kree8-lock-screen.module.css';

export function LockScreen() {
    const { isLocked, requiresSetup, authErrorMessage, authRecoveryState, unlockCredential, login, preparePassphraseRecovery, lock } = useSecurity();
    // ADR 0143: an account with a passphrase is unlocked by it; the field, its name and its minimum follow.
    const passphrase = !requiresSetup && unlockCredential === 'passphrase';
    const [pin, setPin] = useState('');
    // The exact text the provider held back because the policy would accept it as a passphrase.
    const [heldText, setHeldText] = useState<string | null>(null);
    // One attempt at a time, whatever the controls look like when a second one arrives.
    const attempting = useRef(false);
    // Counted as the primitives count it, after normalization: what they accept can be submitted.
    const longEnough = passphrase ? checkPassphrase(pin).ok : pin.length >= 4;
    const [recovering, setRecovering] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    // WUL-55: ref + nonce to restore focus to the credential field after a failed login.
    const pinInputRef = useRef<HTMLInputElement>(null);
    const [failedAttempt, setFailedAttempt] = useState(0);
    /* @Codex */
    const previousRecoveryState = useRef(authRecoveryState);

    // A failed login re-enables and clears the input; deterministically restore focus so the
    // operator can retry at once. A held text asks for a second gesture on the same field, so
    // focus returns there too. Guards: !loading = input already enabled; optional chaining =
    // safe across unmount, so a successful login (which unmounts this form) never focuses.
    useEffect(() => {
        if ((failedAttempt > 0 || heldText !== null || previousRecoveryState.current === 'pending')
            && !loading && authRecoveryState === 'ready') {
            pinInputRef.current?.focus();
        }
        previousRecoveryState.current = authRecoveryState;
    }, [failedAttempt, heldText, loading, authRecoveryState]);

    // If not locked and setup is done, don't render anything
    if (!isLocked && !requiresSetup) return null;

    const attempt = async (longPinConfirmed: boolean) => {
        /* @Codex: Enter cannot bypass a pending or unconfirmed recovery. */
        if (authRecoveryState !== 'ready' || attempting.current) return;
        attempting.current = true;
        setLoading(true);
        setError('');

        try {
            const outcome = await login(pin, { shown: passphrase ? 'passphrase' : 'pin', longPinConfirmed });
            // Nothing was sent: the text stays, so that the person can confirm it or change it.
            setHeldText(outcome === 'confirm' ? pin : null);
            if (outcome === false) {
                setError('');
                setPin('');
                setFailedAttempt((n) => n + 1);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Errore durante il login');
            setHeldText(null);
            setPin('');
            setFailedAttempt((n) => n + 1);
        } finally {
            attempting.current = false;
            setLoading(false);
        }
    };

    // Submitting the form is never the confirmation of a held text, however it is done: Enter
    // again, the button again, a double click. Each time the text is held back anew.
    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        void attempt(false);
    };

    // The confirmation is a gesture of its own, on the control shown with the notice. The second
    // click of a double click belongs to the gesture that came before it, wherever that began.
    const confirmHeldText = (e: React.MouseEvent) => {
        if (longPinNotice && e.detail <= 1) void attempt(true);
    };

    /* @Codex */
    const recoveryPending = authRecoveryState === 'pending';
    const credentialsDisabled = loading || authRecoveryState !== 'ready';
    const visibleError = error || authErrorMessage || (authRecoveryState === 'failed'
        ? 'Chiusura della sessione non confermata. Rinnova di nuovo l’accesso.' : '');
    // A held text can be confirmed only while its notice is what the person sees: the same text,
    // no other message in its place, no lock under way. Anything else starts over.
    const longPinNotice = heldText !== null && heldText === pin && !visibleError && authRecoveryState === 'ready';
    const recoveryMessage = authRecoveryState === 'required'
        ? 'Una sessione è già attiva. Rinnova l’accesso per usare questa scheda.'
        : recoveryPending ? 'Sto chiudendo la sessione precedente…' : null;

    return (
        // @Codex WUL-55 F2d-A: lock chrome uses the landed Lume identity without changing auth semantics.
        <div className={styles.lockShell} aria-label="MediFlow lock screen">
            <section className={styles.lockCard} aria-labelledby="mediflow-lock-title">
                <div className={styles.brandRow}>
                    <span className={`${styles.brandWord} type-brand`}>
                        MediFlow<span className={styles.brandDot} aria-hidden="true" />
                    </span>
                </div>

                <div className={styles.headerBlock}>
                    <h1 id="mediflow-lock-title" className={`${styles.title} type-page-title`}>
                        Sblocca MediFlow<span aria-hidden="true">.</span>
                    </h1>
                </div>

                <form onSubmit={handleLogin} className={styles.form}
                    // A key held down is one gesture: its repetitions activate nothing, on any control of the form.
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }}
                    aria-busy={loading || recoveryPending}>
                    {recoveryMessage && (
                        <p id="mediflow-auth-recovery" role="status" className="px-2 text-center text-sm leading-6">
                            {recoveryMessage}
                        </p>
                    )}
                    {/* @Codex WUL-55: keep the field name for assistive tech without repeating visible copy. */}
                    <label className="sr-only" htmlFor="mediflow-lock-pin">
                        {passphrase ? 'Passphrase' : 'PIN operatore'}
                    </label>
                    <div className={styles.inputWrap}>
                        <input
                            id="mediflow-lock-pin"
                            ref={pinInputRef}
                            type="password"
                            value={pin}
                            onChange={(e) => {
                                // A text that changes is another text, also when it is typed back.
                                setHeldText(null);
                                setPin(e.target.value);
                            }}
                            className={styles.pinInput}
                            inputMode="text"
                            autoComplete="off"
                            aria-invalid={Boolean(visibleError)}
                            aria-describedby={visibleError ? 'mediflow-lock-error' : longPinNotice ? 'mediflow-lock-confirm' : recoveryMessage ? 'mediflow-auth-recovery' : undefined}
                            disabled={credentialsDisabled}
                            placeholder={passphrase ? 'Passphrase' : undefined}
                            autoFocus
                        />
                    </div>

                    {longPinNotice && (
                        <>
                            <div id="mediflow-lock-confirm" className={styles.errorChip} role="status" aria-live="polite">
                                <AlertCircle size={12} />
                                <span>{LONG_PIN_NOTICE}</span>
                            </div>
                            <div className="text-center text-sm">
                                <button type="button" id="mediflow-lock-confirm-pin" disabled={credentialsDisabled}
                                    className="min-h-11 px-4 py-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                                    onClick={confirmHeldText}>
                                    {LONG_PIN_CONFIRM_LABEL}
                                </button>
                            </div>
                        </>
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
                            || !longEnough
                        }
                        className={styles.primaryButton}
                    >
                        {loading || recoveryPending ? (
                            <>
                                <Loader2 className={styles.spinner} size={16} />
                                {recoveryPending ? 'Attendi la conferma…' : 'Sto sbloccando...'}
                            </>
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
                                    setHeldText(null);
                                    setPin('');
                                    setError('');
                                    lock();
                                    setFailedAttempt((n) => n + 1);
                                }}>
                                Rinnova accesso
                            </button>
                            <p className="px-2 text-xs leading-5">Chiude la sessione condivisa con le altre schede. Poi inserisci di nuovo {passphrase ? 'la passphrase' : 'il PIN'}.</p>
                        </div>
                    )}
                </form>
                {passphrase && <div className="mt-4 space-y-4">
                    <button type="button" disabled={credentialsDisabled} className="min-h-11 underline" onClick={() => setRecovering(!recovering)}>Recupera con kit e chiave</button>
                    {recovering && <PassphraseAccessForm mode="recover" onPrepare={preparePassphraseRecovery} />}
                </div>}
                {!passphrase && <p className="mt-4 text-sm">Accesso PIN transitorio. Dopo lo sblocco, adotta una passphrase in Impostazioni → Accesso. Il PIN resterà separato per le conferme.</p>}

            </section>
        </div>
    );
}
