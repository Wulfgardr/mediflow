'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { useSecurity } from './security-provider';

type Status = { pending: { nonce: string; expiresAt: number }[]; active: string[] };
const empty: Status = { pending: [], active: [] };

export function PluginLocalUiPairing() {
  const { isAuthenticated, isLocked, user } = useSecurity();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>(empty);
  useEffect(() => {
    setStatus(empty);
    if (!isAuthenticated || isLocked) return;
    const controller = new AbortController();
    let running = false;
    const poll = async () => {
      if (running || controller.signal.aborted || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const response = await fetch('/api/plugin-local-ui/pairing', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) { setStatus(empty); clearInterval(timer); return; }
        const value = await response.json() as Status;
        if (!controller.signal.aborted) setStatus(value);
      } catch { if (!controller.signal.aborted) setStatus(empty); }
      finally { running = false; }
    };
    const timer = setInterval(() => { void poll(); }, 500);
    void poll();
    return () => { clearInterval(timer); controller.abort(); };
  }, [isAuthenticated, isLocked, user?.id]);
  const decide = (event: MouseEvent<HTMLButtonElement>, nonce: string, action: 'allow' | 'deny' | 'revoke') => {
    if (!event.isTrusted || !navigator.userActivation.isActive || document.visibilityState !== 'visible' || !isAuthenticated || isLocked) return;
    setStatus(empty); setCode('');
    void fetch('/api/plugin-local-ui/pairing', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce, action, ...(action === 'allow' ? { code } : {}) }) }).catch(() => {});
  };
  if (!isAuthenticated || isLocked || (!status.pending.length && !status.active.length)) return null;
  return <aside aria-label="Collegamento del plugin" className="mx-auto max-w-3xl space-y-3 p-4">
    {status.pending.filter(request => request.expiresAt > Date.now()).map(request => <div key={request.nonce} className="rounded-xl border border-current/20 p-4">
      <p>Consenti a Codex/Claude di aprire schermate qui?</p>
      <label className="block">Codice temporaneo mostrato dal raccordo locale<input aria-label="Codice di abbinamento" autoComplete="off" spellCheck={false} className="mf-input block" value={code} onChange={event => setCode(event.target.value)} /></label>
      <p>Vale per questa sessione. Dati e decisioni cliniche restano in MediFlow.</p>
      <button type="button" className="mf-button-primary mt-3" onClick={event => decide(event, request.nonce, 'allow')}>Consenti</button>
      <button type="button" className="mf-button-secondary ml-2" onClick={event => decide(event, request.nonce, 'deny')}>Rifiuta</button>
    </div>)}
    {status.active.map(nonce => <button key={nonce} type="button" className="mf-button-secondary" onClick={event => decide(event, nonce, 'revoke')}>Revoca il collegamento del plugin</button>)}
  </aside>;
}
