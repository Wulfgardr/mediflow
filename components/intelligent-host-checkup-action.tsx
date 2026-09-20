'use client';

/* @Codex */

import { Clipboard, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import { notifyDbChange } from '@/lib/live-query';
import { IntelligentHostCheckupBrowserAdapterError,
  createIntelligentHostCheckupBrowserAdapter } from '@/lib/security/intelligent-host-checkup-browser-adapter';

import popoverStyles from './intelligent-host-checkup-action.module.css';

type Checkup = Readonly<{ id: string; title: string; status?: string; version?: number }>;
type Proposal = Readonly<{ proposalRef: string; targetStatus: 'completed' | 'cancelled';
  expectedRevision: number; expiresAt: number; resourceTitle: string; resourceRevision: number }>;
type SelectedResource = Readonly<{ checkupId: string; title: string; revision: number }>;
type PopoverPosition = Readonly<{ top: number; left: number }>;
const actionClass = `${workspaceStyles.headerActionButton} min-h-11 min-w-11 sm:min-w-0 disabled:cursor-not-allowed disabled:opacity-[0.55]`;
const POPOVER_GUTTER = 8;
const POPOVER_WIDTH_REM = 22;
const POPOVER_MIN_HEIGHT = 160;
function status(error: unknown): string {
  if (!(error instanceof IntelligentHostCheckupBrowserAdapterError)) return 'Operazione non verificabile. Rileggi la proposta prima di riprovare.';
  if (error.code === 'session_unavailable') return 'Sessione non disponibile. Sblocca MediFlow prima di riprovare.';
  if (error.code === 'role_unavailable') return 'Gestione checkup o conferma PIN non disponibili. Verifica l’abilitazione e reinserisci il PIN.';
  if (error.code === 'conflict') return 'Il checkup o la proposta sono cambiati. Richiedi una nuova proposta.';
  if (error.code === 'expired') return 'La proposta è scaduta. Richiedine una nuova.';
  return 'Il servizio di gestione assistita non è disponibile. Verifica il collegamento prima di riprovare.';
}
function target(value: Proposal['targetStatus']): string {
  return value === 'completed' ? 'Completare il checkup' : 'Annullare il checkup';
}

/** Trusted UI for explicit enrollment, opaque selection, proposal review, and one-click PIN confirmation. */
export function IntelligentHostCheckupAction({ patientId, ambulatoryId, checkups }: Readonly<{
  patientId: string; ambulatoryId: string | null; checkups: readonly Checkup[];
}>) {
  const [client] = useState(() => createIntelligentHostCheckupBrowserAdapter());
  const pendingCheckups = useMemo(() => checkups.filter((item) => item.status === 'pending'), [checkups]);
  const firstPendingCheckupId = pendingCheckups[0]?.id ?? '';
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(firstPendingCheckupId);
  const [pin, setPin] = useState(''), [checkupRef, setCheckupRef] = useState('');
  const [proposalRef, setProposalRef] = useState(''), [proposal, setProposal] = useState<Proposal | null>(null);
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  const [committed, setCommitted] = useState(false);
  const [message, setMessage] = useState('Inserisci il PIN per abilitare la gestione assistita dei checkup, poi collega il checkup scelto.');
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const mounted = useRef(true), statusId = useId(), pinId = useId(), proposalId = useId();
  useEffect(() => {
    mounted.current = true; client.reset(); setSelectedId('');
    setPin(''); setCheckupRef(''); setProposalRef(''); setProposal(null); setSelectedResource(null);
    setCommitted(false);
    setMessage(ambulatoryId ? 'Abilita la gestione checkup con il PIN. Poi «Attiva e collega checkup» attiva il servizio e collega il checkup scelto.'
      : 'Gestione assistita non disponibile: alla scheda non è associato un ambulatorio.');
    return () => { mounted.current = false; client.reset(); };
  }, [ambulatoryId, client, patientId]);
  const pendingCheckupKey = pendingCheckups.map((item) => item.id).join('\0');
  useEffect(() => {
    setSelectedId((current) => checkupRef || pendingCheckups.some((item) => item.id === current)
      ? current : firstPendingCheckupId);
  }, [checkupRef, firstPendingCheckupId, pendingCheckupKey, pendingCheckups]);
  useEffect(() => {
    if (!open) {
      setPopoverPosition(null);
      return;
    }
    const updatePopoverPosition = () => {
      const actionButton = actionButtonRef.current;
      if (!actionButton) return;
      const rect = actionButton.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = window.innerHeight;
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const panelWidth = Math.min(POPOVER_WIDTH_REM * rootFontSize, viewportWidth - POPOVER_GUTTER * 2);
      const maxTop = Math.max(POPOVER_GUTTER, viewportHeight - POPOVER_MIN_HEIGHT - POPOVER_GUTTER);
      const maxLeft = Math.max(POPOVER_GUTTER, viewportWidth - panelWidth - POPOVER_GUTTER);
      setPopoverPosition({
        top: Math.max(POPOVER_GUTTER, Math.min(rect.bottom + 6, maxTop)),
        left: Math.min(Math.max(POPOVER_GUTTER, rect.left), maxLeft),
      });
    };
    updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open]);
  const run = async (operation: (candidatePin: string) => Promise<void>, needsPin = false) => {
    if (busy || (needsPin && pin.length < 4)) return;
    const candidatePin = pin; if (needsPin) setPin(''); setBusy(true);
    try { await operation(candidatePin); } catch (error) { if (mounted.current) setMessage(status(error)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const enroll = () => run(async (candidatePin) => {
    await client.enroll(candidatePin); setMessage('Gestione assistita dei checkup abilitata per questa sessione Web.');
  }, true);
  const revokeRole = () => run(async (candidatePin) => {
    await client.revokeRole(candidatePin); client.reset(); setCheckupRef(''); setProposalRef('');
    setProposal(null); setSelectedResource(null); setCommitted(false);
    setMessage('Gestione assistita dei checkup revocata definitivamente; operazione locale chiusa.');
  }, true);
  const select = () => run(async () => {
    if (!ambulatoryId) return;
    const value = await client.select(patientId, ambulatoryId, selectedId);
    setCheckupRef(value.checkupRef); setProposalRef('');
    setProposal(null); setSelectedResource({ checkupId: selectedId, title: value.resourceTitle,
      revision: value.resourceRevision }); setCommitted(false);
    setMessage('Servizio attivo e checkup collegato. Copia il codice nell’anteprima dell’assistente collegato, poi incolla qui il codice della proposta ricevuta.');
  });
  const revokeOperation = () => run(async () => {
    const state = await client.revokeOperation(patientId); setCheckupRef(''); setProposalRef('');
    setProposal(null); setSelectedResource(null); setCommitted(false);
    setMessage(state === 'revoked' ? 'Operazione sul checkup chiusa; il servizio di gestione assistita resta attivo.'
      : 'Nessuna operazione sul checkup era attiva; il servizio di gestione assistita resta attivo.');
  });
  const changeSelection = (nextId: string) => run(async () => {
    if (checkupRef || proposalRef || proposal) await client.revokeOperation(patientId);
    setSelectedId(nextId); setCheckupRef(''); setProposalRef(''); setProposal(null);
    setSelectedResource(null); setCommitted(false);
    setMessage('Selezione cambiata: la precedente operazione è stata chiusa. Collega il nuovo checkup.');
  });
  const read = () => run(async () => {
    const value = await client.read(patientId, proposalRef.trim()); setProposal(value); setCommitted(false);
    setMessage('Proposta riletta dal servizio. Verifica il checkup, l’azione e la versione prima di confermare con il PIN.');
  });
  const confirm = () => run(async (candidatePin) => {
    if (!proposal) return;
    const receipt = await client.confirm(patientId, proposal, candidatePin);
    const replay = committed; setCommitted(true); notifyDbChange('checkups');
    setMessage(replay ? `Conferma già eseguita: versione ${receipt.newRevision}, nessuna seconda scrittura.`
      : `${target(receipt.toStatus)}: eseguito alla versione ${receipt.newRevision}.`);
  }, true);
  const copy = async () => {
    if (!checkupRef || busy) return;
    try { await navigator.clipboard.writeText(checkupRef);
      if (mounted.current) setMessage('Codice del checkup copiato.'); }
    catch { if (mounted.current) setMessage('Copia non disponibile: seleziona il codice mostrato.'); }
  };
  const popoverStyle = popoverPosition ? {
    '--checkup-popover-top': `${popoverPosition.top}px`,
    '--checkup-popover-left': `${popoverPosition.left}px`,
  } as CSSProperties : undefined;

  return (
    <div className={workspaceStyles.headerActionsMenu} data-testid="intelligent-host-checkup-action">
      <button ref={actionButtonRef} type="button" className={actionClass} data-lume-action="quiet" aria-expanded={open}
        aria-controls={statusId} aria-label="Gestisci checkup" title="Gestisci checkup: rivedi una proposta di completamento o annullamento e conferma con il PIN"
        onClick={() => setOpen((value) => !value)}>
        <ShieldCheck size={14} aria-hidden="true" /><span className="hidden sm:inline">Gestisci checkup</span>
      </button>
      {open ? (
        <div id={statusId} style={popoverStyle} className={`mf-popover ${popoverStyles.popover} space-y-3 text-sm max-h-[calc(100dvh_-_var(--checkup-popover-top,0.5rem)_-_0.5rem)] overflow-y-auto overscroll-contain [overflow-wrap:anywhere] [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:text-left [&_button]:h-auto`}>
          <p className="font-semibold">Completa o annulla un checkup</p>
          <p>Rivedi la proposta dell’assistente prima di confermare: la conferma con il PIN modifica lo stato del checkup. Non è un controllo del computer.</p>
          <p role="status" aria-live="polite" aria-atomic="true">{message}</p>
          <label htmlFor={pinId} className="mf-field-label">Reinserisci il PIN per autorizzare</label>
          <input id={pinId} className="mf-input mf-input-sm w-full" type="password" inputMode="text"
            autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={actionClass} disabled={busy || pin.length < 4} onClick={enroll}>Abilita gestione checkup</button>
            <button type="button" className={actionClass} disabled={busy || pin.length < 4} onClick={revokeRole}>Revoca definitivamente la gestione</button>
          </div>
          <label className="mf-field-label" htmlFor={`${statusId}-checkup`}>Checkup da completare</label>
          <select id={`${statusId}-checkup`} className="mf-input mf-input-sm w-full" value={selectedId}
            disabled={busy || (pendingCheckups.length === 0 && !selectedResource)}
            onChange={(event) => { void changeSelection(event.target.value); }}>
            {selectedResource && !pendingCheckups.some((item) => item.id === selectedResource.checkupId)
              ? <option value={selectedResource.checkupId}>{selectedResource.title} · versione {selectedResource.revision} · operazione</option>
              : null}
            {pendingCheckups.map((item) => <option key={item.id} value={item.id}>{item.title} · versione {item.version ?? 1}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={actionClass}
              disabled={busy || !ambulatoryId || !selectedId || Boolean(checkupRef)} onClick={select}>Attiva e collega checkup</button>
            <button type="button" className={actionClass} disabled={busy || (!checkupRef && !proposalRef)}
              onClick={revokeOperation}>Chiudi operazione</button>
          </div>
          {checkupRef ? <div className="space-y-1"><p className="mf-field-label">Codice del checkup per l’assistente</p>
            {selectedResource ? <p data-testid="checkup-host-resource">{selectedResource.title} · versione {selectedResource.revision}</p> : null}
            <code className="block break-all" data-testid="checkup-host-ref">{checkupRef}</code>
            <button type="button" className={actionClass} onClick={copy}><Clipboard size={14} aria-hidden="true" /> Copia codice</button>
          </div> : null}
          <label htmlFor={proposalId} className="mf-field-label">Codice della proposta ricevuta dall’assistente</label>
          <input id={proposalId} className="mf-input mf-input-sm w-full font-mono" value={proposalRef}
            onChange={(event) => { setProposalRef(event.target.value); setProposal(null); }} />
          <button type="button" className={actionClass} disabled={busy || !proposalRef.trim()} onClick={read}>Rileggi proposta</button>
          {proposal ? <div className="space-y-2 border-t pt-3" data-testid="checkup-host-proposal">
            <p className="font-semibold">{target(proposal.targetStatus)}</p>
            <p>{proposal.resourceTitle}</p>
            <p>Stato atteso: da completare · versione {proposal.resourceRevision}</p>
            <p>Scadenza: {new Date(proposal.expiresAt).toLocaleTimeString('it-IT')}</p>
            <button type="button" className={actionClass} disabled={busy || pin.length < 4} onClick={confirm}>
              {committed ? 'Rileggi conferma con PIN' : 'Conferma modifica con PIN'}
            </button>
          </div> : null}
          <details className="border-t pt-3">
            <summary className="min-h-11 cursor-pointer content-center font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Dettagli per l’assistenza</summary>
            <p>Il servizio tecnico è Intelligent Host. Il codice del checkup è un riferimento opaco per l’anteprima MCP; il codice della proposta proviene dallo stesso percorso. La ricevuta conferma una modifica già eseguita: rileggerla non esegue una seconda scrittura. Chiudere l’operazione non revoca la gestione; la revoca definitiva è un’azione distinta.</p>
          </details>
        </div>
      ) : null}
    </div>
  );
}
