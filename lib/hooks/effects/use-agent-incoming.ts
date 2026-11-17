'use client';

import { useEffect } from 'react';
import { startAgentIncoming } from '../../agent-incoming';

export function useAgentIncoming(enabled: boolean) {
    useEffect(() => enabled ? startAgentIncoming() : undefined, [enabled]);
}
