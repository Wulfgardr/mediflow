'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
    SECURITY_CONFIG,
    hasSecuritySetup,
    generateMasterKey,
    deriveKeyFromPin,
    storeSalt,
    getStoredSalt,
    wrapMasterKey,
    storeEncryptedMasterKey,
    getStoredEncryptedMasterKey,
    unwrapMasterKey
} from '@/lib/security';
import { db } from '@/lib/db';

interface SecurityContextType {
    isAuthenticated: boolean;
    isLocked: boolean;
    requiresSetup: boolean;
    login: (pin: string) => Promise<boolean>;
    setupPin: (pin: string) => Promise<void>;
    lock: () => void;
}

const SecurityContext = createContext<SecurityContextType | undefined>(undefined);

export function SecurityProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [requiresSetup, setRequiresSetup] = useState(true);
    const [isLocked, setIsLocked] = useState(true);

    // Timer for auto-lock
    const activityTimerRef = useRef<NodeJS.Timeout | null>(null);

    const lock = useCallback(() => {
        setIsLocked(true);
        setIsAuthenticated(false);
        // Clear sensitive data from memory if possible, though React state persists.
        // Ideally, we'd reload the page to clear the Master Key from Dexie instance, 
        // but for UX we just block the screen.
        // The key remains in `db` singleton until refresh. This is a known trade-off for SPA.
    }, []);

    const resetActivityTimer = useCallback(() => {
        if (activityTimerRef.current) {
            clearTimeout(activityTimerRef.current);
        }

        if (isAuthenticated && !isLocked) {
            activityTimerRef.current = setTimeout(() => {
                lock();
            }, SECURITY_CONFIG.AUTO_LOCK_TIMEOUT_MS);
        }
    }, [isAuthenticated, isLocked, lock]);

    // Initial check
    useEffect(() => {
        const hasSetup = hasSecuritySetup();
        setRequiresSetup(!hasSetup);

        // Always lock on fresh load to force PIN entry (essential for Key Derivation)
        setIsAuthenticated(false);
        setIsLocked(true);
    }, []);

    // Activity listeners
    useEffect(() => {
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];

        const handleActivity = () => {
            resetActivityTimer();
        };

        events.forEach(event => document.addEventListener(event, handleActivity));

        return () => {
            events.forEach(event => document.removeEventListener(event, handleActivity));
            if (activityTimerRef.current) {
                clearTimeout(activityTimerRef.current);
            }
        };
    }, [resetActivityTimer]);

    const login = async (pin: string): Promise<boolean> => {
        try {
            const salt = getStoredSalt();
            const encryptedMasterKey = getStoredEncryptedMasterKey();

            if (!salt || !encryptedMasterKey) {
                // Fallback: if setup says yes but no keys found (corruption), force reset?
                // Or maybe return false.
                console.error("Missing salt or key despite setup");
                return false;
            }

            // 1. Derive KEK from PIN
            const kek = await deriveKeyFromPin(pin, salt);

            // 2. Unwrap Master Key
            const masterKey = await unwrapMasterKey(encryptedMasterKey, kek);

            // 3. Inject Key into DB
            // @ts-ignore - setKey added in our custom class
            db.setKey(masterKey);

            // 4. Update State
            setIsAuthenticated(true);
            setIsLocked(false);
            resetActivityTimer();
            return true;

        } catch (e) {
            console.error("Login failed (wrong PIN?)", e);
            return false;
        }
    };

    const setupPin = async (pin: string): Promise<void> => {
        // 1. Generate Salt
        const salt = window.crypto.getRandomValues(new Uint8Array(16));

        // 2. Derive KEK
        const kek = await deriveKeyFromPin(pin, salt);

        // 3. Generate Master Key
        const masterKey = await generateMasterKey();

        // 4. Wrap Master Key
        const encryptedMasterKey = await wrapMasterKey(masterKey, kek);

        // 5. Store Persistence
        storeSalt(salt);
        storeEncryptedMasterKey(encryptedMasterKey);

        // 6. Set active state
        // @ts-ignore
        db.setKey(masterKey);
        setRequiresSetup(false);
        setIsAuthenticated(true);
        setIsLocked(false);
    };

    return (
        <SecurityContext.Provider value={{ isAuthenticated, isLocked, requiresSetup, login, setupPin, lock }}>
            {children}
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
