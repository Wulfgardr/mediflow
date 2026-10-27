'use client';

import { db } from '@/lib/db';
import { captureClientAccountAuthority } from '@/lib/security/client-auth-api';

export type CockpitSnapshot<T> = { rows: T[]; isCurrent: () => boolean; retainOnRefresh: boolean };

function ambulatoryCookie(): string | null {
  const values = document.cookie.split(';').map(value => value.trim()).filter(value => value.startsWith('ambulatory_id='));
  if (values.length > 1) throw new Error('Ambulatory selection ambiguous.');
  return values[0]?.length > 'ambulatory_id='.length ? values[0] : null;
}

export async function readCockpitRows<T>(
  read: (options: { signal: AbortSignal; rejectAuthUnavailable: true }) => Promise<T[]>,
  visibility: { valid: boolean },
): Promise<CockpitSnapshot<T>> {
  const signal = db.getSessionReadSignal();
  const authorityCurrent = captureClientAccountAuthority();
  const cookie = ambulatoryCookie();
  const isCurrent = () => {
    try {
      return visibility.valid && !signal.aborted && db.getSessionReadSignal() === signal
        && authorityCurrent() && ambulatoryCookie() === cookie;
    } catch { return false; }
  };
  const rows = await read({ signal, rejectAuthUnavailable: true });
  if (!isCurrent()) throw new Error('Cockpit read context changed.');
  return { rows, isCurrent, retainOnRefresh: cookie !== null };
}

