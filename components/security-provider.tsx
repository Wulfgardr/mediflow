'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
    generateMasterKey,
    getKdfVersion,
    CURRENT_KDF_VERSION,
    wrapMasterKeyVersioned,
    unwrapMasterKeyVersioned,
} from '@/lib/security/security';
/* @Codex */
import {
    createPinRotationBundle,
    formatPinChangeFailure,
    type PinChangeFailurePayload,
    validatePinChangeInput,
} from '@/lib/security/pin-change';
import { db } from '@/lib/db';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { LockScreen } from '@/components/lock-screen';
/* @Codex */
import { AuthHealthScreen } from '@/components/auth-health-screen';
/* @Codex */
import { useInactivityLock } from '@/lib/hooks/use-inactivity-lock';
/* @Codex */
import {
    clearSecuritySession,
    persistSecuritySession,
    restoreSecuritySession,
} from '@/lib/security/client-security-session';
/* @Codex */
import { notifyDbChange } from '@/lib/live-query';
/* @Codex */
import {
    checkAuthHealthRequest,
    changePinRequest,
    loginWithPinRequest,
    logoutSecuritySession,
    repairLegacyDbRequest,
    rewrapMasterKeyRequest,
    setupSecurityRequest,
    type AuthHealthPayload,
    type LoginFailurePayload,
} from '@/lib/security/client-auth-api';
/* @Codex */
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from '@/lib/api-table-response';

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
    changePin: (currentPin: string, newPin: string) => Promise<{ ok: true } | { ok: false; message: string }>;
    lock: () => void;
    updateUser: (data: Partial<User>) => void;
}

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
    if (payload?.code === 'INVALID_CREDENTIALS' || payload?.code === 'AUTH_INVALID_CREDENTIALS') {
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

/* @Codex */
function canOfferLegacyRepair(health: AuthHealthPayload | null): boolean {
    if (!health?.hasSession) return false;

    switch (health.error?.code) {
        case 'DB_SCHEMA_MISSING':
        case 'DB_QUERY_FAILED':
            return true;
        case 'DATA_DIR_UNAVAILABLE':
        case 'AUTH_CHECK_FAILED':
            return false;
        default:
            return health.db?.state === 'missing' || health.db?.state === 'schema-missing';
    }
}

const SecurityContext = createContext<SecurityContextType | undefined>(undefined);

export function SecurityProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [requiresSetup, setRequiresSetup] = useState<boolean | null>(null); // null = loading
    const [isLocked, setIsLocked] = useState(true);
    const [user, setUser] = useState<User | null>(null);
    const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
    /* @Codex */
    const masterKeyRef = useRef<CryptoKey | null>(null);
    /* @Codex */
    const [authHealth, setAuthHealth] = useState<AuthHealthPayload | null>(null);
    /* @Codex */
    const [isRepairing, setIsRepairing] = useState(false);
    // WUL-UIUX: errore inline per i flussi setup/ripristino, al posto di alert() nativo.
    // Il toast non e utilizzabile qui: ToastProvider e montato dentro SecurityProvider.
    const [flowError, setFlowError] = useState<string | null>(null);

    /* @Codex */
    const setActiveMasterKey = (key: CryptoKey | null) => {
        masterKeyRef.current = key;
        db.setKey(key);
        notifyDbChange();
    };

    const lock = () => {
        setIsLocked(true);
        setAuthErrorMessage(null);
        // @Codex - clear server session when locking
        logoutSecuritySession();
        // setIsAuthenticated(false); // Do not de-auth, just lock screen.
    };

    useInactivityLock({
        enabled: isAuthenticated && !isLocked,
        onTimeout: lock,
    });

    /* @Codex */
    useEffect(() => {
        const handleApiAuthUnavailable = () => {
            clearSecuritySession();
            setActiveMasterKey(null);
            setIsAuthenticated(false);
            setIsLocked(true);
            setAuthErrorMessage('Sessione scaduta.');
        };

        window.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, handleApiAuthUnavailable);
        return () => {
            window.removeEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, handleApiAuthUnavailable);
        };
    }, []);

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
            const { response: res, payload: data } = await checkAuthHealthRequest();
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
                    setActiveMasterKey(null);
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
        setFlowError(null);
        try {
            const { response: res, payload } = await repairLegacyDbRequest();
            if (!res.ok) {
                throw new Error(payload?.error || 'Ripristino fallito');
            }
            await checkAuthStatus();
        } catch (e) {
            console.error('Repair failed', e);
            setFlowError('Ripristino fallito. Verifica i dettagli in console.');
        } finally {
            setIsRepairing(false);
        }
    };

    const restoreSession = async (): Promise<boolean> => {
        try {
            const session = await restoreSecuritySession<User>();
            if (!session) return false;

            setActiveMasterKey(session.key);
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
            const { response: res, payload } = await loginWithPinRequest(pin);

            if (!res.ok) {
                setAuthErrorMessage(formatLoginFailure((payload as LoginFailurePayload | null) ?? null, res.status));
                return false;
            }

            const data = payload as {
                encryptedMasterKey: string;
                salt: string | number[];
                id: string;
                username: string;
                displayName?: string;
                ambulatoryName?: string;
                role: string;
            } | null;
            if (!data) {
                setAuthErrorMessage('Errore durante il login.');
                return false;
            }
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

            const masterKey = await unwrapMasterKeyVersioned(encryptedMasterKey, pin, saltBytes);

            setActiveMasterKey(masterKey);
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

            // Lazy KDF upgrade: if the stored blob is below the current version,
            // re-wrap the (unchanged) master key at v2 and persist server-side.
            // Best-effort: a failure here never blocks a valid login.
            if (getKdfVersion(encryptedMasterKey) < CURRENT_KDF_VERSION) {
                try {
                    const newSalt = window.crypto.getRandomValues(new Uint8Array(16));
                    const rewrapped = await wrapMasterKeyVersioned(masterKey, pin, newSalt);
                    await rewrapMasterKeyRequest({
                        encryptedMasterKey: rewrapped,
                        salt: btoa(String.fromCharCode(...newSalt)),
                    });
                } catch (e) {
                    console.error('KDF lazy upgrade failed', e);
                }
            }

            return true;

        } catch (e) {
            console.error("Login failed", e);
            setAuthErrorMessage('Errore durante il login.');
            return false;
        }
    };

    /* @Codex */
    const changePin = async (currentPin: string, newPin: string): Promise<{ ok: true } | { ok: false; message: string }> => {
        if (!isAuthenticated || isLocked) {
            return { ok: false, message: "Sessione non disponibile. Effettua di nuovo l'accesso." };
        }

        const masterKey = masterKeyRef.current;
        if (!masterKey) {
            return { ok: false, message: "Chiave di sessione non disponibile. Effettua di nuovo l'accesso." };
        }

        const validationError = validatePinChangeInput(currentPin, newPin);
        if (validationError) {
            return { ok: false, message: validationError };
        }

        try {
            const rotation = await createPinRotationBundle(masterKey, newPin);
            const { response: res, payload } = await changePinRequest({
                currentPin,
                newPin,
                encryptedMasterKey: rotation.encryptedMasterKey,
                salt: rotation.salt,
            });

            if (!res.ok) {
                return { ok: false, message: formatPinChangeFailure((payload as PinChangeFailurePayload | null) ?? null, res.status) };
            }

            return { ok: true };
        } catch (e) {
            console.error('Change PIN failed', e);
            return { ok: false, message: 'Errore durante il cambio PIN.' };
        }
    };

    // Legacy setupPin (for context interface compatibility)
    const setupPin = async (pin: string): Promise<void> => {
        await handleWizardComplete({ displayName: 'Admin', ambulatoryName: 'Studio', pin });
    };

    // New handler for Onboarding Wizard
    const handleWizardComplete = async (data: { displayName: string; ambulatoryName: string; pin: string }) => {
        const { displayName, ambulatoryName, pin } = data;
        setFlowError(null);

        try {
            // Generate crypto. New setups wrap at the current KDF version (v2, 600k).
            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const masterKey = await generateMasterKey();
            const encryptedMasterKey = await wrapMasterKeyVersioned(masterKey, pin, salt);
            const saltB64 = btoa(String.fromCharCode(...salt));

            // Send to Server
            const { response: res, payload } = await setupSecurityRequest({
                username: 'admin',
                password: pin,
                encryptedMasterKey,
                salt: saltB64,
                displayName,
                ambulatoryName
            });

            /* @Codex */
            if (!res.ok) {
                if ((res.status === 403 || res.status === 409) && payload?.code === 'SETUP_ALREADY_COMPLETED') {
                    setRequiresSetup(false);
                    const success = await login(pin);
                    if (!success) {
                        setIsAuthenticated(false);
                        setIsLocked(true);
                        // Messaggio mostrato inline dalla LockScreen tramite authErrorMessage.
                        setAuthErrorMessage("Accesso già configurato.");
                    }
                    return;
                }

                throw new Error(payload?.error || "Setup failed server-side");
            }

            // Set Active
            setActiveMasterKey(masterKey);
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
            const detail = e instanceof Error ? e.message : String(e);
            setFlowError("Errore configurazione: " + detail);
        }
    };

    /* @Codex */
    if (authHealth?.status === 'error') {
        return (
            <>
                {flowError && (
                    <div
                        role="alert"
                        className="fixed top-4 left-1/2 z-[110] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700 shadow-lg"
                    >
                        {flowError}
                    </div>
                )}
                <AuthHealthScreen
                    health={authHealth}
                    onRetry={() => checkAuthStatus()}
                    onRepair={canOfferLegacyRepair(authHealth) ? repairFromLegacy : undefined}
                    isRepairing={isRepairing}
                />
            </>
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
                <div className="w-full max-w-2xl space-y-4">
                    {flowError && (
                        <div
                            role="alert"
                            className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                        >
                            {flowError}
                        </div>
                    )}
                    <OnboardingWizard onComplete={handleWizardComplete} />
                </div>
            </div>
        );
    }

    /* @Codex */
    if (isLocked || !isAuthenticated) {
        return (
            <SecurityContext.Provider value={{
                isAuthenticated,
                isLocked: true,
                requiresSetup: false,
                user,
                authErrorMessage,
                login,
                setupPin,
                changePin,
                lock,
                updateUser: (data) => setUser(prev => prev ? { ...prev, ...data } : null)
            }}>
                <LockScreen />
            </SecurityContext.Provider>
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
            changePin,
            lock,
            updateUser: (data) => setUser(prev => prev ? { ...prev, ...data } : null)
        }}>
            <div className="relative min-h-screen">
                {children}
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
