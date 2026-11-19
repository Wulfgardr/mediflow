'use client';

/* WUL-676: one application frame; open record ids live only in the
   unlocked React session. The SecurityProvider unmounts this frame on lock. */
import { useEntryDraftMarker } from '@/hooks/use-entry-local-draft';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Activity, BookOpen, CalendarDays, CircleDashed, ChevronDown, CircleHelp, ClipboardList, FolderOpen, Inbox, LockKeyhole, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Settings2, Search, Sun, Users, X } from 'lucide-react';
import { db } from '@/lib/db';
import { currentWorkspaceDestination } from '@/lib/workspace-destination';
import { useLiveQuery } from '@/lib/live-query';
import { useSecurity } from '@/components/security-provider';
import { useTheme } from '@/components/theme-provider';
import PrivacyBlur from '@/components/privacy-blur';
import { PrivacyModeToggle } from '@/components/privacy-mode-toggle';
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import styles from './runtime-twin-workspace.module.css';
import { PatientSheetMenu } from './patient-sheet-menu';

const destinations = [
  { href: '/?area=incarico', label: 'Pazienti', icon: Users },
  { href: '/?area=turno', label: 'Agenda', icon: CalendarDays },
  { href: '/?area=diario', label: 'Diario', icon: BookOpen },
  { href: '/in-arrivo', label: 'In arrivo', icon: Inbox },
  { href: '/?area=repertori', label: 'Repertori', icon: FolderOpen },
  { href: '/analytics', label: 'Analisi', icon: Activity },
  { href: '/scales', label: 'Scale', icon: ClipboardList },
];

/* the mounted cockpit publishes its displayed area, including a
   profile-derived default. This is presentation state, never a URL command. */
type DirectoryReturn = { patientId: string; query: string; scope: 'ambulatorio' | 'network' | 'tutti'; list: 'attivi' | 'archivio'; restore: boolean };
const DirectoryReturnContext = createContext<{ current: DirectoryReturn | null } | null>(null);
export const useDirectoryReturn = () => useContext(DirectoryReturnContext);

function useWorkspaceRegistration<T>(publish: ((value: T | null) => void) | null, value: T | null) {
  useEffect(() => {
    publish?.(value);
    return () => publish?.(null);
  }, [publish, value]);
}

const WorkspaceAreaContext = createContext<((area: string | null) => void) | null>(null);
export function useRuntimeWorkspaceArea(area: string | null) {
  useWorkspaceRegistration(useContext(WorkspaceAreaContext), area);
}

type CommandHandler = (() => void) | null;
const WorkspaceCommandContext = createContext<((handler: CommandHandler) => void) | null>(null);
export function useRuntimeWorkspaceCommand(handler: CommandHandler) {
  const publish = useContext(WorkspaceCommandContext);
  useWorkspaceRegistration(publish, handler);
  return publish !== null && handler !== null;
}

type RecordCrumb = { id: string; label: string; proposals?: number };
const RecordCrumbContext = createContext<((value: RecordCrumb | null) => void) | null>(null);
export function useRecordCrumb(id: string | undefined, label: string, proposals?: number) {
  const crumb = useMemo(() => id ? { id, label, proposals } : null, [id, label, proposals]);
  useWorkspaceRegistration(useContext(RecordCrumbContext), crumb);
}

