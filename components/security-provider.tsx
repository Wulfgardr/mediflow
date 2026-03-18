'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
    generateMasterKey,
    deriveKeyFromPin,
    wrapMasterKey,
    unwrapMasterKey
} from '@/lib/security';
import { db } from '@/lib/db';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { LockScreen } from '@/components/lock-screen';
/* @Codex */
import { AuthHealthScreen, AuthHealthPayload } from '@/components/auth-health-screen';
/* @Codex */
import { useInactivityLock } from '@/lib/hooks/use-inactivity-lock';
/* @Codex */
import {
    clearSecuritySession,
    persistSecuritySession,
    restoreSecuritySession,
} from '@/lib/client-security-session';

export interface User {
    id: string;
    username: string;
    displayName?: string;
    ambulatoryName?: string;
    role: string;
}

interface SecurityContextType {
    isAuthenticated: boolean;
    isLocked: boolean;
    requiresSetup: boolean;
    user: User | null;
    authErrorMessage: string | null;
    login: (pin: string) => Promise<boolean>;
    setupPin: (pin: string) => Promise<void>;
    lock: () => void;
    updateUser: (data: Partial<User>) => void;
}

/* @Codex */
type LoginFailurePayload = {
    error?: string;
    code?: string;
    message?: string;
    lockedUntil?: string;
    remainingAttempts?: number;
    retryAfterSeconds?: number;
};

/* @Codex */
function formatLockedUntil(lockedUntil?: string) {
    if (!lockedUntil) return 'Accesso temporaneamente bloccato. Riprova più tardi.';
    const date = new Date(lockedUntil);
    if (Number.isNaN(date.getTime())) return 'Accesso temporaneamente bloccato. Riprova più tardi.';
    return `Accesso bloccato fino alle ${new Intl.DateTimeFormat('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
    }).format(date)}.`;
}

/* @Codex */
function formatLoginFailure(payload: LoginFailurePayload | null, status: number) {
    if (payload?.code === 'AUTH_LOCKED') {
        return payload.message || formatLockedUntil(payload.lockedUntil);
    }
    if (payload?.code === 'INVALID_CREDENTIALS') {
        if (payload.message) return payload.message;
        if (typeof payload.remainingAttempts === 'number' && payload.remainingAttempts > 0) {
            return `PIN non valido. Tentativi rimasti: ${payload.remainingAttempts}.`;
        }
        return 'PIN non valido.';
    }
    if (status === 423) return formatLockedUntil(payload?.lockedUntil);
    if (status === 401) return 'PIN non valido.';
    return payload?.message || payload?.error || 'Errore durante il login.';
}

const SecurityContext = createContext<SecurityContextType | undefined>(undefined);

