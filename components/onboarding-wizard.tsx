'use client';

import { useState } from 'react';
import { User, Shield, Check, Building, Lock, Key } from 'lucide-react';

interface OnboardingWizardProps {
    onComplete: (data: { displayName: string; ambulatoryName: string; pin: string; username: string }) => Promise<void>;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
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
        role: 'admin',
        username: '',
        password: '',
        pin: '',
        confirmPin: ''
    });

    // Step 1: Profile
    const canAdvanceProfile = formData.displayName.length > 2 && formData.ambulatoryName.length > 2;

    // Step 3: Credentials
    const canAdvanceCreds = formData.username.length >= 4 && formData.password.length >= 6;

    // Step 4: PIN
    const canSubmit = formData.pin.length >= 4 && formData.pin === formData.confirmPin;

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            // @Codex WUL-229: keep the historical encryption contract intact:
            // login password is for auth, PIN is for the encrypted master key.
            await onComplete({
                displayName: formData.displayName,
                ambulatoryName: formData.ambulatoryName,
                pin: formData.pin,
                username: formData.username
            });
        } catch (e) {
            console.error(e);
            setSubmitError(
                e instanceof Error && e.message
                    ? e.message
                    : 'Impossibile completare il setup. Controlla i dati inseriti e riprova.',
            );
            setIsSubmitting(false);
        }
    };

    return (
        // @Codex WUL-229: onboarding now uses specular shell + crystalline pills
        <div className="w-full max-w-2xl mx-auto">
            <div className="mb-8 flex items-center justify-center gap-2" aria-label="Avanzamento setup">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex items-center">
                        <span
                            className={`mf-step-pill ${step >= i ? 'is-active' : ''}`}
                            aria-current={step === i ? 'step' : undefined}
                        >
                            {i}
                        </span>
                        {i < 4 && <span className={`mf-step-divider mx-2 ${step > i ? 'is-complete' : ''}`} aria-hidden="true" />}
                    </div>
                ))}
            </div>

            <div className="mf-modal-shell overflow-hidden">
                <div className="p-8">
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center">
                                <p className="mf-eyebrow">Passo 1 di 4</p>
                                <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--mf-ink)' }}>Chi sei?</h2>
                                <p className="mt-2" style={{ color: 'var(--mf-muted)' }}>I tuoi dati per intestare referti e cartelle.</p>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="mf-field-label">Nome e Cognome</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                                        <input
                                            type="text"
                                            value={formData.displayName}
                                            onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                                            placeholder="es. Dott. Nome Medico"
                                            className="mf-input pl-10"
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="mf-field-label">Nome Ambulatorio</label>
                                    <div className="relative">
                                        <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                                        <input
                                            type="text"
                                            value={formData.ambulatoryName}
                                            onChange={(e) => setFormData({ ...formData, ambulatoryName: e.target.value })}
                                            placeholder="es. Studio Medico Centrale"
                                            className="mf-input pl-10"
                                        />
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setStep(2)}
                                disabled={!canAdvanceProfile}
                                className="ui-btn-primary w-full mt-6 py-3 disabled:opacity-50"
                            >
                                Avanti
                            </button>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center">
                                <p className="mf-eyebrow">Passo 2 di 4</p>
                                <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--mf-ink)' }}>Ruolo</h2>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, role: 'admin' })}
                                    className={`mf-option-card ${formData.role === 'admin' ? 'is-active' : ''}`}
                                >
                                    <Shield className="w-7 h-7" style={{ color: formData.role === 'admin' ? 'var(--mf-primary)' : 'var(--mf-muted)' }} />
                                    <div className="font-semibold" style={{ color: 'var(--mf-ink)' }}>Amministratore</div>
                                    <div className="text-xs" style={{ color: 'var(--mf-muted)' }}>Accesso completo a dati e configurazioni.</div>
                                </button>
                                <button type="button" disabled className="mf-option-card" aria-disabled="true">
                                    <User className="w-7 h-7" style={{ color: 'var(--mf-muted)' }} />
                                    <div className="font-semibold" style={{ color: 'var(--mf-ink)' }}>Utente Standard</div>
                                    <div className="text-xs" style={{ color: 'var(--mf-muted)' }}>Solo visualizzazione e inserimento dati. Non ancora disponibile.</div>
                                </button>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3 mt-6">
                                <button onClick={() => setStep(1)} className="mf-btn-secondary sm:w-auto">Indietro</button>
                                <button onClick={() => setStep(3)} className="ui-btn-primary flex-1 py-3">Avanti</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center">
                                <p className="mf-eyebrow">Passo 3 di 4</p>
                                <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--mf-ink)' }}>Credenziali di Accesso</h2>
                                <p className="mt-2" style={{ color: 'var(--mf-muted)' }}>Username e password per il login, anche da altri dispositivi.</p>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="mf-field-label">Username</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                                        <input
                                            type="text"
                                            value={formData.username}
                                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                            placeholder="es. leonardo.pegollo"
                                            className="mf-input pl-10"
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="mf-field-label">Password</label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                                        <input
                                            type="password"
                                            value={formData.password}
                                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                            placeholder="Password sicura"
                                            className="mf-input pl-10"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3 mt-6">
                                <button onClick={() => setStep(2)} className="mf-btn-secondary sm:w-auto">Indietro</button>
                                <button onClick={() => setStep(4)} disabled={!canAdvanceCreds} className="ui-btn-primary flex-1 py-3 disabled:opacity-50">Avanti</button>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center">
                                <p className="mf-eyebrow">Passo 4 di 4</p>
                                <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--mf-ink)' }}>Sicurezza</h2>
                                <p className="mt-2" style={{ color: 'var(--mf-muted)' }}>Il PIN serve a <b>cifrare</b> i dati. Non dimenticarlo.</p>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="mf-field-label">PIN Cifratura</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                                        <input
                                            type="password"
                                            inputMode="numeric"
                                            value={formData.pin}
                                            onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                                            placeholder="••••••"
                                            className="mf-input pl-10 tracking-widest text-lg"
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="mf-field-label">Conferma PIN</label>
                                    <div className="relative">
                                        <Check className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                                        <input
                                            type="password"
                                            inputMode="numeric"
                                            value={formData.confirmPin}
                                            onChange={(e) => setFormData({ ...formData, confirmPin: e.target.value })}
                                            placeholder="••••••"
                                            className="mf-input pl-10 tracking-widest text-lg"
                                            aria-invalid={!!(formData.confirmPin && formData.pin !== formData.confirmPin)}
                                        />
                                    </div>
                                    {formData.confirmPin && formData.pin !== formData.confirmPin && (
                                        <p className="mf-field-error">I PIN non corrispondono.</p>
                                    )}
                                </div>
                            </div>
                            {submitError && (
                                <p className="mf-field-error mt-4" role="alert">{submitError}</p>
                            )}
                            <div className="flex flex-col sm:flex-row gap-3 mt-6">
                                <button onClick={() => setStep(3)} className="mf-btn-secondary sm:w-auto">Indietro</button>
                                <button onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className="ui-btn-primary flex-1 py-3 disabled:opacity-50">
                                    {isSubmitting ? 'Salvataggio…' : 'Concludi Setup'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