export function RuntimeTwinWorkspace({ children }: { children: ReactNode }) {
  const { enabled, proposal, composition, pendingForms, discardPendingForms } = useRuntimeTwinDesign();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { lock, user } = useSecurity();
  const { setTheme } = useTheme();
  const desktop = useSyncExternalStore(watchRecordWidth, desktopRecord, serverRecordWidth);
  const pathname = usePathname();
  const patientId = pathname.match(/^\/patients\/([^/]+)\//)?.[1] ?? null;
  const wideRecord = !!patientId && proposal && desktop;
  const [opened, setOpened] = useState<string[]>([]);
  const [area, setArea] = useState<string | null>(null);
  const [openCommands, setOpenCommands] = useState<CommandHandler>(null);
  const registerCommand = useCallback((handler: CommandHandler) => setOpenCommands(() => handler), []);
  const currentDestinationHref = currentWorkspaceDestination(pathname, area);
  const activeDestination = destinations.find(({ href }) => href === currentDestinationHref)
    ?? (currentDestinationHref === '/settings'
      ? { href: '/settings', label: 'Impostazioni' }
      : destinations[0]);
  const recordSearch = useRef<HTMLAnchorElement>(null);
  const [recordLabel, setRecordLabel] = useState<RecordCrumb | null>(null);
  const currentRecord = recordLabel?.id === patientId ? recordLabel : null;
  const operator = user?.displayName?.trim() || user?.username || '';
  useEffect(() => {
    if (!proposal || !patientId) return;
    const search = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input, textarea, select, [role="dialog"]'))) return;
      event.preventDefault();
      recordSearch.current?.click();
    };
    window.addEventListener('keydown', search);
    return () => window.removeEventListener('keydown', search);
  }, [patientId, proposal]);
  const directoryReturn = useRef<DirectoryReturn | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const currentInMore = currentDestinationHref !== null && !destinations.slice(0, 3).some(({ href }) => href === currentDestinationHref);
  /* one confirmation boundary for the new route shortcuts. Replay the
     actual link once, so its close-tab action and Next navigation stay atomic.
     Browser history and security lock keep their existing owners. */
  useEffect(() => {
    if (!enabled || !pendingForms) return;
    let approved: HTMLAnchorElement | null = null;
    let asking = false;
    let live = true;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (approved === anchor) { approved = null; return; }
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin !== current.origin || (destination.pathname === current.pathname && destination.search === current.search)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (asking) return;
      asking = true;
      void confirm({ title: 'Lasciare la compilazione?', message: 'È aperta una compilazione. Le modifiche non salvate andranno perse.', confirmLabel: 'Esci senza salvare', cancelLabel: 'Continua la compilazione', tone: 'danger' }).then(async result => {
        try {
          if (live && result.confirmed && anchor.isConnected) {
            await discardPendingForms();
            if (live && anchor.isConnected) { approved = anchor; anchor.click(); approved = null; }
          }
        } catch {
          showToast({ tone: 'error', title: 'Bozza non eliminata. La compilazione resta aperta.' });
        } finally { asking = false; }
      });
    };
    document.addEventListener('click', navigate, true);
    window.addEventListener('beforeunload', leave);
    return () => { live = false; document.removeEventListener('click', navigate, true); window.removeEventListener('beforeunload', leave); };
  }, [enabled, pendingForms, confirm, discardPendingForms, showToast]);
  useEffect(() => {
    if (proposal && patientId) setOpened(current => current.includes(patientId) ? current : [...current, patientId]);
  }, [patientId, proposal]);
  const key = opened.join('|');
  const records = useLiveQuery(async () => {
    if (!proposal) return [];
    return (await Promise.all(key.split('|').filter(Boolean).map(id => db.patients.get(id)))).filter(p => !!p);
  }, [key, proposal], [], ['patients']) ?? [];

  const railToggle = (
    <button type="button" className={styles.iconButton} aria-label={railOpen ? 'Riduci navigazione' : 'Espandi navigazione'} aria-expanded={railOpen} onClick={() => setRailOpen(value => !value)}>
            {railOpen ? <PanelLeftClose size={18} aria-hidden /> : <PanelLeftOpen size={18} aria-hidden />}
          </button>
  );
  const workspaceBar = (
    <header className={styles.workspaceBar}>
          {!wideRecord ? railToggle : null}
          <nav className={styles.openRecords} aria-label="Cartelle aperte">
            <Link className={styles.directoryTab} href={activeDestination.href} aria-label={activeDestination.label} aria-current={!patientId && currentDestinationHref !== null ? 'page' : undefined}>{activeDestination.label}</Link>
            {records.map((patient, index) => <span className={styles.recordTab} key={patient.id} data-active={patient.id === patientId}>
              <Link href={`/patients/${patient.id}/modules`} aria-current={patient.id === patientId ? 'page' : undefined}><span className={currentRecord && patient.id === patientId ? styles.recordName : undefined}><PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur></span>{currentRecord && patient.id === patientId ? <span className={styles.recordWhen} aria-hidden="true">{currentRecord.label}</span> : null}<DraftMarker patientId={patient.id} /></Link>
              {patient.id === patientId ? <Link href="/?area=incarico" aria-label={`Chiudi cartella ${index + 1}`} onClick={() => setOpened(value => value.filter(id => id !== patient.id))}><X size={13} aria-hidden /></Link>
                : <button type="button" aria-label={`Chiudi cartella ${index + 1}`} onClick={() => setOpened(value => value.filter(id => id !== patient.id))}><X size={13} aria-hidden /></button>}
            </span>)}
          </nav>
          {!wideRecord ? <PrivacyModeToggle className={styles.privacy} /> : null}
        </header>
  );

  return (
    <RecordCrumbContext.Provider value={setRecordLabel}>
    <WorkspaceAreaContext.Provider value={setArea}>
    <WorkspaceCommandContext.Provider value={proposal ? registerCommand : null}>
    <DirectoryReturnContext.Provider value={directoryReturn}>
    <div className={styles.workspace} data-twin-workspace data-active={proposal} data-patient-record={proposal && !!patientId} data-composition={composition} data-rail-open={railOpen}>
      <aside className={styles.rail} aria-label="MediFlow">
        <Link href="/?area=incarico" className={styles.brand} aria-label="MediFlow"><span className={styles.recordBrand} aria-hidden="true"><i /><i /><i /></span><strong>MediFlow<span className={styles.brandPoint} aria-hidden="true">.</span></strong></Link>
        {patientId && proposal ? <Link ref={recordSearch} href="/?area=incarico#ricerca-pazienti" className={styles.recordSearch} aria-label="Cerca pazienti">
          <Search size={15} aria-hidden /><span>Cerca</span><kbd>⌘K</kbd>
        </Link> : null}
        <nav aria-label="Navigazione principale" className={styles.navigation}>
          {destinations.map(({ href, label, icon: Icon }, index) => <Fragment key={href}>
            {patientId && proposal && (index === 0 || index === 4) ? <span className={styles.railGroup}>{index === 0 ? 'Lavoro' : 'Archivio'}</span> : null}
            <Link key={href} href={href} className={index > 2 ? styles.secondaryDestination : undefined} title={label} aria-label={label} aria-current={currentDestinationHref === href ? 'page' : undefined}><Icon size={17} aria-hidden /><span>{label}</span></Link></Fragment>)}
          {patientId && proposal ? <div className={styles.proposalNav}>
            <span className={styles.railGroup}>Proposte del modello</span>
            <Link href={`/patients/${patientId}/modules#patient-insight`} title="Proposte del Quadro paziente">
              <CircleDashed size={15} aria-hidden /><span>Quadro paziente</span>
              {currentRecord?.proposals ? <small>{currentRecord.proposals}</small> : null}
            </Link>
          </div> : null}
          <details className={styles.mobileMore} onToggle={event => setMobileMoreOpen(event.currentTarget.open)} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
            <summary aria-current={currentInMore && !mobileMoreOpen ? 'page' : undefined} aria-label={currentDestinationHref === '/settings' ? 'Altro · Impostazioni' : undefined}><MoreHorizontal size={20} aria-hidden /><span>Altro</span></summary>
            <div className={styles.mobileMenu} onClick={event => { if (event.target instanceof Element && event.target.closest('a, button')) event.currentTarget.closest('details')?.removeAttribute('open'); }}>
              {destinations.slice(3).map(({ href, label, icon: Icon }) => <Link href={href} key={href} aria-current={currentDestinationHref === href ? 'page' : undefined}><Icon size={18} aria-hidden /><span>{label}</span></Link>)}
              {openCommands && <button type="button" onClick={event => {
                event.currentTarget.closest('details')?.querySelector('summary')?.focus();
                openCommands();
              }}><CircleHelp size={18} aria-hidden /><span>Comandi e aiuto</span></button>}
              <Link href="/settings" aria-current={currentDestinationHref === '/settings' ? 'page' : undefined}><Settings2 size={18} aria-hidden /><span>Impostazioni</span></Link>
              <button type="button" onClick={lock}><LockKeyhole size={18} aria-hidden /><span>Blocca</span></button>
            </div>
          </details>
        </nav>
        <div className={styles.railBottom}>
          <div className={styles.railTools}>
            <Link href="/settings" aria-label="Impostazioni" title="Impostazioni" aria-current={currentDestinationHref === '/settings' ? 'page' : undefined}><Settings2 size={17} aria-hidden /><span>Impostazioni</span></Link>
            {wideRecord ? <>{railToggle}<PrivacyModeToggle className={styles.privacy} />
              <button type="button" className={styles.iconButton} onClick={lock} aria-label="Blocca" title="Blocca"><LockKeyhole size={15} aria-hidden /></button>
            </> : null}
          </div>
          <div className={styles.account} data-identified={wideRecord && !!operator}>
            {patientId && proposal && operator ? <><span className={styles.initials} aria-hidden="true">{operator.split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join('').toLocaleUpperCase('it-IT')}</span>
              <div className={styles.operator}><span>{operator}</span>{user?.ambulatoryName ? <small>{user.ambulatoryName}</small> : null}</div></> : null}
            {wideRecord ? <button type="button" className={styles.themeButton} aria-label="Cambia tema" title="Cambia tema" onClick={() => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')}><Moon className={styles.toDark} size={15} aria-hidden /><Sun className={styles.toLight} size={15} aria-hidden /></button>
              : <button type="button" onClick={lock} aria-label="Blocca" title="Blocca"><LockKeyhole size={17} aria-hidden /><span>Blocca</span></button>}
          </div>
        </div>
      </aside>
      <div className={styles.workarea}>
        {!patientId ? workspaceBar : null}
        <div className={styles.page}>{patientId ? workspaceBar : null}{children}</div>
      </div>
    </div>
    </DirectoryReturnContext.Provider>
    </WorkspaceCommandContext.Provider>
    </WorkspaceAreaContext.Provider>
    </RecordCrumbContext.Provider>
  );
}

