'use client';

import { useEffect } from 'react';

/* @Codex */
interface AppRevisionGuardProps {
  fingerprint: string;
}

/* @Codex */
const REVISION_RELOAD_MARKER_KEY = 'mediflow-ui-revision-reloaded';

/* @Codex */
export function AppRevisionGuard({ fingerprint }: AppRevisionGuardProps) {
  useEffect(() => {
    let cancelled = false;

    const checkRevision = async () => {
      try {
        const response = await fetch('/api/system/revision', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store',
          },
        });

        if (!response.ok || cancelled) return;

        const payload = (await response.json()) as { fingerprint?: string };
        const nextFingerprint = payload?.fingerprint;
        if (!nextFingerprint || nextFingerprint === fingerprint || cancelled) return;

        const lastReloadedFingerprint = window.sessionStorage.getItem(REVISION_RELOAD_MARKER_KEY);
        if (lastReloadedFingerprint === nextFingerprint) return;

        window.sessionStorage.setItem(REVISION_RELOAD_MARKER_KEY, nextFingerprint);
        window.location.reload();
      } catch {
        // No-op: drift checks must never block the UI.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkRevision();
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkRevision();
      }
    }, 15_000);

    window.addEventListener('focus', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fingerprint]);

  return null;
}
