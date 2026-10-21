'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import PrivacyBlur from './privacy-blur';
import { useSecurity } from './security-provider';
import { db } from '@/lib/db';
import { LOCAL_UI_INTENTS, type LocalUiIntent } from '@/packages/mcp/src/local-ui-contract';

const PluginLocalUiRuntime = createContext(false);

export function PluginLocalUiRuntimeProvider({ enabled, children }: Readonly<{ enabled: boolean; children: ReactNode }>) {
  return <PluginLocalUiRuntime.Provider value={enabled}>{children}</PluginLocalUiRuntime.Provider>;
}

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
  const pluginLocalUi = useContext(PluginLocalUiRuntime);
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
    if (!pluginLocalUi) return;
    let current = true;
    const events = new EventSource('/api/plugin-local-ui/events');
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let epochRead: AbortController | undefined;
    const clear = () => {
      generation.current++; clearTimeout(expiry); epochRead?.abort(); epochRead = undefined; setPending(null);
    };
    clear();
    events.onmessage = event => {
      clear(); setMessage('');
      if (!LOCAL_UI_INTENTS.includes(event.data as LocalUiIntent) || signal.aborted || document.visibilityState !== 'visible') return;
      const intent = event.data as LocalUiIntent, token = generation.current, expiresAt = Date.now() + 15_000;
      expiry = setTimeout(clear, 15_000);
      const read = new AbortController(); epochRead = read;
      const requestSignal = AbortSignal.any([signal, read.signal]);
      const publish = (epoch: number | null) => {
        if (!current || requestSignal.aborted || token !== generation.current || expiresAt <= Date.now()) return;
        setPending({ intent, epoch, generation: token, expiresAt });
      };
      if (!patientId || intent === 'search') publish(null);
      else void selectionEpoch(requestSignal).then(publish).catch(() => { if (current && token === generation.current) clear(); });
    };
    const onVisibility = () => { if (document.visibilityState !== 'visible') clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    events.onerror = () => { clear(); events.close(); };
    signal.addEventListener('abort', clear, { once: true });
    return () => { current = false; clear(); events.close(); document.removeEventListener('visibilitychange', onVisibility); signal.removeEventListener('abort', clear); };
  }, [pluginLocalUi, patientId, patientVersion, user?.id, isAuthenticated, isLocked, signal]);
  const confirm = async () => {
    const request = pending;
    if (!request || signal.aborted || isLocked || !isAuthenticated || request.expiresAt <= Date.now() || document.visibilityState !== 'visible') { setPending(null); return; }
    setPending(null);
    try {
      if (request.epoch !== null && await selectionEpoch(signal) !== request.epoch) throw new Error('context_changed');
      if (signal.aborted || request.generation !== generation.current || request.expiresAt <= Date.now() || document.visibilityState !== 'visible') return;
      if (request.intent === 'search' || !patientId) { window.location.assign('/?area=incarico'); return; }
      const target = document.getElementById(anchors[request.intent]);
      if (target instanceof HTMLDetailsElement) target.open = true;
      window.location.hash = anchors[request.intent];
      target?.scrollIntoView({ block: 'start' });
    } catch { setMessage('La selezione è cambiata o non è disponibile. Richiedi di nuovo il percorso.'); }
  };
  if (isLocked || !isAuthenticated || (!pending && !message)) return null;
  return <aside aria-label="Richieste dal plugin" className="col-span-full space-y-3" data-testid="plugin-local-ui-navigation">
    {pending ? <div role="status" className="rounded-xl border border-current/20 p-4">
      <p>{labels[pending.intent]}: {patientId ? <>conferma sulla cartella aperta di <PrivacyBlur>{patientLabel ?? 'questo paziente'}</PrivacyBlur>.</> : 'cerca e scegli il paziente in MediFlow.'}</p>
      <button type="button" className="mf-button-primary mt-3" onClick={() => { void confirm(); }}>{patientId ? 'Apri sulla cartella aperta' : 'Vai alla ricerca locale'}</button>
      <button type="button" className="mf-button-secondary ml-2" onClick={() => { generation.current++; setPending(null); }}>Annulla</button>
    </div> : null}
    {message ? <p role="alert">{message}</p> : null}
  </aside>;
}

export function PluginPrescribingGuide() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () => setOpen(window.location.hash === '#plugin-prescribing');
    update(); window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} id="plugin-prescribing" aria-labelledby="plugin-prescribing-title" className="col-span-full space-y-3 rounded-xl border border-current/20 p-4 scroll-mt-28">
    <summary className="cursor-pointer"><h2 id="plugin-prescribing-title" className="inline">Guida alla prescrizione</h2></summary>
    <p>Verifica paziente, indicazione e dati nella cartella. Scegli il percorso necessario; preparazione e revisione restano in MediFlow.</p>
    <nav aria-label="Tipo di prescrizione" className="flex flex-wrap gap-4">
      <a className="underline" href="#terapie">Farmaco: terapie farmacologiche</a>
      <a className="underline" href="#prestazioni">Prestazione: prescrizioni di servizi</a>
      <a className="underline" href="#protesica">Protesica: ausili e prescrizioni</a>
    </nav>
    <p>Il medico decide la terapia e verifica eventuali conferma, firma e trasmissione nei percorsi previsti. Il plugin apre soltanto questa guida.</p>
  </details>;
}
