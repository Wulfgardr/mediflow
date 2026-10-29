'use client';

import { useEffect } from 'react';
import { useSecurity } from './security-provider';
import { startLocalUiDocumentLease } from '@/lib/local-ui-document-lease';

export function LocalUiRuntimeLease() {
    const { isAuthenticated, isLocked, user } = useSecurity();
    useEffect(() => {
        if (!isAuthenticated || isLocked) return;
        return startLocalUiDocumentLease(window, (tab, action) => fetch('/api/plugin-local-ui/lease', {
            method: 'POST', credentials: 'same-origin', keepalive: true,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab, action }),
        }));
    }, [isAuthenticated, isLocked, user?.id]);
    return null;
}
