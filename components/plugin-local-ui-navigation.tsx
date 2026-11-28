'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createLocalUiWork, readLocalUiWorkScope, LOCAL_UI_REVOKE_EVENT, type LocalUiWorkScope } from '@/lib/plugin-local-ui-work';
import { PluginLocalUiWorkContext } from './use-plugin-local-ui-work';
import { Disclosure } from './disclosure';
import PrivacyBlur from './privacy-blur';
import { useSecurity } from './security-provider';
import { db } from '@/lib/db';
import { isLocalUiIntent } from '@/packages/mcp/src/local-ui-intents.mjs';
import type { LocalUiIntent } from '@/packages/mcp/src/local-ui-contract';

const PluginLocalUiRuntime = createContext(false);

export function PluginLocalUiRuntimeProvider({ enabled, children }: Readonly<{ enabled: boolean; children: ReactNode }>) {
  const [work] = useState(createLocalUiWork);
  return <PluginLocalUiRuntime.Provider value={enabled}>
    <PluginLocalUiWorkContext.Provider value={enabled ? work : null}>{children}</PluginLocalUiWorkContext.Provider>
  </PluginLocalUiRuntime.Provider>;
}

const labels: Record<LocalUiIntent, string> = { search: 'Ricerca locale', identity: 'Anagrafica',
  history: 'Storia clinica e fonti', prescribing: 'Guida alla prescrizione',
  patient_insight: 'Quadro paziente', document_synthesis: 'Sintesi dei documenti', smart_import: 'Smart Import',
  new_patient_from_documents: 'Nuova scheda dai documenti' };
