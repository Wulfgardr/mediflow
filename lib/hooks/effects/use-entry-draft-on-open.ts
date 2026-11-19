'use client';

import { useEffect, useState } from 'react';
import { useSecurity } from '@/components/security-provider';
import { hasEntryDraft } from '@/hooks/use-entry-local-draft';

export function useEntryDraftOnOpen(patientId: string, enabled: boolean) {
    const userId = useSecurity().user?.id;
    const [open, setOpen] = useState(false);
    useEffect(() => {
        setOpen(Boolean(enabled && userId && ['', '#quadro'].includes(window.location.hash) && hasEntryDraft(userId, patientId)));
    }, [enabled, userId, patientId]);
    return [open, setOpen] as const;
}