function DraftMarker({ patientId }: { patientId: string }) {
  return useEntryDraftMarker(patientId) ? <span className={styles.draftMarker} aria-label="Bozza conservata" title="Bozza conservata">●</span> : null;
}

const widePatientDestinations = ['#quadro', '#diario', '#terapie', '#documenti', '#parametri', '#follow-up'];
const compactPatientDestinations = ['#quadro', '#terapie', '#parametri', '#documenti'];
const desktopRecordWidth = '(min-width: 1001px)';
const desktopRecord = () => window.matchMedia(desktopRecordWidth).matches;
function watchRecordWidth(notify: () => void) {
  const media = window.matchMedia(desktopRecordWidth);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}
const serverRecordWidth = () => false;
const patientTabLabels: Record<string, string> = { '#quadro': 'Riepilogo', '#parametri': 'Parametri', '#follow-up': 'Controlli' };

export function RuntimeTwinPatientNavigation({ items, active, lastVisit }: {
  items: readonly { href: string; label: string; meta?: string }[];
  active: string;
  lastVisit?: { date: Date; author?: string };
}) {
  const wide = useSyncExternalStore(watchRecordWidth, desktopRecord, serverRecordWidth);
  const patientPrimaryDestinations = wide ? widePatientDestinations : compactPatientDestinations;
  const primary = patientPrimaryDestinations.flatMap(href => items.filter(item => item.href === href));
  const secondary = items.filter(item => !patientPrimaryDestinations.includes(item.href));
  return <nav className={styles.patientNavigation} aria-label="Sezioni della vista">
    <div className={styles.segment}>
      {primary.map(item => {
        const count = item.meta?.match(/^\d+/)?.[0];
        return <a key={item.href} href={item.href} title={item.meta} aria-current={active === item.href.slice(1) ? 'location' : undefined}>{patientTabLabels[item.href] ?? item.label}{count && count !== '0' ? <span>{count}</span> : null}</a>;
      })}
      <PatientSheetMenu label="Altre sezioni della cartella" className={styles.moreSections}
        trigger={props => <button {...props} aria-label="Altro" title="Altre sezioni" aria-current={!props['aria-expanded'] && secondary.some(item => item.href === `#${active}`) ? 'location' : undefined}><span>Altro</span><ChevronDown size={14} aria-hidden /></button>}>
        {secondary.map(item => <a key={item.href} href={item.href} role="menuitem" tabIndex={-1} className="mf-popover-row"
          aria-current={active === item.href.slice(1) ? 'location' : undefined}><span>{item.label}</span>{item.meta !== undefined ? <small>{item.meta}</small> : null}</a>)}
      </PatientSheetMenu>
    </div>
    {lastVisit ? <small className={styles.lastVisit}>Ultima visita <time dateTime={lastVisit.date.toISOString()}>{lastVisit.date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}</time>{lastVisit.author ? <> · <PrivacyBlur>{lastVisit.author}</PrivacyBlur></> : null}</small> : null}
  </nav>;
}