const routes = { search: '/?area=incarico', new_patient_from_documents: '/patients/new#documento' };
type RouteIntent = keyof typeof routes;
const opensRoute = (intent: LocalUiIntent): intent is RouteIntent => Object.hasOwn(routes, intent);
const anchors = {
  identity: 'identita', history: 'timeline', prescribing: 'plugin-prescribing',
  patient_insight: 'patient-insight', document_synthesis: 'document-synthesis', smart_import: 'smart-import',
};
async function selectionEpoch(signal: AbortSignal): Promise<number> {
  const response = await fetch('/api/patient-profile/selection-epoch', { cache: 'no-store', signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('context_unavailable');
  const value = await response.json();
  if (value.contractVersion !== 1 || !Number.isSafeInteger(value.selectionEpoch) || value.selectionEpoch < 0) throw new Error('context_unavailable');
  return value.selectionEpoch;
}

type Pending = { intent: LocalUiIntent; epoch: number | null; expiresAt: number; generation: number; scope: LocalUiWorkScope | null };
export function PluginLocalUiNavigation({ patientId, patientVersion, patientLabel }: Readonly<{
  patientId?: string; patientVersion?: number; patientLabel?: string;
}>) {
  const pluginLocalUi = useContext(PluginLocalUiRuntime);
  const work = useContext(PluginLocalUiWorkContext);
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
    let pendingScope: LocalUiWorkScope | null = null;
    const clear = () => {
      generation.current++; pendingScope = null; clearTimeout(expiry); epochRead?.abort(); epochRead = undefined; setPending(null);
    };
    const revoke = (link: string) => {
      if (pendingScope?.link === link) clear();
      work?.revoke(link);
    };
    const reset = () => { clear(); work?.reset(); };
    const onRevoke = (event: Event) => revoke((event as CustomEvent<string>).detail);
    const onMove = () => work?.move(window.location.hash);
    clear();
    events.onmessage = event => {
      if (event.data === 'revoke') { revoke(event.lastEventId); return; }
      if (event.data === 'reset') {
        if (!event.lastEventId) { clear(); work?.open(null); }
        else {
          if (pendingScope?.request === event.lastEventId) clear();
          work?.cancel(event.lastEventId);
        }
        return;
      }
      clear(); setMessage('');
      if (!isLocalUiIntent(event.data) || signal.aborted || document.visibilityState !== 'visible') return;
      const intent = event.data as LocalUiIntent, token = generation.current, expiresAt = Date.now() + 15_000;
      const scope = readLocalUiWorkScope(event.lastEventId);
      if (scope && work?.isRevoked(scope)) return;
      pendingScope = scope;
      expiry = setTimeout(clear, 15_000);
      const read = new AbortController(); epochRead = read;
      const requestSignal = AbortSignal.any([signal, read.signal]);
      const publish = (epoch: number | null) => {
        if (!current || requestSignal.aborted || token !== generation.current || expiresAt <= Date.now()) return;
        setPending({ intent, epoch, generation: token, expiresAt, scope });
      };
      if (!patientId || opensRoute(intent)) publish(null);
      else void selectionEpoch(requestSignal).then(publish).catch(() => { if (current && token === generation.current) clear(); });
    };
    const onVisibility = () => { if (document.visibilityState !== 'visible') clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(LOCAL_UI_REVOKE_EVENT, onRevoke);
    window.addEventListener('hashchange', onMove);
    window.addEventListener('pagehide', reset);
    events.onerror = () => { reset(); events.close(); };
    signal.addEventListener('abort', reset, { once: true });
    return () => {
      current = false; reset(); events.close();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(LOCAL_UI_REVOKE_EVENT, onRevoke);
      window.removeEventListener('hashchange', onMove);
      window.removeEventListener('pagehide', reset);
      signal.removeEventListener('abort', reset);
    };
  }, [pluginLocalUi, patientId, patientVersion, user?.id, isAuthenticated, isLocked, signal, work]);
  const confirm = async () => {
    const request = pending;
    if (!request || signal.aborted || isLocked || !isAuthenticated || request.expiresAt <= Date.now() || document.visibilityState !== 'visible') { setPending(null); return; }
    setPending(null);
    try {
      if (request.epoch !== null && await selectionEpoch(signal) !== request.epoch) throw new Error('context_changed');
      if (signal.aborted || request.generation !== generation.current || request.expiresAt <= Date.now() || document.visibilityState !== 'visible') return;
      if (opensRoute(request.intent) || !patientId) {
        work?.open(null);
        window.location.assign(opensRoute(request.intent) ? routes[request.intent] : routes.search);
        return;
      }
      const anchor = anchors[request.intent];
      work?.open(request.scope ? { scope: request.scope, intent: request.intent, patientId, anchor: `#${anchor}` } : null);
      if (window.location.hash === `#${anchor}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
      else window.location.hash = anchor;
    } catch { setMessage('La selezione è cambiata o non è disponibile. Richiedi di nuovo il percorso.'); }
  };
  if (isLocked || !isAuthenticated || (!pending && !message)) return null;
  return <aside aria-label="Richieste dal plugin" className="col-span-full space-y-3" data-testid="plugin-local-ui-navigation">
    {pending ? <div role="status" className="rounded-xl border border-current/20 p-4">
      {pending.intent === 'new_patient_from_documents' ? <>
        <p>{labels[pending.intent]}: scegli i documenti in questa finestra.</p>
        <button type="button" className="mf-button-primary mt-3" onClick={() => { void confirm(); }}>Apri la nuova scheda</button>
      </> : <>
        <p>{labels[pending.intent]}: {patientId ? <>conferma sulla cartella aperta di <PrivacyBlur>{patientLabel ?? 'questo paziente'}</PrivacyBlur>.</> : 'cerca e scegli il paziente in MediFlow.'}</p>
        <button type="button" className="mf-button-primary mt-3" onClick={() => { void confirm(); }}>{patientId ? 'Apri sulla cartella aperta' : 'Vai alla ricerca locale'}</button>
      </>}
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
  return <Disclosure open={open} onOpenChange={setOpen} id="plugin-prescribing" headingLevel={3} title="Guida alla prescrizione" className="space-y-3 scroll-mt-28">
    <p>Verifica paziente, indicazione e dati nella cartella. Scegli il percorso necessario; preparazione e revisione restano in MediFlow.</p>
    <nav aria-label="Tipo di prescrizione" className="flex flex-wrap gap-4">
      <a className="underline" href="#terapie">Farmaco: terapie farmacologiche</a>
      <a className="underline" href="#prestazioni">Prestazione: prescrizioni di servizi</a>
      <a className="underline" href="#protesica">Protesica: ausili e prescrizioni</a>
    </nav>
    <p>Il medico decide la terapia e verifica eventuali conferma, firma e trasmissione nei percorsi previsti. Il plugin apre soltanto questa guida.</p>
  </Disclosure>;
}
