'use client';

// WUL-297 — Accesso: PIN rotation moved from the monolithic settings page.

import { useState } from 'react';
import { KeyRound, Lock, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSecurity } from '@/components/security-provider';
import {
    SETTINGS_CARD_CLASS,
    SETTINGS_INPUT_CLASS,
    SETTINGS_LABEL_CLASS,
    SETTINGS_PRIMARY_BUTTON_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS,
    SettingsSectionIntro,
} from '@/components/settings/settings-ui';

export default function SettingsAccessPage() {
    const { user, changePin, lock } = useSecurity();
    /* @Codex */
    const [pinForm, setPinForm] = useState({ currentPin: '', newPin: '', confirmPin: '' });
    /* @Codex */
    const [isChangingPin, setIsChangingPin] = useState(false);
    /* @Codex */
    const [pinFeedback, setPinFeedback] = useState<null | { tone: 'success' | 'error'; message: string }>(null);

    /* @Codex */
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
        <section className="space-y-4" data-testid="settings-access-section">
            <SettingsSectionIntro
                kicker="Sicurezza e Dati"
                title="Accesso"
                description="Rotazione del PIN di sblocco e controllo della sessione locale."
            />

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className={SETTINGS_CARD_CLASS}>
                    {/* @Codex WUL-229 — security card icon switches to MediFlow warning tone */}
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' }}>
                            <KeyRound className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Sicurezza</p>
                            <h2 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Cambio PIN</h2>
                            <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Ruota il PIN senza toccare la master key: i dati clinici restano leggibili.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="current-pin" className={SETTINGS_LABEL_CLASS}>
                                PIN attuale
                            </label>
                            <input
                                id="current-pin"
                                name="currentPin"
                                type="password"
                                inputMode="numeric"
                                value={pinForm.currentPin}
                                onChange={(e) => setPinForm({ ...pinForm, currentPin: e.target.value })}
                                placeholder="Inserisci il PIN attuale"
                                autoComplete="current-password"
                                spellCheck={false}
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>

                        <div>
                            <label htmlFor="new-pin" className={SETTINGS_LABEL_CLASS}>
                                Nuovo PIN
                            </label>
                            <input
                                id="new-pin"
                                name="newPin"
                                type="password"
                                inputMode="numeric"
                                value={pinForm.newPin}
                                onChange={(e) => setPinForm({ ...pinForm, newPin: e.target.value })}
                                placeholder="4-8 caratteri"
                                autoComplete="new-password"
                                spellCheck={false}
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>

                        <div>
                            <label htmlFor="confirm-pin" className={SETTINGS_LABEL_CLASS}>
                                Conferma nuovo PIN
                            </label>
                            <input
                                id="confirm-pin"
                                name="confirmPin"
                                type="password"
                                inputMode="numeric"
                                value={pinForm.confirmPin}
                                onChange={(e) => setPinForm({ ...pinForm, confirmPin: e.target.value })}
                                placeholder="Ripeti il nuovo PIN"
                                autoComplete="new-password"
                                spellCheck={false}
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>

                        {pinFeedback && (
                            // @Codex WUL-229 — PIN feedback now uses the mf-alert tone primitives
                            <div className={cn('mf-alert text-xs', pinFeedback.tone === 'success' ? 'mf-alert-success' : 'mf-alert-critical')}>
                                {pinFeedback.message}
                            </div>
                        )}

                        <div className="pt-2">
                            <button
                                onClick={handleChangePin}
                                disabled={isChangingPin}
                                className={SETTINGS_PRIMARY_BUTTON_CLASS}
                            >
                                <Shield className="w-4 h-4" />
                                {isChangingPin ? 'Aggiornamento...' : 'Aggiorna PIN'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* WUL-297 — sessione locale corrente, con blocco immediato. */}
                <div className={SETTINGS_CARD_CLASS}>
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' }}>
                            <Lock className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Sessione</p>
                            <h2 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Sessione locale</h2>
                            <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>
                                Una sola sessione attiva su questa postazione. Il blocco richiede il PIN al prossimo accesso.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="apple-subsection">
                            <p className="section-kicker">Operatore</p>
                            <p className="mt-2 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>{user?.displayName || 'Admin'}</p>
                            <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>{user?.ambulatoryName || 'Ambulatorio non impostato'}</p>
                        </div>

                        <button
                            type="button"
                            onClick={() => lock()}
                            className={SETTINGS_SECONDARY_BUTTON_CLASS}
                        >
                            <Lock className="h-4 w-4" />
                            Blocca sessione adesso
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
