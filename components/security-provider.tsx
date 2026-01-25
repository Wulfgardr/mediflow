'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import {
    generateMasterKey,
    deriveKeyFromPin,
    wrapMasterKey,
    unwrapMasterKey
} from '@/lib/security';
import { db } from '@/lib/db';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { LockScreen } from '@/components/lock-screen';

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
    login: (pin: string) => Promise<boolean>;
    setupPin: (pin: string) => Promise<void>;
    lock: () => void;
    updateUser: (data: Partial<User>) => void;
}

const SecurityContext = createContext<SecurityContextType | undefined>(undefined);

export function SecurityProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [requiresSetup, setRequiresSetup] = useState<boolean | null>(null); // null = loading
    const [isLocked, setIsLocked] = useState(true);
    const [user, setUser] = useState<User | null>(null);

    // Inactivity Timeout
    const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 Minutes
    const activityTimerRef = useRef<NodeJS.Timeout | null>(null);

    const lock = () => {
        setIsLocked(true);
        // setIsAuthenticated(false); // Do not de-auth, just lock screen.
    };

    const resetTimer = () => {
        if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
        if (isAuthenticated && !isLocked) {
            activityTimerRef.current = setTimeout(() => {
                lock();
            }, INACTIVITY_TIMEOUT_MS);
        }
    };

    // Initial check
    useEffect(() => {
        const init = async () => {
            const restored = await restoreSession();
            checkAuthStatus(restored);
        };
        init();
    }, []);

    useEffect(() => {
        const handleActivity = () => resetTimer();

        // Listen to user events
        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', handleActivity);
            window.addEventListener('keydown', handleActivity);
            window.addEventListener('click', handleActivity);
            window.addEventListener('touchstart', handleActivity);

            resetTimer(); // Start initial timer
        }

        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('mousemove', handleActivity);
                window.removeEventListener('keydown', handleActivity);
                window.removeEventListener('click', handleActivity);
                window.removeEventListener('touchstart', handleActivity);
            }
            if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, isLocked]);

    const checkAuthStatus = async (isSessionRestored?: boolean) => {
        try {
            const res = await fetch('/api/auth/check');
            const data = await res.json();

            // If setup is missing on server, force setup flow regardless of session
            if (!data.isSetup) {
                setRequiresSetup(true);
                setIsAuthenticated(false);
            } else {
                // Setup exists.
                setRequiresSetup(false);
                // If we didn't restore session, we remain unauthenticated (showing lock screen if set)
                // If isSessionRestored is true, we are already authenticated via restoreSession
            }
        } catch (e) {
            console.error("Auth check failed", e);
            setRequiresSetup(true);
        }
    };

    // --- Session Persistence Helpers ---
    const saveSession = async (key: CryptoKey, userData: User) => {
        try {
            const jwk = await window.crypto.subtle.exportKey('jwk', key);
            sessionStorage.setItem('mediflow_session_key', JSON.stringify(jwk));
            sessionStorage.setItem('mediflow_user', JSON.stringify(userData));
        } catch (e) {
            console.error("Failed to save session", e);
        }
    };

    const restoreSession = async (): Promise<boolean> => {
        try {
            const jwkStr = sessionStorage.getItem('mediflow_session_key');
            const userStr = sessionStorage.getItem('mediflow_user');

            if (!jwkStr || !userStr) return false;

            const jwk = JSON.parse(jwkStr);
            const key = await window.crypto.subtle.importKey(
                'jwk',
                jwk,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );

            const userData = JSON.parse(userStr);

            db.setKey(key);
            setUser(userData);
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
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: pin })
            });

            if (!res.ok) return false;

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

            // Persist session
            await saveSession(masterKey, userData);

            return true;

        } catch (e) {
            console.error("Login failed", e);
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

            if (!res.ok) throw new Error("Setup failed server-side");

            // Set Active
            db.setKey(masterKey);
            setRequiresSetup(false);
            setIsAuthenticated(true);
            setIsLocked(false);

            // Persist
            const userData: User = { id: 'admin', username: 'admin', role: 'admin', displayName, ambulatoryName };
            setUser(userData);
            await saveSession(masterKey, userData);
        } catch (e) {
            console.error("Setup failed", e);
            alert("Errore configurazione: " + e);
        }
    };

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
