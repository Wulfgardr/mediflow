'use client';

import { useSecurity } from './security-provider';
import { useAgentIncoming } from '@/lib/hooks/effects/use-agent-incoming';

export function AgentIncomingRunner() {
    const { isLocked, unlockCredential, user } = useSecurity();
    useAgentIncoming(!isLocked && unlockCredential === 'passphrase' && user?.role === 'admin');
    return null;
}
