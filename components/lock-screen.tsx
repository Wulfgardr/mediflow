'use client';

import React, { useState } from 'react';
import { useSecurity } from './security-provider';
import { Lock, Unlock, ShieldCheck, AlertCircle } from 'lucide-react';

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

    return (
        // @Codex WUL-229 — lock chrome adopts the specular tier (modal shell) and shared mf-input/btn primitives
        <div className="mf-modal-backdrop">
            <div className="mf-modal-shell w-full max-w-md p-8 space-y-6 animate-in fade-in zoom-in duration-300">
                <div className="flex flex-col items-center space-y-2 text-center">
                    <div className="p-4 rounded-full" style={{ backgroundColor: 'rgba(15, 123, 104, 0.12)' }}>
                        {requiresSetup ? (
                            <ShieldCheck className="w-10 h-10" style={{ color: 'var(--mf-primary)' }} />
                        ) : (
                            <Lock className="w-10 h-10" style={{ color: 'var(--mf-primary)' }} />
                        )}
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--mf-ink)' }}>
                        {requiresSetup ? 'Crea il tuo PIN' : 'MediFlow Sicurezza'}
                    </h1>
                    <p className="text-sm" style={{ color: 'var(--mf-muted)' }}>
                        {requiresSetup
                            ? 'Imposta un PIN di sicurezza per proteggere i dati dei pazienti.'
                            : 'Inserisci il tuo PIN per accedere.'}
                    </p>
                </div>

                <form onSubmit={requiresSetup ? handleSetup : handleLogin} className="space-y-4">
                    <div className="space-y-2">
                        <input
                            type="password"
                            placeholder="Inserisci PIN"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className="mf-input text-center text-lg tracking-widest"
                            autoFocus
                        />
                    </div>

                    {requiresSetup && (
                        <div className="space-y-2">
                            <input
                                type="password"
                                placeholder="Conferma PIN"
                                value={confirmPin}
                                onChange={(e) => setConfirmPin(e.target.value)}
                                className="mf-input text-center text-lg tracking-widest"
                            />
                        </div>
                    )}

                    {(error || authErrorMessage) && (
                        <div className="mf-alert mf-alert-critical text-center justify-center" role="alert">
                            <span className="inline-flex items-center justify-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                <span>{error || authErrorMessage}</span>
                            </span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !pin}
                        className="ui-btn-primary w-full h-12 px-4 text-sm font-semibold"
                    >
                        {loading ? (
                            <span className="animate-spin">⏳</span>
                        ) : requiresSetup ? (
                            'Imposta PIN'
                        ) : (
                            <span className="flex items-center">
                                <Unlock className="w-4 h-4 mr-2" /> Sblocca
                            </span>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
