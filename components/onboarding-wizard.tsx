'use client';

import { useState } from 'react';
import styles from './onboarding-experience.module.css';

/* @Codex: setup identity and PIN only; work tailoring follows authenticated setup. */
interface OnboardingWizardProps {
    onComplete: (data: { displayName: string; ambulatoryName: string; pin: string }) => Promise<void>;
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
        confirmPin: ''
    });

    // Step 1: Profile
    const canAdvanceProfile = formData.displayName.length > 2 && formData.ambulatoryName.length > 2;

    // @Codex: the existing owner uses the PIN for access and key wrapping.
    // Step 2: PIN
    const canSubmit = formData.pin.length >= 4 && formData.pin === formData.confirmPin;

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            // @Codex: preserve the existing setup owner; collect only fields it consumes.
            await onComplete({
                displayName: formData.displayName,
                ambulatoryName: formData.ambulatoryName,
                pin: formData.pin
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
            <p className={styles.progress} aria-label="Avanzamento setup">Passo {step} di 2</p>
            {step === 1 && (
                <div className={styles.stack}>
                    <header className={styles.heading}>
                        <h2>Chi sei?</h2>
                        <p>I tuoi dati per intestare referti e cartelle. Puoi iniziare senza AI.</p>
                    </header>
                    <div className={styles.fields}>
                        <div className={styles.field}>
                            <label htmlFor="setup-display-name">Nome e Cognome</label>
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
                            <label htmlFor="setup-ambulatory-name">Nome Ambulatorio</label>
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
                        <h2>Sicurezza</h2>
                        <p id="setup-pin-help">Il PIN protegge l’accesso locale e la chiave dei campi clinici cifrati. Usa almeno 4 caratteri e conservalo.</p>
                    </header>
                    <div className={styles.fields}>
                        <div className={styles.field}>
                            <label htmlFor="setup-pin">PIN di accesso e cifratura</label>
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
                            {isSubmitting ? 'Salvataggio…' : 'Concludi Setup'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
