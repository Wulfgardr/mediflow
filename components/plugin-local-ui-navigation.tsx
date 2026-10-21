'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSecurity } from './security-provider';
import { db } from '@/lib/db';
import { LOCAL_UI_INTENTS, type LocalUiIntent } from '@/packages/mcp/src/local-ui-contract';

const labels: Record<LocalUiIntent, string> = { search: 'Ricerca locale', identity: 'Anagrafica',
  history: 'Storia clinica e fonti', prescribing: 'Guida alla prescrizione' };
const anchors = { identity: 'identita', history: 'timeline', prescribing: 'plugin-prescribing' };
async function selectionEpoch(signal: AbortSignal): Promise<number> {
  const response = await fetch('/api/patient-profile/selection-epoch', { cache: 'no-store', signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('context_unavailable');
  const value = await response.json();
  if (value.contractVersion !== 1 || !Number.isSafeInteger(value.selectionEpoch) || value.selectionEpoch < 0) throw new Error('context_unavailable');
  return value.selectionEpoch;
}

type Pending = { intent: LocalUiIntent; epoch: number | null; expiresAt: number; generation: number };
export function PluginLocalUiNavigation({ patientId, patientVersion, patientLabel }: Readonly<{
  patientId?: string; patientVersion?: number; patientLabel?: string;
}>) {
  const { user, isLocked, isAuthenticated } = useSecurity();
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const signal = db.getSessionReadSignal();
  useLayoutEffect(() => {
    generation.current++; setPending(null);
    return () => { generation.current++; };
  }, [patientId, patientVersion, user?.id, isAuthenticated, isLocked, signal]);
  useEffect(() => {
    let current = true;
    const events = new EventSource('/api/plugin-local-ui/events');
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { generation.current++; clearTimeout(expiry); setPending(null); };
    clear();
    events.onmessage = event => {
      clear(); setMessage('');
      if (!LOCAL_UI_INTENTS.includes(event.data as LocalUiIntent) || signal.aborted || document.visibilityState !== 'visible') return;
      const intent = event.data as LocalUiIntent, token = generation.current;
      const publish = (epoch: number | null) => {
        if (!current || signal.aborted || token !== generation.current) return;
        setPending({ intent, epoch, generation: token, expiresAt: Date.now() + 15_000 });
        expiry = setTimeout(clear, 15_000);
      };
      if (!patientId || intent === 'search') publish(null);
      else void selectionEpoch(signal).then(publish).catch(() => { if (current && token === generation.current) clear(); });
    };
    const onVisibility = () => { if (document.visibilityState !== 'visible') clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    events.onerror = () => { clear(); events.close(); };
    signal.addEventListener('abort', clear, { once: true });
    return () => { current = false; clear(); events.close(); document.removeEventListener('visibilitychange', onVisibility); signal.removeEventListener('abort', clear); };
  }, [patientId, patientVersion, user?.id, isAuthenticated, isLocked, signal]);
  const confirm = async () => {
    const request = pending;
    if (!request || signal.aborted || isLocked || !isAuthenticated || request.expiresAt <= Date.now() || document.visibilityState !== 'visible') { setPending(null); return; }
    setPending(null);
    try {
      if (request.epoch !== null && await selectionEpoch(signal) !== request.epoch) throw new Error('context_changed');
      if (signal.aborted || request.generation !== generation.current || request.expiresAt <= Date.now() || document.visibilityState !== 'visible') return;
      if (request.intent === 'search' || !patientId) { window.location.assign('/?area=incarico'); return; }
      window.location.hash = anchors[request.intent];
      document.getElementById(anchors[request.intent])?.scrollIntoView({ block: 'start' });
    } catch { setMessage('La selezione è cambiata o non è disponibile. Richiedi di nuovo il percorso.'); }
  };
  if (isLocked || !isAuthenticated) return null;
  return <aside aria-label="Richieste dal plugin" className="space-y-3" data-testid="plugin-local-ui-navigation">
    {pending ? <div role="status" className="rounded-xl border border-current/20 p-4">
      <p>{labels[pending.intent]}: {patientId ? `conferma sulla cartella aperta di ${patientLabel ?? 'questo paziente'}.` : 'cerca e scegli il paziente in MediFlow.'}</p>
      <button type="button" className="mf-button-primary mt-3" onClick={() => { void confirm(); }}>{patientId ? 'Apri sulla cartella aperta' : 'Vai alla ricerca locale'}</button>
      <button type="button" className="mf-button-secondary ml-2" onClick={() => { generation.current++; setPending(null); }}>Annulla</button>
    </div> : null}
    {message ? <p role="alert">{message}</p> : null}
  </aside>;
}

export function PluginPrescribingGuide() {
  return <section id="plugin-prescribing" aria-labelledby="plugin-prescribing-title" className="space-y-3 rounded-xl border border-current/20 p-4 scroll-mt-28">
    <h2 id="plugin-prescribing-title">Guida alla prescrizione</h2>
    <p>Verifica paziente, indicazione e dati nella cartella. Scegli il percorso necessario; preparazione e revisione restano in MediFlow.</p>
    <nav aria-label="Tipo di prescrizione" className="flex flex-wrap gap-4">
      <a className="underline" href="#terapie">Farmaco: terapie farmacologiche</a>
      <a className="underline" href="#prestazioni">Prestazione: prescrizioni di servizi</a>
      <a className="underline" href="#protesica">Protesica: ausili e prescrizioni</a>
    </nav>
    <p>Il medico decide la terapia e verifica eventuali conferma, firma e trasmissione nei percorsi previsti. Il plugin apre soltanto questa guida.</p>
  </section>;
}
