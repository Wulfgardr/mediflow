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
const POPOVER_MAX_WIDTH = 22 * 16;
const POPOVER_MIN_HEIGHT = 160;
function status(error: unknown): string {
  if (!(error instanceof IntelligentHostCheckupBrowserAdapterError)) return 'Operazione non verificabile.';
  if (error.code === 'session_unavailable') return 'Sessione non disponibile.';
  if (error.code === 'role_unavailable') return 'Ruolo o conferma PIN non disponibili.';
  if (error.code === 'conflict') return 'La proposta non è più corrente. Richiedine una nuova.';
  if (error.code === 'expired') return 'La proposta è scaduta. Richiedine una nuova.';
  return 'Intelligent Host non disponibile.';
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
  const [message, setMessage] = useState('Attiva prima l’Host intelligente, poi abilita il ruolo checkup.');
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const mounted = useRef(true), statusId = useId(), pinId = useId(), proposalId = useId();
  useEffect(() => {
    mounted.current = true; client.reset(); setSelectedId('');
    setPin(''); setCheckupRef(''); setProposalRef(''); setProposal(null); setSelectedResource(null);
    setCommitted(false);
    setMessage(ambulatoryId ? 'Abilita il ruolo checkup, poi collega il checkup all’Host intelligente.'
      : 'Host intelligente non disponibile: ambulatorio non associato alla scheda.');
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
      const panelWidth = Math.min(POPOVER_MAX_WIDTH, viewportWidth - POPOVER_GUTTER * 2);
      const maxTop = Math.max(POPOVER_GUTTER, viewportHeight - POPOVER_MIN_HEIGHT - POPOVER_GUTTER);
      const maxLeft = Math.max(POPOVER_GUTTER, viewportWidth - panelWidth - POPOVER_GUTTER);
      setPopoverPosition({
        top: Math.min(rect.bottom + 6, maxTop),
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
    await client.enroll(candidatePin); setMessage('Ruolo checkup attivo per questa sessione Web.');
  }, true);
  const revokeRole = () => run(async (candidatePin) => {
    await client.revokeRole(candidatePin); client.reset(); setCheckupRef(''); setProposalRef('');
    setProposal(null); setSelectedResource(null); setCommitted(false);
    setMessage('Ruolo checkup revocato definitivamente e operazione locale chiusa.');
  }, true);
  const select = () => run(async () => {
    if (!ambulatoryId) return;
    const value = await client.select(patientId, ambulatoryId, selectedId);
    setCheckupRef(value.checkupRef); setProposalRef('');
    setProposal(null); setSelectedResource({ checkupId: selectedId, title: value.resourceTitle,
      revision: value.resourceRevision }); setCommitted(false);
    setMessage('Host attivo e checkup collegato. Copia il riferimento opaco nell’azione MCP di preview.');
  });
  const revokeOperation = () => run(async () => {
    const state = await client.revokeOperation(patientId); setCheckupRef(''); setProposalRef('');
    setProposal(null); setSelectedResource(null); setCommitted(false);
    setMessage(state === 'revoked' ? 'Operazione checkup chiusa; l’Host resta attivo.'
      : 'Nessuna operazione checkup era attiva; l’Host resta attivo.');
  });
  const changeSelection = (nextId: string) => run(async () => {
    if (checkupRef || proposalRef || proposal) await client.revokeOperation(patientId);
    setSelectedId(nextId); setCheckupRef(''); setProposalRef(''); setProposal(null);
    setSelectedResource(null); setCommitted(false);
    setMessage('Selezione cambiata: la precedente operazione è stata chiusa. Collega il nuovo checkup.');
  });
  const read = () => run(async () => {
    const value = await client.read(patientId, proposalRef.trim()); setProposal(value); setCommitted(false);
    setMessage('Proposta riletta dal processo Web. Verifica comando e revisione prima di confermare.');
  });
  const confirm = () => run(async (candidatePin) => {
    if (!proposal) return;
    const receipt = await client.confirm(patientId, proposal, candidatePin);
    const replay = committed; setCommitted(true); notifyDbChange('checkups');
    setMessage(replay ? `Receipt riletto: revisione ${receipt.newRevision}, nessuna seconda scrittura.`
      : `${target(receipt.toStatus)}: eseguito alla revisione ${receipt.newRevision}.`);
  }, true);
  const copy = async () => {
    if (!checkupRef || busy) return;
    try { await navigator.clipboard.writeText(checkupRef);
      if (mounted.current) setMessage('Riferimento opaco copiato.'); }
    catch { if (mounted.current) setMessage('Copia non disponibile: seleziona il riferimento mostrato.'); }
  };
  const popoverStyle = popoverPosition ? {
    '--checkup-popover-top': `${popoverPosition.top}px`,
    '--checkup-popover-left': `${popoverPosition.left}px`,
  } as CSSProperties : undefined;

  return (
    <div className={workspaceStyles.headerActionsMenu} data-testid="intelligent-host-checkup-action">
      <button ref={actionButtonRef} type="button" className={actionClass} data-lume-action="quiet" aria-expanded={open}
        aria-controls={statusId} aria-label="Checkup host" title="Checkup host"
        onClick={() => setOpen((value) => !value)}>
        <ShieldCheck size={14} aria-hidden="true" /><span className="hidden sm:inline">Checkup host</span>
      </button>
      {open ? (
        <div id={statusId} style={popoverStyle} className={`mf-popover ${popoverStyles.popover} space-y-3 text-xs`}>
          <p className="font-semibold">Transizione checkup controllata</p>
          <p role="status" aria-live="polite" aria-atomic="true">{message}</p>
          <label htmlFor={pinId} className="mf-field-label">PIN fresco</label>
          <input id={pinId} className="mf-input mf-input-sm w-full" type="password" inputMode="numeric"
            autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={actionClass} disabled={busy || pin.length < 4} onClick={enroll}>Abilita ruolo</button>
            <button type="button" className={actionClass} disabled={busy || pin.length < 4} onClick={revokeRole}>Revoca ruolo definitivamente</button>
          </div>
          <label className="mf-field-label" htmlFor={`${statusId}-checkup`}>Checkup pending</label>
          <select id={`${statusId}-checkup`} className="mf-input mf-input-sm w-full" value={selectedId}
            disabled={busy || (pendingCheckups.length === 0 && !selectedResource)}
            onChange={(event) => { void changeSelection(event.target.value); }}>
            {selectedResource && !pendingCheckups.some((item) => item.id === selectedResource.checkupId)
              ? <option value={selectedResource.checkupId}>{selectedResource.title} · rev. {selectedResource.revision} · operazione</option>
              : null}
            {pendingCheckups.map((item) => <option key={item.id} value={item.id}>{item.title} · rev. {item.version ?? 1}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={actionClass}
              disabled={busy || !ambulatoryId || !selectedId || Boolean(checkupRef)} onClick={select}>Collega checkup</button>
            <button type="button" className={actionClass} disabled={busy || (!checkupRef && !proposalRef)}
              onClick={revokeOperation}>Chiudi operazione</button>
          </div>
          {checkupRef ? <div className="space-y-1"><p className="mf-field-label">Riferimento opaco per MCP</p>
            {selectedResource ? <p data-testid="checkup-host-resource">{selectedResource.title} · revisione {selectedResource.revision}</p> : null}
            <code className="block break-all" data-testid="checkup-host-ref">{checkupRef}</code>
            <button type="button" className={actionClass} onClick={copy}><Clipboard size={14} aria-hidden="true" /> Copia riferimento</button>
          </div> : null}
          <label htmlFor={proposalId} className="mf-field-label">Riferimento proposta MCP</label>
          <input id={proposalId} className="mf-input mf-input-sm w-full font-mono" value={proposalRef}
            onChange={(event) => { setProposalRef(event.target.value); setProposal(null); }} />
          <button type="button" className={actionClass} disabled={busy || !proposalRef.trim()} onClick={read}>Rileggi proposta</button>
          {proposal ? <div className="space-y-2 rounded-lg border p-3" data-testid="checkup-host-proposal">
            <p className="font-semibold">{target(proposal.targetStatus)}</p>
            <p>{proposal.resourceTitle}</p>
            <p>Stato atteso: pending · revisione {proposal.resourceRevision}</p>
            <p>Scadenza: {new Date(proposal.expiresAt).toLocaleTimeString('it-IT')}</p>
            <button type="button" className={actionClass} disabled={busy || pin.length < 4} onClick={confirm}>
              {committed ? 'Rileggi receipt con PIN' : 'Conferma una volta con PIN'}
            </button>
          </div> : null}
        </div>
      ) : null}
    </div>
  );
}
