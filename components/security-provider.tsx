'use client';
import { ARCHIVE_REPLACED_EVENT, installArchiveGenerationTransport } from '@/lib/security/client-auth-api';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
    generateMasterKey,
    getKdfVersion,
    CURRENT_KDF_VERSION,
    wrapMasterKeyVersioned,
    unwrapMasterKeyVersioned,
} from '@/lib/security/security';
import {
    createPinRotationBundle,
    formatPinChangeFailure,
    type PinChangeFailurePayload,
    validatePinChangeInput,
} from '@/lib/security/pin-change';
import { db } from '@/lib/db';
import { encryptRecoveryBackup, decryptRecoveryBackup, MAX_RECOVERY_DATABASE_BYTES } from '@/lib/recovery-backup';
import { OnboardingWizard, type SecuritySetup } from '@/components/onboarding-wizard';
import { RecoveryKitPanel, type PreparedRecoveryKit, type RecoveryKit, type AccessResult } from './recovery-kit';
import { LockScreen } from '@/components/lock-screen';
import { AppStartupScreen } from '@/components/app-startup-screen';
import { AuthHealthScreen } from '@/components/auth-health-screen';
import { useInactivityLock } from '@/lib/hooks/use-inactivity-lock';
import {
    clearSecuritySession,
    persistSecuritySession,
    restoreSecuritySession,
} from '@/lib/security/client-security-session';
import { notifyDbChange } from '@/lib/live-query';
import {
    checkAuthHealthRequest,
    changePinRequest,
    createClientAuthorityNetworkBarrier,
    loginWithPinRequest,
    loginWithVerifierRequest,
    readUnlockParameters,
    repairLegacyDbRequest,
    rewrapMasterKeyRequest,
    requestApplicationLockConfirmation,
    setupSecurityRequest,
    adoptPassphraseRequest,
    changePassphraseRequest,
    recoverPassphraseRequest,
    type AuthHealthPayload,
    type LoginFailurePayload,
    type UnlockParameters,
} from '@/lib/security/client-auth-api';
import { createUnlockWrapping, createRecoveryWrapping, openRecoveryWrapping, deriveUnlockMaterial, openUnlockWrapping } from '@/lib/security/unlock-credential';
import { planUnlock } from '@/lib/security/unlock-plan';
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from '@/lib/api-table-response';
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

/* client availability only; the server still owns every session/fence. */
type AuthRecoveryState = 'ready' | 'required' | 'pending' | 'failed';

interface SecurityContextType {
    isAuthenticated: boolean;
    isLocked: boolean;
    requiresSetup: boolean;
    user: User | null;
    authErrorMessage: string | null;
    authRecoveryState: AuthRecoveryState;
    /** ADR 0143: what the lock screen asks for. The server decides; the browser learns it from the auth check. */
    unlockCredential: UnlockParameters['credential'];
    /**
     * `shown` is what the field said while the person typed. 'confirm' means nothing was sent:
     * the text is long enough to be a passphrase and must be submitted again, unchanged.
     */
    login: (
        secret: string,
        options?: { shown?: UnlockParameters['credential']; longPinConfirmed?: boolean },
    ) => Promise<boolean | 'confirm'>;
    recoveryBackup: (artifact?: Uint8Array) => Promise<Uint8Array | void>;
    preparePassphraseChange: (secret: string, passphrase: string) => Promise<AccessResult>;
    preparePassphraseRecovery: (secret: string, passphrase: string, kit?: RecoveryKit) => Promise<AccessResult>;
    changePin: (currentPin: string, newPin: string) => Promise<{ ok: true } | { ok: false; message: string }>;
    sealClinicianSoapEntry: (fieldSet: ClinicianSoapEntryFieldSetV1) => Promise<ClinicianSoapEntrySealResult>;
    reopenClinicianSoapEntry: (
        bundle: ClinicianSoapEntrySealV1,
        expectedFieldSet: ClinicianSoapEntryFieldSetV1,
    ) => Promise<ClinicianSoapEntryReopenResult>;
    lock: () => void;
    updateUser: (data: Pick<User, 'id' | 'displayName' | 'ambulatoryName'>, isCurrent: () => boolean) => void;
}

function formatLockedUntil(lockedUntil?: string) {
    if (!lockedUntil) return 'Accesso temporaneamente bloccato. Riprova più tardi.';
    const date = new Date(lockedUntil);
    if (Number.isNaN(date.getTime())) return 'Accesso temporaneamente bloccato. Riprova più tardi.';
    return `Accesso bloccato fino alle ${new Intl.DateTimeFormat('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
    }).format(date)}.`;
}

