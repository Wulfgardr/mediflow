'use client';

import React, { useState } from 'react';
import { useSecurity } from './security-provider';
import { Lock, Unlock, ShieldCheck, AlertCircle } from 'lucide-react';

export function LockScreen() {
    const { isLocked, requiresSetup, login, setupPin } = useSecurity();
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
                setError('PIN non valido');
                setPin('');
            }
        } catch (err) {
            setError('Errore durante il login');
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
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-md transition-all duration-500">
            <div className="w-full max-w-md p-8 space-y-6 bg-card border rounded-xl shadow-2xl animate-in fade-in zoom-in duration-300">
                <div className="flex flex-col items-center space-y-2 text-center">
                    <div className="p-4 bg-primary/10 rounded-full">
                        {requiresSetup ? (
                            <ShieldCheck className="w-10 h-10 text-primary" />
                        ) : (
                            <Lock className="w-10 h-10 text-primary" />
                        )}
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        {requiresSetup ? 'Crea il tuo PIN' : 'MediFlow Sicurezza'}
                    </h1>
                    <p className="text-sm text-muted-foreground">
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
                            className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-center text-lg shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
                                className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-center text-lg shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center justify-center space-x-2 text-sm text-destructive animate-pulse">
                            <AlertCircle className="w-4 h-4" />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !pin}
                        className="inline-flex items-center justify-center w-full h-10 px-4 py-2 text-sm font-medium transition-colors rounded-md shadow bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
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
