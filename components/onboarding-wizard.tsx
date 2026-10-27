'use client';

import { useState } from 'react';
import { checkPassphrase } from '@/lib/security/unlock-credential';
import styles from './onboarding-experience.module.css';

export type SecuritySetup = { displayName: string; ambulatoryName: string; pin: string; passphrase: string };
interface OnboardingWizardProps {
    onComplete: (data: SecuritySetup) => Promise<void>;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
    const [step, setStep] = useState<1 | 2>(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    // WUL-UIUX (STREAM W2-B): finora un fallimento del setup finale non lasciava
    // traccia a schermo. Stato inline: il wizard vive a tutto schermo prima che
    // il resto della UI (e i toast) sia montato, quindi il posto onesto per
    // l'errore e qui, sopra il pulsante di conferma.
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Form Data
    const [formData, setFormData] = useState({
        displayName: '',
        ambulatoryName: '',
        pin: '',
        confirmPin: '',
        passphrase: '',
        confirmPassphrase: ''
    });

    // Step 1: Profile
    const canAdvanceProfile = formData.displayName.length > 2 && formData.ambulatoryName.length > 2;

    const canSubmit = checkPassphrase(formData.passphrase).ok
        && formData.passphrase.normalize('NFKC') === formData.confirmPassphrase.normalize('NFKC')
        && formData.pin.length >= 4 && formData.pin.length <= 64 && formData.pin === formData.confirmPin;

    const handleSubmit = async () => {
        if (!canSubmit || isSubmitting) return;
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            await onComplete({
                displayName: formData.displayName,
                ambulatoryName: formData.ambulatoryName,
                pin: formData.pin,
                passphrase: formData.passphrase
            });
        } catch (e) {
            console.error(e);
            setSubmitError(
                e instanceof Error && e.message
                    ? e.message
                    : 'Impossibile completare il setup. Controlla i dati inseriti e riprova.',
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={`${styles.experience} ${styles.setup}`} data-testid="onboarding-setup" aria-busy={isSubmitting}>
            <p className={styles.brandLine}><span className={styles.brand}>MediFlow<b>.</b></span><span className={styles.progress} aria-label="Avanzamento della configurazione">Passo {step} di 2</span></p>
            {step === 1 && (
                <div className={styles.stack}>
                    <header className={styles.heading}>
                        <h1>Chi sei?</h1>
                        <p>Il tuo nome e quello dell’ambulatorio compaiono nelle cartelle e nei documenti.</p>
                    </header>
                    <div className={styles.fields}>
                        <div className={styles.field}>
                            <label htmlFor="setup-display-name">Nome e cognome</label>
                            <input
                                type="text"
                                id="setup-display-name"
                                value={formData.displayName}
                                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                                placeholder="es. Dott. Nome Medico"
                                className={styles.input}
                                autoFocus
                            />
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="setup-ambulatory-name">Nome dell’ambulatorio</label>
                            <input
                                type="text"
                                id="setup-ambulatory-name"
                                value={formData.ambulatoryName}
                                onChange={(e) => setFormData({ ...formData, ambulatoryName: e.target.value })}
                                placeholder="es. Studio Medico Centrale"
                                className={styles.input}
                            />
                        </div>
                    </div>
                    <div className={styles.actions}>
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            disabled={!canAdvanceProfile}
                            className={styles.primaryAction}
                        >
                            Avanti
                        </button>
                    </div>
                </div>
            )}
            {step === 2 && (
                <div className={styles.stack}>
                    <header className={styles.heading}>
                        <h1>Proteggi l’accesso</h1>
                        <p id="setup-pin-help">La passphrase apre l’archivio: usa da 15 a 128 caratteri. Il PIN separato, da 4 a 64 caratteri, serve solo per le conferme di revisione e di ruolo.</p>
                    </header>
                    <div className={styles.fields}>
                        <div className={styles.field}>
                            <label htmlFor="setup-passphrase">Passphrase di accesso</label>
                            <input id="setup-passphrase" type="password" inputMode="text" autoComplete="new-password" spellCheck={false} className={styles.input}
                                value={formData.passphrase} onChange={e => setFormData({ ...formData, passphrase: e.target.value })} aria-describedby="setup-pin-help" />
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="setup-confirm-passphrase">Conferma passphrase</label>
                            <input id="setup-confirm-passphrase" type="password" inputMode="text" autoComplete="new-password" spellCheck={false} className={styles.input}
                                value={formData.confirmPassphrase} onChange={e => setFormData({ ...formData, confirmPassphrase: e.target.value })} />
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="setup-pin">PIN di conferma</label>
                            <input
                                type="password"
                                inputMode="text"
                                id="setup-pin"
                                value={formData.pin}
                                onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                                placeholder="••••••"
                                className={styles.input}
                                aria-describedby="setup-pin-help"
                                autoFocus
                            />
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="setup-confirm-pin">Conferma PIN</label>
                            <input
                                type="password"
                                inputMode="text"
                                id="setup-confirm-pin"
                                value={formData.confirmPin}
                                onChange={(e) => setFormData({ ...formData, confirmPin: e.target.value })}
                                placeholder="••••••"
                                className={styles.input}
                                aria-invalid={!!(formData.confirmPin && formData.pin !== formData.confirmPin)}
                                aria-describedby={formData.confirmPin && formData.pin !== formData.confirmPin
                                    ? 'setup-pin-help setup-pin-mismatch' : 'setup-pin-help'}
                            />
                            {formData.confirmPin && formData.pin !== formData.confirmPin && (
                                <p id="setup-pin-mismatch" className={styles.errorText}>I PIN non corrispondono.</p>
                            )}
                        </div>
                    </div>
                    {submitError && (
                        <p className={styles.errorText} role="alert">{submitError}</p>
                    )}
                    <div className={styles.actions}>
                        <button type="button" onClick={() => setStep(1)} className={styles.secondaryAction}>Indietro</button>
                        <button type="button" onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className={styles.primaryAction}>
                            {isSubmitting ? 'Salvataggio…' : 'Prepara il kit di recupero'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