export function SecurityProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [requiresSetup, setRequiresSetup] = useState<boolean | null>(null); // null = loading
    const [isLocked, setIsLocked] = useState(true);
    const [user, setUser] = useState<User | null>(null);
    const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
    /* @Codex */
    const [authHealth, setAuthHealth] = useState<AuthHealthPayload | null>(null);
    /* @Codex */
    const [isRepairing, setIsRepairing] = useState(false);

    const lock = () => {
        setIsLocked(true);
        setAuthErrorMessage(null);
        // @Codex - clear server session when locking
        void fetch('/api/auth/logout', { method: 'POST' });
        // setIsAuthenticated(false); // Do not de-auth, just lock screen.
    };

    useInactivityLock({
        enabled: isAuthenticated && !isLocked,
        onTimeout: lock,
    });

    // Initial check
    useEffect(() => {
        const init = async () => {
            const restored = await restoreSession();
            checkAuthStatus(restored);
        };
        init();
    }, []);

    const checkAuthStatus = async (isSessionRestored?: boolean) => {
        try {
            /* @Codex */
            const res = await fetch('/api/auth/check', { cache: 'no-store' });
            /* @Codex */
            const text = await res.text();
            /* @Codex */
            let data: AuthHealthPayload | null = null;
            if (text) {
                try {
                    data = JSON.parse(text) as AuthHealthPayload;
                } catch (error) {
                    console.warn('Auth check returned non-JSON payload', error);
                }
            }
            /* @Codex */
            if (!data) {
                setAuthHealth({
                    status: 'error',
                    error: {
                        code: 'AUTH_CHECK_INVALID',
                        message: res.ok ? 'Risposta non valida dal server.' : `Errore server (HTTP ${res.status}).`
                    }
                });
                setRequiresSetup(false);
                setIsAuthenticated(false);
                setIsLocked(true);
                return;
            }
            /* @Codex */
            if (!res.ok) {
                setAuthHealth({
                    ...data,
                    status: 'error',
                    error: data.error ?? { code: 'AUTH_CHECK_HTTP', message: `Errore server (HTTP ${res.status}).` }
                });
                setRequiresSetup(false);
                setIsAuthenticated(false);
                setIsLocked(true);
                return;
            }

            /* @Codex */
            if (data?.status === 'error' || data?.error) {
                setAuthHealth(data);
                setRequiresSetup(false);
                setIsAuthenticated(false);
                setIsLocked(true);
                return;
            }
            /* @Codex */
            setAuthHealth(null);

            // If setup is missing on server, force setup flow regardless of session
            if (!data.isSetup) {
                setRequiresSetup(true);
                setIsAuthenticated(false);
            } else {
                // Setup exists.
                setRequiresSetup(false);
                // @Codex - if server session is missing, lock and clear local session
                if (data.hasSession === false) {
                    clearSecuritySession();
                    db.setKey(null);
                    setIsAuthenticated(false);
                    setIsLocked(true);
                    return;
                }
                // If we didn't restore session, we remain unauthenticated (showing lock screen if set)
                // If isSessionRestored is true, we are already authenticated via restoreSession
            }
        } catch (e) {
            console.error("Auth check failed", e);
            /* @Codex */
            setAuthHealth({
                status: 'error',
                error: { code: 'AUTH_CHECK_FAILED', message: 'Impossibile verificare lo stato di sicurezza.' }
            });
            setRequiresSetup(false);
            setIsAuthenticated(false);
            setIsLocked(true);
        }
    };

    /* @Codex */
    const repairFromLegacy = async () => {
        if (isRepairing) return;
        setIsRepairing(true);
        try {
            const res = await fetch('/api/system/repair-db', { method: 'POST' });
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                throw new Error(payload?.error || 'Ripristino fallito');
            }
            await checkAuthStatus();
        } catch (e) {
            console.error('Repair failed', e);
            alert('Ripristino fallito. Verifica i dettagli in console.');
        } finally {
            setIsRepairing(false);
        }
    };

    const restoreSession = async (): Promise<boolean> => {
        try {
            const session = await restoreSecuritySession<User>();
            if (!session) return false;

            db.setKey(session.key);
            setUser(session.userData);
            setIsAuthenticated(true);
            setIsLocked(false);
            return true;
        } catch (e) {
            console.error("Failed to restore session", e);
            return false;
        }
    };

    const login = async (pin: string): Promise<boolean> => {
        try {
            setAuthErrorMessage(null);
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: pin })
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => null) as LoginFailurePayload | null;
                setAuthErrorMessage(formatLoginFailure(payload, res.status));
                return false;
            }

            const data = await res.json();
            const { encryptedMasterKey, salt, ...userData } = data;

            // Convert salt from B64 string
            let saltBytes: Uint8Array;
            if (typeof salt === 'string') {
                const binString = atob(salt);
                saltBytes = new Uint8Array(binString.length);
                for (let i = 0; i < binString.length; i++) saltBytes[i] = binString.charCodeAt(i);
            } else {
                saltBytes = new Uint8Array(salt);
            }

            const kek = await deriveKeyFromPin(pin, saltBytes);
            const masterKey = await unwrapMasterKey(encryptedMasterKey, kek);

            db.setKey(masterKey);
            setUser(userData);
            setIsAuthenticated(true);
            setIsLocked(false);
            setAuthErrorMessage(null);

            // Persist session
            try {
                await persistSecuritySession(masterKey, userData);
            } catch (e) {
                console.error("Failed to save session", e);
            }

            return true;

        } catch (e) {
            console.error("Login failed", e);
            setAuthErrorMessage('Errore durante il login.');
            return false;
        }
    };

    // Legacy setupPin (for context interface compatibility)
    const setupPin = async (pin: string): Promise<void> => {
        await handleWizardComplete({ displayName: 'Admin', ambulatoryName: 'Studio', pin });
    };

    // New handler for Onboarding Wizard
    const handleWizardComplete = async (data: { displayName: string; ambulatoryName: string; pin: string }) => {
        const { displayName, ambulatoryName, pin } = data;

        try {
            // Generate crypto
            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const kek = await deriveKeyFromPin(pin, salt);
            const masterKey = await generateMasterKey();
            const encryptedMasterKey = await wrapMasterKey(masterKey, kek);
            const saltB64 = btoa(String.fromCharCode(...salt));

            // Send to Server
            const res = await fetch('/api/auth/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: 'admin',
                    password: pin,
                    encryptedMasterKey,
                    salt: saltB64,
                    displayName,
                    ambulatoryName
                })
            });

            /* @Codex */
            if (!res.ok) {
                let payload: any = null;
                try {
                    payload = await res.json();
                } catch {
                    payload = null;
                }

                if ((res.status === 403 || res.status === 409) && payload?.code === 'SETUP_ALREADY_COMPLETED') {
                    setRequiresSetup(false);
                    const success = await login(pin);
                    if (!success) {
                        setIsAuthenticated(false);
                        setIsLocked(true);
                        alert("Setup già completato. Inserisci il PIN esistente.");
                    }
                    return;
                }

                throw new Error(payload?.error || "Setup failed server-side");
            }

            // Set Active
            db.setKey(masterKey);
            setRequiresSetup(false);
            setIsAuthenticated(true);
            setIsLocked(false);

            // Persist
            const userData: User = { id: 'admin', username: 'admin', role: 'admin', displayName, ambulatoryName };
            setUser(userData);
            try {
                await persistSecuritySession(masterKey, userData);
            } catch (sessionError) {
                console.error("Failed to save session", sessionError);
            }
        } catch (e) {
            console.error("Setup failed", e);
            alert("Errore configurazione: " + e);
        }
    };

    /* @Codex */
    if (authHealth?.status === 'error') {
        return (
            <AuthHealthScreen
                health={authHealth}
                onRetry={() => checkAuthStatus()}
                onRepair={authHealth.hasSession ? repairFromLegacy : undefined}
                isRepairing={isRepairing}
            />
        );
    }

    // Loading state
    if (requiresSetup === null) {
        return <div className="h-screen flex items-center justify-center bg-gray-50 text-gray-400">Caricamento sicurezza...</div>;
    }

    // Onboarding Wizard for first-time setup
    if (requiresSetup) {
        return (
            <div className="h-screen w-screen fixed inset-0 z-[100] bg-gradient-to-br from-indigo-50 to-blue-100 flex items-center justify-center p-4">
                <OnboardingWizard onComplete={handleWizardComplete} />
            </div>
        );
    }

    // Normal flow with Lock Screen Overlay
    return (
        <SecurityContext.Provider value={{
            isAuthenticated,
            isLocked,
            requiresSetup: false,
            user,
            authErrorMessage,
            login,
            setupPin,
            lock,
            updateUser: (data) => setUser(prev => prev ? { ...prev, ...data } : null)
        }}>
            <div className="relative min-h-screen">
                {children}
                {isLocked && (
                    <div className="fixed inset-0 z-[9999] bg-white/80 backdrop-blur-md">
                        <LockScreen />
                    </div>
                )}
            </div>
        </SecurityContext.Provider>
    );
}

export function useSecurity() {
    const context = useContext(SecurityContext);
    if (context === undefined) {
        throw new Error('useSecurity must be used within a SecurityProvider');
    }
    return context;
}
