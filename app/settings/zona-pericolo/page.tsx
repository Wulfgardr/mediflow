'use client';

// WUL-297 Zona Pericolo: isolated surface with explicit typed confirmation.

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

const RESET_CONFIRM_KEYWORD = 'RESET';

export default function SettingsDangerZonePage() {
    const [confirmText, setConfirmText] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const { showToast } = useToast();
    const confirm = useConfirm();
    const confirmed = confirmText.trim().toUpperCase() === RESET_CONFIRM_KEYWORD;

    const resetOnboarding = async () => {
        if (!confirmed || isResetting) return;
        const { confirmed: proceed } = await confirm({
            title: 'Ripetere la configurazione iniziale?',
            message: 'Il reset cancella profilo utente e chiavi e riporta la postazione all\'onboarding. I dati dei pazienti restano invariati.',
            confirmLabel: 'Esegui reset',
            tone: 'danger',
        });
        if (!proceed) return;
        setIsResetting(true);
        try {
            const res = await fetch('/api/auth/reset', { method: 'POST' });
            if (res.ok) {
                window.location.href = '/';
            } else {
                showToast({ tone: 'error', title: 'Errore durante il reset' });
            }
        } catch (e) {
            console.error(e);
            showToast({ tone: 'error', title: 'Errore di connessione', description: 'Impossibile completare il reset. Riprova.' });
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <section className="space-y-4" data-testid="settings-danger-zone-section">
            <SettingsSectionIntro
                kicker="Sistema"
                title="Zona Pericolo"
                description="Operazioni che riportano la postazione a uno stato precedente. Richiedono riconfigurazione."
            />

            {/* Danger Zone */}
            <div className="rounded-[24px] border border-red-200/60 bg-red-50/60 p-5 md:p-6 dark:border-red-500/20 dark:bg-red-900/10">
                <div className="mb-5 flex items-start gap-3">
                    <div className="rounded-xl bg-red-100 p-2 text-red-600 dark:bg-red-500/15 dark:text-red-200">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="section-kicker">Zona pericolo</p>
                        <h3 className="mt-1 font-semibold text-slate-900 dark:text-white">Azioni irreversibili</h3>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Il reset cancella la configurazione operatore e richiede di ripetere la procedura di onboarding da zero.
                        </p>
                    </div>
                </div>

                <div className="space-y-4 rounded-[20px] border border-red-100 bg-white/78 p-4 dark:border-red-900/50 dark:bg-red-950/20">
                    <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-red-100">Reset onboarding</p>
                        <p className="text-xs text-slate-500 dark:text-red-200/70">
                            Cancella profilo utente e chiavi e riporta alla configurazione iniziale. I dati dei pazienti restano invariati,
                            ma dovrai riconfigurare l&apos;accesso.
                        </p>
                    </div>

                    {/* WUL-297: conferma esplicita digitando la parola chiave. */}
                    <label className="block text-xs font-medium text-red-800 dark:text-red-200">
                        Scrivi <strong>{RESET_CONFIRM_KEYWORD}</strong> per abilitare il reset
                        <input
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            placeholder={RESET_CONFIRM_KEYWORD}
                            autoComplete="off"
                            spellCheck={false}
                            data-testid="danger-zone-confirm-input"
                            className="mt-1 w-full max-w-xs rounded-[12px] border border-red-200 bg-white/90 px-3 py-2 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-100"
                        />
                    </label>

                    <button
                        onClick={resetOnboarding}
                        disabled={!confirmed || isResetting}
                        data-testid="danger-zone-reset-button"
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-600 shadow-sm transition-[border-color,background-color,color] hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-red-600 dark:border-red-500/30 dark:bg-red-950/10 dark:text-red-200 dark:hover:bg-red-600 dark:disabled:hover:bg-red-950/10 dark:disabled:hover:text-red-200"
                    >
                        {isResetting ? 'Reset in corso...' : 'Ripeti configurazione iniziale'}
                    </button>
                </div>
            </div>
        </section>
    );
}
