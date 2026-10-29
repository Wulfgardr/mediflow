'use client';

import { useEffect } from 'react';
import { useSecurity } from './security-provider';

export function LocalUiRuntimeLease() {
    const { isAuthenticated, isLocked, user } = useSecurity();
    useEffect(() => {
        if (!isAuthenticated || isLocked) return;
        const tab = crypto.randomUUID();
        let stopped = false, running = false;
        const send = (action: 'renew' | 'release') => fetch('/api/plugin-local-ui/lease', {
            method: 'POST', credentials: 'same-origin', keepalive: true,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab, action }),
        });
        const renew = async () => {
            if (stopped || running) return;
            running = true;
            try { const response = await send('renew'); if (response.status === 404) stopped = true; }
            catch { /* The server expires a document it can no longer hear. */ }
            finally { running = false; }
        };
        const release = () => { stopped = true; void send('release').catch(() => {}); };
        const timer = setInterval(() => { void renew(); }, 3000);
        window.addEventListener('pagehide', release);
        void renew();
        return () => { clearInterval(timer); window.removeEventListener('pagehide', release); release(); };
    }, [isAuthenticated, isLocked, user?.id]);
    return null;
}
