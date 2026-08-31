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
    createClientAuthorityNetworkBarrier,
    loginWithPinRequest,
    repairLegacyDbRequest,
    rewrapMasterKeyRequest,
    requestApplicationLockConfirmation,
    setupSecurityRequest,
    type AuthHealthPayload,
    type LoginFailurePayload,
} from '@/lib/security/client-auth-api';
/* @Codex */
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from '@/lib/api-table-response';
/* @Codex */
import {
    createClinicianSoapEntrySealOwner,
    type ClinicianSoapEntryReopenResult,
    type ClinicianSoapEntrySealOwner,
    type ClinicianSoapEntrySealResult,
    type ClinicianSoapEntrySealV1,
} from '@/lib/headless/clinician-soap-entry-seal';
import type { ClinicianSoapEntryFieldSetV1 } from '@/lib/headless/clinician-soap-entry-field-set';

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
    sealClinicianSoapEntry: (fieldSet: ClinicianSoapEntryFieldSetV1) => Promise<ClinicianSoapEntrySealResult>;
    reopenClinicianSoapEntry: (
        bundle: ClinicianSoapEntrySealV1,
        expectedFieldSet: ClinicianSoapEntryFieldSetV1,
    ) => Promise<ClinicianSoapEntryReopenResult>;
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
    const authorityAttemptGenerationRef = useRef(0);
    /* @Codex */
    const clinicianSoapEntrySealOwnerRef = useRef<ClinicianSoapEntrySealOwner | null>(null);
    if (clinicianSoapEntrySealOwnerRef.current === null) {
        const browserCrypto = globalThis.crypto;
        clinicianSoapEntrySealOwnerRef.current = createClinicianSoapEntrySealOwner({
            readAuthority: () => {
                const key = masterKeyRef.current;
                return key ? { key, generation: authorityAttemptGenerationRef.current } : null;
            },
            crypto: {
                subtle: browserCrypto.subtle,
                getRandomValues: (target) => browserCrypto.getRandomValues(target),
            },
        });
    }
    /* @Codex */
    const authorityNetworkBarrierRef = useRef<ReturnType<typeof createClientAuthorityNetworkBarrier> | null>(null);
    if (authorityNetworkBarrierRef.current === null) {
        authorityNetworkBarrierRef.current = createClientAuthorityNetworkBarrier();
    }
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

    /* @Codex */
    const clearClientAuthority = () => {
        clearSecuritySession();
        setActiveMasterKey(null);
        setUser(null);
        setIsAuthenticated(false);
        setIsLocked(true);
    };

    /* @Codex */
    const runAuthorityNetworkRequest = <T,>(request: () => Promise<T>): Promise<T> => {
        const barrier = authorityNetworkBarrierRef.current;
        return barrier ? barrier.run(request) : request();
    };

    /* @Codex */
    const sealClinicianSoapEntry = (fieldSet: ClinicianSoapEntryFieldSetV1) =>
        clinicianSoapEntrySealOwnerRef.current!.seal(fieldSet);

    /* @Codex */
    const reopenClinicianSoapEntry = (
        bundle: ClinicianSoapEntrySealV1,
        expectedFieldSet: ClinicianSoapEntryFieldSetV1,
    ) => clinicianSoapEntrySealOwnerRef.current!.reopen(bundle, expectedFieldSet);

    /* @Codex */
    const lock = () => {
        const attemptGeneration = ++authorityAttemptGenerationRef.current;
        setAuthErrorMessage(null);
        clearClientAuthority();

        // The revocation fence must overtake any in-flight or queued login/setup request.
        void requestApplicationLockConfirmation()
            .then((confirmed) => {
                if (!confirmed && authorityAttemptGenerationRef.current === attemptGeneration) {
                    setAuthErrorMessage('Server lock not confirmed.');
                }
            })
            .catch(() => {
                if (authorityAttemptGenerationRef.current === attemptGeneration) {
                    setAuthErrorMessage('Server lock not confirmed.');
                }
            });
    };

    useInactivityLock({
        enabled: isAuthenticated && !isLocked,
        onTimeout: lock,
    });

    /* @Codex */
    useEffect(() => {
        const handleApiAuthUnavailable = () => {
            ++authorityAttemptGenerationRef.current;
            clearClientAuthority();
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
            const { response: res, payload: data, controlState } = await checkAuthHealthRequest();
            /* @Codex */
            if (controlState === 'stale') return;
            /* @Codex */
            if (controlState === 'invalid') {
                setAuthHealth({
                    status: 'error',
                    error: { code: 'AUTH_CONTROL_INVALID', message: 'Controllo autenticazione non verificabile.' }
                });
                setRequiresSetup(false);
                clearClientAuthority();
                return;
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
                clearClientAuthority();
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
                clearClientAuthority();
                return;
            }

            /* @Codex */
            if (data?.status === 'error' || data?.error) {
                setAuthHealth(data);
                setRequiresSetup(false);
                clearClientAuthority();
                return;
            }
            /* @Codex */
            setAuthHealth(null);

            // If setup is missing on server, force setup flow regardless of session
            if (!data.isSetup) {
                clearClientAuthority();
                setRequiresSetup(true);
            } else {
                // Setup exists.
                setRequiresSetup(false);
                // @Codex - if server session is missing, lock and clear local session
                if (data.hasSession === false) {
                    lock();
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
            clearClientAuthority();
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
        const attemptGeneration = ++authorityAttemptGenerationRef.current;
        try {
            const session = await restoreSecuritySession<User>();
            if (!session) return false;
            if (authorityAttemptGenerationRef.current !== attemptGeneration) return false;

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
        const attemptGeneration = ++authorityAttemptGenerationRef.current;
        /* @Codex */
        let unacceptedServerAuthority = false;
        try {
            setAuthErrorMessage(null);
            const result = await runAuthorityNetworkRequest(async () => {
                if (authorityAttemptGenerationRef.current !== attemptGeneration) return null;
                return loginWithPinRequest(pin);
            });
            if (!result) return false;
            const { response: res, payload, controlState } = result;
            if (authorityAttemptGenerationRef.current !== attemptGeneration) return false;

            /* @Codex */
            if (res.ok && controlState !== 'accepted') {
                lock();
                setAuthErrorMessage('Risposta di login non verificabile. Sessione bloccata.');
                return false;
            }

            if (!res.ok) {
                if (authorityAttemptGenerationRef.current === attemptGeneration) {
                    setAuthErrorMessage(formatLoginFailure((payload as LoginFailurePayload | null) ?? null, res.status));
                }
                return false;
            }

            /* @Codex */
            unacceptedServerAuthority = true;

            const data = payload as {
                encryptedMasterKey: string;
                salt: string | number[];
                id: string;
                username: string;
                displayName?: string;
                ambulatoryName?: string;
                role: string;
            } | null;
            /* @Codex */
            if (!data
                || typeof data.id !== 'string' || !data.id
                || typeof data.username !== 'string' || !data.username
                || typeof data.role !== 'string' || !data.role
                || typeof data.encryptedMasterKey !== 'string' || !data.encryptedMasterKey
                || !(typeof data.salt === 'string'
                    || (Array.isArray(data.salt) && data.salt.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)))
                || (data.displayName !== undefined && data.displayName !== null && typeof data.displayName !== 'string')
                || (data.ambulatoryName !== undefined && data.ambulatoryName !== null && typeof data.ambulatoryName !== 'string')) {
                lock();
                setAuthErrorMessage('Errore durante il login.');
                return false;
            }
            const { encryptedMasterKey, salt } = data;
            /* @Codex */
            const userData: User = {
                id: data.id,
                username: data.username,
                role: data.role,
                ...(typeof data.displayName === 'string' ? { displayName: data.displayName } : {}),
                ...(typeof data.ambulatoryName === 'string' ? { ambulatoryName: data.ambulatoryName } : {}),
            };

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
            if (authorityAttemptGenerationRef.current !== attemptGeneration) {
                lock();
                return false;
            }
            /* @Codex */
            unacceptedServerAuthority = false;

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
            if (authorityAttemptGenerationRef.current !== attemptGeneration) {
                clearClientAuthority();
                return false;
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
            /* @Codex */
            if (unacceptedServerAuthority) {
                lock();
                setAuthErrorMessage('Errore durante il login.');
            } else if (authorityAttemptGenerationRef.current === attemptGeneration) {
                setAuthErrorMessage('Errore durante il login.');
            }
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

        /* @Codex */
        let pinMutationDispatched = false;
        try {
            const rotation = await createPinRotationBundle(masterKey, newPin);
            pinMutationDispatched = true;
            const { response: res, payload } = await changePinRequest({
                currentPin,
                newPin,
                encryptedMasterKey: rotation.encryptedMasterKey,
                salt: rotation.salt,
            });

            if (!res.ok) {
                return { ok: false, message: formatPinChangeFailure((payload as PinChangeFailurePayload | null) ?? null, res.status) };
            }

            /* @Codex - a successful credential CAS terminally retires this Web session. */
            ++authorityAttemptGenerationRef.current;
            clearClientAuthority();
            setAuthErrorMessage('PIN aggiornato. Accedi con il nuovo PIN.');
            return { ok: true };
        } catch (e) {
            console.error('Change PIN failed', e);
            /* @Codex - after dispatch the server outcome may be terminal even if the response is lost. */
            if (pinMutationDispatched) lock();
            return { ok: false, message: 'Errore durante il cambio PIN.' };
        }
    };

    // Legacy setupPin (for context interface compatibility)
    const setupPin = async (pin: string): Promise<void> => {
        await handleWizardComplete({ displayName: 'Admin', ambulatoryName: 'Studio', pin });
    };

    // New handler for Onboarding Wizard
    const handleWizardComplete = async (data: { displayName: string; ambulatoryName: string; pin: string }) => {
        const attemptGeneration = ++authorityAttemptGenerationRef.current;
        const { displayName, ambulatoryName, pin } = data;
        setFlowError(null);

        try {
            // Generate crypto. New setups wrap at the current KDF version (v2, 600k).
            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const masterKey = await generateMasterKey();
            const encryptedMasterKey = await wrapMasterKeyVersioned(masterKey, pin, salt);
            const saltB64 = btoa(String.fromCharCode(...salt));
            if (authorityAttemptGenerationRef.current !== attemptGeneration) return;

            // Send to Server
            const result = await runAuthorityNetworkRequest(async () => {
                if (authorityAttemptGenerationRef.current !== attemptGeneration) return null;
                return setupSecurityRequest({
                    username: 'admin',
                    password: pin,
                    encryptedMasterKey,
                    salt: saltB64,
                    displayName,
                    ambulatoryName
                });
            });
            if (!result) return;
            const { response: res, payload, controlState } = result;
            if (authorityAttemptGenerationRef.current !== attemptGeneration) return;

            /* @Codex */
            if (res.ok && controlState !== 'accepted') {
                lock();
                setFlowError('Risposta di configurazione non verificabile. Sessione bloccata.');
                return;
            }

            /* @Codex */
            if (!res.ok) {
                if (res.status === 409 && payload?.code === 'SETUP_ALREADY_COMPLETED') {
                    clearClientAuthority();
                    setRequiresSetup(false);
                    // Il recupero richiede un nuovo gesto esplicito sulla LockScreen.
                    setAuthErrorMessage("Accesso già configurato. Accedi con il PIN.");
                    return;
                }

                throw new Error(payload?.error || "Setup failed server-side");
            }

            /* @Codex */
            if (payload?.success !== true) {
                lock();
                setFlowError('Risposta di configurazione non valida. Sessione bloccata.');
                return;
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
            if (authorityAttemptGenerationRef.current !== attemptGeneration) {
                clearClientAuthority();
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
                        className="fixed top-4 left-1/2 z-[110] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_12%,var(--lume-surface-field))] px-4 py-3 text-center text-sm text-[color:var(--lume-signal-critical)] shadow-lg"
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
        return <div className="flex h-screen items-center justify-center bg-[color:var(--lume-surface-canvas)] text-[color:var(--lume-ink-muted)]">Caricamento sicurezza...</div>;
    }

    // Onboarding Wizard for first-time setup
    if (requiresSetup) {
        return (
            <div className="fixed inset-0 z-[100] flex h-screen w-screen items-center justify-center bg-[color:var(--lume-surface-canvas)] p-4 text-[color:var(--lume-ink)]">
                <div className="w-full max-w-2xl space-y-4">
                    {flowError && (
                        <div
                            role="alert"
                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_12%,var(--lume-surface-field))] px-4 py-3 text-sm text-[color:var(--lume-signal-critical)]"
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
                sealClinicianSoapEntry,
                reopenClinicianSoapEntry,
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
            sealClinicianSoapEntry,
            reopenClinicianSoapEntry,
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