function formatLoginFailure(payload: LoginFailurePayload | null, status: number, credential: UnlockParameters['credential'] = 'pin') {
    if (payload?.code === 'AUTH_LOCKED') {
        return payload.message || formatLockedUntil(payload.lockedUntil);
    }
    // The server words every denial for a PIN; an account with a passphrase is told what it actually typed.
    if (credential === 'passphrase' && status === 401) {
        return typeof payload?.remainingAttempts === 'number' && payload.remainingAttempts > 0
            ? `Passphrase non valida. Tentativi rimasti: ${payload.remainingAttempts}.`
            : 'Passphrase non valida.';
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
    const [pinResiduesPending, setPinResiduesPending] = useState(false);
    const [authRecoveryState, setAuthRecoveryState] = useState<AuthRecoveryState>('ready');
    const authRecoveryStateRef = useRef<AuthRecoveryState>('ready');
    const lockReceiptGenerationRef = useRef(0);
    const updateAuthRecoveryState = (state: AuthRecoveryState) => {
        authRecoveryStateRef.current = state;
        setAuthRecoveryState(state);
    };
    // What the lock screen asks for. It is what the person saw while typing, never what decides how
    // the secret travels: that is asked again at every unlock.
    const [unlockCredential, setUnlockCredential] = useState<UnlockParameters['credential']>('pin');
    const shownCredentialRef = useRef<UnlockParameters['credential']>('pin');
    const showUnlockCredential = (unlock: UnlockParameters | null) => {
        if (!unlock) return;
        shownCredentialRef.current = unlock.credential;
        setUnlockCredential(unlock.credential);
    };
    const masterKeyRef = useRef<CryptoKey | null>(null);
    const wrappingRef = useRef<{ encryptedMasterKey: string; salt: string } | null>(null);
    const preparedAccessRef = useRef<{ generation: number; commit: () => Promise<AccessResult> } | null>(null);
    const [preparedKit, setPreparedKit] = useState<PreparedRecoveryKit | null>(null);
    const accessCommitPending = useRef(false);
    const accessPreparePending = useRef(false);
    const authorityAttemptGenerationRef = useRef(0);
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
    const authorityNetworkBarrierRef = useRef<ReturnType<typeof createClientAuthorityNetworkBarrier> | null>(null);
    if (authorityNetworkBarrierRef.current === null) {
        authorityNetworkBarrierRef.current = createClientAuthorityNetworkBarrier();
    }
    const [authHealth, setAuthHealth] = useState<AuthHealthPayload | null>(null);
    const [isRepairing, setIsRepairing] = useState(false);
    // WUL-UIUX: errore inline per i flussi setup/ripristino, al posto di alert() nativo.
    // Il toast non e utilizzabile qui: ToastProvider e montato dentro SecurityProvider.
    const [flowError, setFlowError] = useState<string | null>(null);

    const setActiveMasterKey = (key: CryptoKey | null) => {
        masterKeyRef.current = key;
        db.setKey(key);
        notifyDbChange();
    };

    const clearClientAuthority = () => {
        clearSecuritySession();
        wrappingRef.current = null;
        preparedAccessRef.current = null;
        setPreparedKit(null);
        setActiveMasterKey(null);
        setUser(null);
        setIsAuthenticated(false);
        setIsLocked(true);
    };

    useEffect(() => {
        const uninstall = installArchiveGenerationTransport();
        const replaced = () => {
            ++authorityAttemptGenerationRef.current;
            clearClientAuthority();
        };
        window.addEventListener(ARCHIVE_REPLACED_EVENT, replaced);
        return () => { window.removeEventListener(ARCHIVE_REPLACED_EVENT, replaced); uninstall(); };
    }, []);

    const runAuthorityNetworkRequest = <T,>(request: () => Promise<T>): Promise<T> => {
        const barrier = authorityNetworkBarrierRef.current;
        return barrier ? barrier.run(request) : request();
    };

    const sealClinicianSoapEntry = (fieldSet: ClinicianSoapEntryFieldSetV1) =>
        clinicianSoapEntrySealOwnerRef.current!.seal(fieldSet);

    const reopenClinicianSoapEntry = (
        bundle: ClinicianSoapEntrySealV1,
        expectedFieldSet: ClinicianSoapEntryFieldSetV1,
    ) => clinicianSoapEntrySealOwnerRef.current!.reopen(bundle, expectedFieldSet);

    const lock = () => {
        const attemptGeneration = ++authorityAttemptGenerationRef.current;
        const receiptGeneration = ++lockReceiptGenerationRef.current;
        updateAuthRecoveryState('pending');
        setAuthErrorMessage(null);
        clearClientAuthority();

        const completeRecovery = (confirmed: boolean) => {
            // A late receipt cannot reopen the form during a newer lock.
            if (lockReceiptGenerationRef.current !== receiptGeneration) return;
            updateAuthRecoveryState(confirmed ? 'ready' : 'failed');
            if (!confirmed && authorityAttemptGenerationRef.current === attemptGeneration) {
                setAuthErrorMessage('Chiusura della sessione non confermata. Rinnova di nuovo l’accesso.');
            }
        };
        // The revocation fence must overtake any in-flight or queued login/setup request.
        // Only a later, explicit PIN gesture may start after this receipt settles.
        void requestApplicationLockConfirmation()
            .then(completeRecovery)
            .catch(() => completeRecovery(false));
    };

    useInactivityLock({
        enabled: isAuthenticated && !isLocked,
        onTimeout: lock,
    });

    useEffect(() => {
        const handleApiAuthUnavailable = (event: Event) => {
            const signal = (event as CustomEvent<{ sessionSignal?: AbortSignal | null }>).detail?.sessionSignal;
            if (signal && (signal.aborted || signal !== db.getSessionReadSignal())) return;
            ++authorityAttemptGenerationRef.current;
            clearClientAuthority();
            setAuthErrorMessage('Sessione scaduta.');
        };

        window.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, handleApiAuthUnavailable);
        return () => {
            window.removeEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, handleApiAuthUnavailable);
        };
    }, []);

    const checkAuthStatus = async () => {
        try {
            const { response: res, payload: data, controlState } = await checkAuthHealthRequest();
            if (controlState === 'stale') return;
            if (controlState === 'invalid') {
                setAuthHealth({
                    status: 'error',
                    error: { code: 'AUTH_CONTROL_INVALID', message: 'Controllo autenticazione non verificabile.' }
                });
                setRequiresSetup(false);
                clearClientAuthority();
                return;
            }
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

            if (data?.status === 'error' || data?.error) {
                setAuthHealth(data);
                setRequiresSetup(false);
                clearClientAuthority();
                return;
            }
            setAuthHealth(null);
            showUnlockCredential(readUnlockParameters(data.unlock));

            // If setup is missing on server, force setup flow regardless of session
            if (!data.isSetup) {
                clearClientAuthority();
                setRequiresSetup(true);
            } else {
                // Setup exists.
                setRequiresSetup(false);
                // if server session is missing, lock and clear local session
                if (data.hasSession === false) {
                    lock();
                    return;
                }
                /* a shared active cookie cannot restore this tab's key.
                   Offer an explicit renewal; mounting a tab must not lock its peers. */
                if (data.hasSession === true && masterKeyRef.current === null
                    && authRecoveryStateRef.current !== 'pending') {
                    updateAuthRecoveryState('required');
                }
            }
        } catch (e) {
            console.error("Auth check failed", e);
            setAuthHealth({
                status: 'error',
                error: { code: 'AUTH_CHECK_FAILED', message: 'Impossibile verificare lo stato di sicurezza.' }
            });
            setRequiresSetup(false);
            clearClientAuthority();
        }
    };

    const repairFromLegacy = async () => {
        if (isRepairing) return;
        setIsRepairing(true);
        setFlowError(null);
        try {
            const { response: res, payload } = await repairLegacyDbRequest();
            if (!res.ok) {
                throw new Error(payload?.error || 'Ripristino fallito');
            }
            if (res.status !== 202 || payload?.status !== 'accepted' || !payload.requestId) {
                throw new Error('Risposta di manutenzione non valida.');
            }
            clearClientAuthority();
            setFlowError('Riparazione avviata. Attendi il riavvio e la conferma dell’archivio.');
            const deadline = Date.now() + 20000;
            while (Date.now() < deadline) {
                await new Promise(resolve => window.setTimeout(resolve, 1000));
                try {
                    const status = await fetch('/api/auth/check', { cache: 'no-store' }).then(response => response.json());
                    if (status.archiveMaintenance?.requestId === payload.requestId) {
                        if (status.archiveMaintenance.status === 'committed') { window.location.reload(); return; }
                        if (status.archiveMaintenance.status === 'rejected') {
                            setFlowError('Archivio precedente non compatibile. I dati attuali sono invariati: accedi di nuovo per continuare.');
                            return;
                        }
                    }
                } catch { /* The owned Web process is expected to be unavailable during replacement. */ }
            }
            setFlowError('Riparazione non ancora confermata. Conserva l’archivio e verifica lo stato del supervisore.');
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
            const parameters = await askUnlockParameters();
            if (parameters?.credential !== 'pin') { clearSecuritySession(); return false; }
            const session = await restoreSecuritySession<User>();
            if (!session) return false;
            if (authorityAttemptGenerationRef.current !== attemptGeneration) return false;

            setActiveMasterKey(session.key);
            setUser(session.userData);
            setIsAuthenticated(true);
            setIsLocked(false);
            updateAuthRecoveryState('ready');
            return true;
        } catch (e) {
            console.error("Failed to restore session", e);
            return false;
        }
    };

    // Reconcile another tab's completed replacement before its displayed records can be reused.
    useEffect(() => {
        const reconcile = () => { if (document.visibilityState === 'visible') void checkAuthStatus(); };
        window.addEventListener('focus', reconcile);
        document.addEventListener('visibilitychange', reconcile);
        const timer = window.setInterval(reconcile, 15000);
        return () => {
            window.removeEventListener('focus', reconcile);
            document.removeEventListener('visibilitychange', reconcile);
            window.clearInterval(timer);
        };
    }, []);

    // Initial check
    useEffect(() => {
        const init = async () => {
            await restoreSession();
            await checkAuthStatus();
        };
        void init();
    }, []);

    /**
     * Asks the server, after the gesture, what unlocks the account; null when it cannot be known.
     * It only reads: session, lock state and what the lock screen shows are left to the caller.
     */
    const askUnlockParameters = async (): Promise<UnlockParameters | null> => {
        try {
            const { response, payload, controlState } = await checkAuthHealthRequest({ fresh: true });
            if (!response.ok || payload?.status !== 'ok' || controlState !== 'accepted') return null;
            return readUnlockParameters(payload.unlock);
        } catch {
            return null;
        }
    };

    const login = async (
        pin: string,
        options: { shown?: UnlockParameters['credential']; longPinConfirmed?: boolean } = {},
    ): Promise<boolean | 'confirm'> => {
        /* also guard direct/queued callers, before capturing the PIN request fence. */
        if (authRecoveryStateRef.current !== 'ready') return false;
        const attemptGeneration = ++authorityAttemptGenerationRef.current;
        let unacceptedServerAuthority = false;
        const shown = options.shown ?? shownCredentialRef.current;
        let credential: UnlockParameters['credential'] = shown;
        try {
            setAuthErrorMessage(null);
            // The account may have moved to a passphrase since this tab last looked: the server is
            // asked before anything is sent, and planUnlock decides. A passphrase typed into a
            // field that still said PIN stays here.
            const current = await askUnlockParameters();
            if (authorityAttemptGenerationRef.current !== attemptGeneration) return false;
            showUnlockCredential(current);
            const plan = planUnlock({ shown, current, secret: pin, longPinConfirmed: options.longPinConfirmed === true });
            // The lock screen shows the notice of a held text itself: no other message may stand in for it.
            if (plan.action === 'confirm-long-pin') return 'confirm';
            if (plan.action === 'refuse') {
                setAuthErrorMessage(plan.message);
                return false;
            }
            credential = plan.action === 'derive' ? 'passphrase' : 'pin';
            // ADR 0143: the passphrase never leaves this function. It becomes the key that opens the
            // wrapping, which stays here, and the verifier, which is all the server receives.
            let material: Awaited<ReturnType<typeof deriveUnlockMaterial>> | null = null;
            if (plan.action === 'derive') {
                material = await deriveUnlockMaterial(pin, Uint8Array.from(atob(plan.salt), (character) => character.charCodeAt(0)));
                if (authorityAttemptGenerationRef.current !== attemptGeneration) return false;
            }
            const result = await runAuthorityNetworkRequest(async () => {
                if (authorityAttemptGenerationRef.current !== attemptGeneration) return null;
                // Decided by the account, never by what the derivation returned: a passphrase is not sent as a PIN.
                return material ? loginWithVerifierRequest(material.verifier) : loginWithPinRequest(pin);
            });
            if (!result) return false;
            const { response: res, payload, controlState } = result;
            if (authorityAttemptGenerationRef.current !== attemptGeneration) return false;

            if (res.ok && controlState !== 'accepted') {
                lock();
                setAuthErrorMessage('Risposta di login non verificabile. Sessione bloccata.');
                return false;
            }

            if (!res.ok) {
                if (authorityAttemptGenerationRef.current === attemptGeneration) {
                    setAuthErrorMessage(formatLoginFailure((payload as LoginFailurePayload | null) ?? null, res.status, credential));
                }
                return false;
            }

            unacceptedServerAuthority = true;

            const data = payload as {
                encryptedMasterKey: string;
                salt: string | number[];
                id: string;
                username: string;
                displayName?: string;
                ambulatoryName?: string;
                role: string;
                earlierCopiesCleared?: boolean;
            } | null;
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

            const masterKey = material
                ? await openUnlockWrapping(encryptedMasterKey, material.kek)
                : await unwrapMasterKeyVersioned(encryptedMasterKey, pin, saltBytes);
            if (authorityAttemptGenerationRef.current !== attemptGeneration) {
                lock();
                return false;
            }
            unacceptedServerAuthority = false;

            wrappingRef.current = { encryptedMasterKey, salt: btoa(String.fromCharCode(...saltBytes)) };
            setActiveMasterKey(material ? await residentKey(masterKey) : masterKey);
            if (authorityAttemptGenerationRef.current !== attemptGeneration) { clearClientAuthority(); return false; }
            setUser(userData);
            setIsAuthenticated(true);
            setIsLocked(false);
            setAuthErrorMessage(null);
            if (material && typeof data.earlierCopiesCleared === 'boolean') setPinResiduesPending(!data.earlierCopiesCleared);

            // Persist session
            try {
                if (!material) await persistSecuritySession(masterKey, userData);
                else clearSecuritySession();
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
            if (unacceptedServerAuthority) {
                lock();
                setAuthErrorMessage('Errore durante il login.');
            } else if (authorityAttemptGenerationRef.current === attemptGeneration) {
                setAuthErrorMessage('Errore durante il login.');
            }
            return false;
        }
    };

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

            /* a successful credential CAS terminally retires this Web session. */
            ++authorityAttemptGenerationRef.current;
            clearClientAuthority();
            setAuthErrorMessage('PIN aggiornato. Accedi con il nuovo PIN.');
            return { ok: true };
        } catch (e) {
            console.error('Change PIN failed', e);
            /* after dispatch the server outcome may be terminal even if the response is lost. */
            if (pinMutationDispatched) lock();
            return { ok: false, message: 'Errore durante il cambio PIN.' };
        }
    };

    // The resident v3 key is never exported. Only a freshly opened wrapping is transiently exportable.
    const residentKey = async (transient: CryptoKey): Promise<CryptoKey> => {
        const bytes = new Uint8Array(await crypto.subtle.exportKey('raw', transient));
        try { return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
        finally { bytes.fill(0); }
    };

    const runPreparedAccessRequest = <T,>(generation: number, request: () => Promise<T>) =>
        runAuthorityNetworkRequest(async () => {
            if (generation !== authorityAttemptGenerationRef.current) throw new Error('Access operation expired.');
            return request();
        });

    const prepareAccess = async (key: CryptoKey, passphrase: string, username: string,
        request: (credentials: Awaited<ReturnType<typeof createUnlockWrapping>> & {
            recovery: { wrappedMasterKey: string; salt: string; verifier: string };
        }) => Promise<AccessResult>, generation: number): Promise<AccessResult> => {
        const unlock = await createUnlockWrapping(key, passphrase);
        const { recoveryKey, ...recovery } = await createRecoveryWrapping(key);
        if (generation !== authorityAttemptGenerationRef.current) return { ok: false, message: 'Accesso cambiato. Rinnova l’accesso e riprova.' };
        preparedAccessRef.current = { generation, commit: () => request({ ...unlock, recovery }) };
        setPreparedKit({ recoveryKey, kit: { schemaVersion: 'mediflow.recovery-kit.v1', username,
            wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt } });
        return { ok: true };
    };

    const finishAccessMutation = async (generation: number, result: { response: Response; payload: { success?: boolean; error?: string; message?: string; earlierCopiesCleared?: boolean } | null }): Promise<AccessResult> => {
        if (generation !== authorityAttemptGenerationRef.current) return { ok: false, message: 'Operazione scaduta. Rinnova l’accesso.' };
        if (!result.response.ok || result.payload?.success !== true) return { ok: false, message: result.payload?.message || result.payload?.error || 'Aggiornamento non confermato. Riprova.' };
        if (typeof result.payload.earlierCopiesCleared === 'boolean') setPinResiduesPending(!result.payload.earlierCopiesCleared);
        ++authorityAttemptGenerationRef.current;
        clearClientAuthority();
        setRequiresSetup(false);
        setUnlockCredential('passphrase');
        shownCredentialRef.current = 'passphrase';
        setAuthErrorMessage('Passphrase aggiornata. Rinnova l’accesso e sblocca con la nuova passphrase.');
        updateAuthRecoveryState('required');
        return { ok: true };
    };

    const recoveryBackup = async (artifact?: Uint8Array): Promise<Uint8Array | void> => {
        const key = masterKeyRef.current;
        const generation = authorityAttemptGenerationRef.current;
        if (!key || !isAuthenticated || isLocked || unlockCredential !== 'passphrase' || user?.role !== 'admin') {
            throw new Error('Sblocca con la passphrase dell’amministratore prima di continuare.');
        }
        const current = () => generation === authorityAttemptGenerationRef.current && masterKeyRef.current === key;
        let bytes: Uint8Array | undefined;
        try {
            if (artifact) {
                bytes = await decryptRecoveryBackup(artifact, key);
                if (!current()) throw new Error('Accesso scaduto. Rinnova l’accesso.');
                return;
            }
            const response = await fetch('/api/system/recovery-backup', { method: 'POST', cache: 'no-store',
                headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (!response.ok || Number(response.headers.get('Content-Length')) > MAX_RECOVERY_DATABASE_BYTES || !current()) {
                throw new Error('Backup completo non disponibile. Rinnova l’accesso e verifica l’archivio.');
            }
            bytes = new Uint8Array(await response.arrayBuffer());
            if (!current()) throw new Error('Accesso scaduto. Rinnova l’accesso.');
            const encrypted = await encryptRecoveryBackup(bytes, key);
            if (!current()) throw new Error('Accesso scaduto. Rinnova l’accesso.');
            return encrypted;
        } finally { bytes?.fill(0); }
    };

    const preparePassphraseChange = async (secret: string, passphrase: string): Promise<AccessResult> => {
        const snapshot = wrappingRef.current;
        if (!isAuthenticated || isLocked || !user || !snapshot || preparedAccessRef.current || accessPreparePending.current) return { ok: false, message: 'Rinnova l’accesso prima di cambiare la credenziale.' };
        const generation = authorityAttemptGenerationRef.current;
        accessPreparePending.current = true;
        try {
            const salt = Uint8Array.from(atob(snapshot.salt), character => character.charCodeAt(0));
            const material = unlockCredential === 'passphrase' ? await deriveUnlockMaterial(secret, salt) : null;
            const key = material ? await openUnlockWrapping(snapshot.encryptedMasterKey, material.kek)
                : await unwrapMasterKeyVersioned(snapshot.encryptedMasterKey, secret, salt);
            return await prepareAccess(key, passphrase, user.username, async credentials =>
                finishAccessMutation(generation, await runPreparedAccessRequest(generation, () => material
                    ? changePassphraseRequest({ currentVerifier: material.verifier, ...credentials })
                    : adoptPassphraseRequest({ currentPin: secret, ...credentials }))), generation);
        } catch { return { ok: false, message: 'Credenziale attuale non valida o nuova passphrase fuori dai limiti.' }; }
        finally { accessPreparePending.current = false; }
    };

    const preparePassphraseRecovery = async (secret: string, passphrase: string, kit?: RecoveryKit): Promise<AccessResult> => {
        if (!kit || authRecoveryStateRef.current !== 'ready' || preparedAccessRef.current || accessPreparePending.current) return { ok: false, message: 'Rinnova l’accesso e seleziona il kit prima di recuperare.' };
        const generation = authorityAttemptGenerationRef.current;
        accessPreparePending.current = true;
        try {
            const recovered = await openRecoveryWrapping(kit.wrappedMasterKey, kit.salt, secret);
            return await prepareAccess(recovered.masterKey, passphrase, kit.username, async credentials => {
                const result = await runPreparedAccessRequest(generation, () => recoverPassphraseRequest({ username: kit.username, recoveryVerifier: recovered.verifier, ...credentials }));
                if (result.response.ok && result.controlState !== 'accepted') { lock(); return { ok: false, message: 'Risposta di recupero non verificabile. Rinnova l’accesso.' }; }
                return finishAccessMutation(generation, result);
            }, generation);
        } catch { return { ok: false, message: 'Kit o chiave non validi, oppure nuova passphrase fuori dai limiti.' }; }
        finally { accessPreparePending.current = false; }
    };

    const handleWizardComplete = async ({ displayName, ambulatoryName, pin, passphrase }: SecuritySetup) => {
        const generation = ++authorityAttemptGenerationRef.current;
        const key = await generateMasterKey();
        const result = await prepareAccess(key, passphrase, 'admin', async credentials => {
            const result = await runPreparedAccessRequest(generation, () => setupSecurityRequest({ username: 'admin', password: pin, displayName, ambulatoryName, ...credentials }));
            if (result.response.status === 409 && result.payload?.code === 'SETUP_ALREADY_COMPLETED') {
                ++authorityAttemptGenerationRef.current; clearClientAuthority(); setRequiresSetup(false);
                updateAuthRecoveryState('required');
                return { ok: false, message: 'Configurazione già completata. Rinnova l’accesso.' };
            }
            if (result.response.ok && result.controlState !== 'accepted') { lock(); return { ok: false, message: 'Risposta di configurazione non verificabile. Rinnova l’accesso.' }; }
            return finishAccessMutation(generation, result);
        }, generation);
        if (!result.ok) throw new Error(result.message);
    };

    if (preparedKit) return <div className="fixed inset-0 z-[110] overflow-y-auto bg-[var(--lume-surface-canvas)] p-4 text-[var(--lume-ink)]">
        <div className="mx-auto max-w-2xl"><RecoveryKitPanel key={preparedKit.kit.wrappedMasterKey} prepared={preparedKit} onCancel={() => {
            preparedAccessRef.current = null; setPreparedKit(null);
        }} onCommit={async () => {
            const prepared = preparedAccessRef.current;
            if (!prepared || accessCommitPending.current || prepared.generation !== authorityAttemptGenerationRef.current) return { ok: false, message: 'Operazione scaduta. Rinnova l’accesso.' };
            accessCommitPending.current = true;
            try { return await prepared.commit(); }
            catch { lock(); return { ok: false, message: 'Esito non confermato. Rinnova l’accesso prima di riprovare.' }; }
            finally { accessCommitPending.current = false; }
        }} /></div>
    </div>;

    const pinResidueNotice = pinResiduesPending && <p role="alert" className="pointer-events-none relative z-[110] bg-[var(--lume-surface-canvas)] p-4" data-testid="pin-residue-notice">
        La passphrase è attiva, ma la rimozione delle vecchie copie del prodotto o del registro temporaneo non è confermata: possono ancora contenere l’involucro protetto dal PIN. Il prossimo sblocco ritenta la bonifica dell’archivio; le copie già migrate richiedono verifica e non vengono eliminate. Conserva backup e kit; se l’avviso resta, chiedi assistenza.
    </p>;

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
        return <AppStartupScreen />;
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

    if (isLocked || !isAuthenticated) {
        return (
            <SecurityContext.Provider value={{
                isAuthenticated,
                isLocked: true,
                requiresSetup: false,
                user,
                authErrorMessage,
                authRecoveryState,
                unlockCredential,
                login,
                recoveryBackup,
                preparePassphraseChange,
                preparePassphraseRecovery,
                changePin,
                sealClinicianSoapEntry,
                reopenClinicianSoapEntry,
                lock,
                updateUser: (data, isCurrent) => setUser(prev => isCurrent() && prev?.id === data.id ? { ...prev, ...data } : prev)
            }}>
                {pinResidueNotice}
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
            authRecoveryState,
            unlockCredential,
            login,
            recoveryBackup,
            preparePassphraseChange,
            preparePassphraseRecovery,
            changePin,
            sealClinicianSoapEntry,
            reopenClinicianSoapEntry,
            lock,
            updateUser: (data, isCurrent) => setUser(prev => isCurrent() && prev?.id === data.id ? { ...prev, ...data } : prev)
        }}>
            <div className="relative min-h-screen">
                {pinResidueNotice}
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
