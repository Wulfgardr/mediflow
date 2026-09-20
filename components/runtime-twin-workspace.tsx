'use client';

/* @Codex WUL-676: one application frame; open record ids live only in the
   unlocked React session. The SecurityProvider unmounts this frame on lock. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Activity, BookOpen, CalendarDays, ChevronDown, ClipboardList, FolderOpen, LockKeyhole, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Users, X } from 'lucide-react';
import { db } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { useSecurity } from '@/components/security-provider';
import PrivacyBlur from '@/components/privacy-blur';
import { PrivacyModeToggle } from '@/components/privacy-mode-toggle';
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import { useConfirm } from '@/components/ui/confirm-dialog';
import styles from './runtime-twin-workspace.module.css';

const destinations = [
  { href: '/?area=incarico', label: 'Pazienti', icon: Users },
  { href: '/?area=turno', label: 'Agenda', icon: CalendarDays },
  { href: '/?area=diario', label: 'Diario', icon: BookOpen },
  { href: '/?area=repertori', label: 'Repertori', icon: FolderOpen },
  { href: '/analytics', label: 'Analisi', icon: Activity },
  { href: '/scales', label: 'Scale', icon: ClipboardList },
];

/* @Codex: the mounted cockpit publishes its displayed area, including a
   profile-derived default. This is presentation state, never a URL command. */
const WorkspaceAreaContext = createContext<((area: string | null) => void) | null>(null);
export function useRuntimeWorkspaceArea(area: string | null) {
  const publish = useContext(WorkspaceAreaContext);
  useEffect(() => {
    publish?.(area);
    return () => publish?.(null);
  }, [area, publish]);
}

export function RuntimeTwinWorkspace({ children }: { children: ReactNode }) {
  const { enabled, proposal, composition, pendingForms } = useRuntimeTwinDesign();
  const confirm = useConfirm();
  const { lock } = useSecurity();
  const pathname = usePathname();
  const patientId = pathname.match(/^\/patients\/([^/]+)\//)?.[1] ?? null;
  const [opened, setOpened] = useState<string[]>([]);
  const [area, setArea] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  /* @Codex: one confirmation boundary for the new route shortcuts. Replay the
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
      void confirm({ title: 'Lasciare la compilazione?', message: 'È aperta una compilazione. Le modifiche non salvate andranno perse.', confirmLabel: 'Esci senza salvare', cancelLabel: 'Continua a scrivere' }).then(result => {
        asking = false;
        if (live && result.confirmed && anchor.isConnected) { approved = anchor; anchor.click(); approved = null; }
      });
    };
    document.addEventListener('click', navigate, true);
    window.addEventListener('beforeunload', leave);
    return () => { live = false; document.removeEventListener('click', navigate, true); window.removeEventListener('beforeunload', leave); };
  }, [enabled, pendingForms, confirm]);
  useEffect(() => {
    if (proposal && patientId) setOpened(current => current.includes(patientId) ? current : [...current, patientId]);
  }, [patientId, proposal]);
  const key = opened.join('|');
  const records = useLiveQuery(async () => {
    if (!proposal) return [];
    return (await Promise.all(key.split('|').filter(Boolean).map(id => db.patients.get(id)))).filter(p => !!p);
  }, [key, proposal], [], ['patients']) ?? [];

  return (
    <WorkspaceAreaContext.Provider value={setArea}>
    <div className={styles.workspace} data-twin-workspace data-active={proposal} data-composition={composition} data-rail-open={railOpen}>
      <aside className={styles.rail} aria-label="MediFlow">
        <Link href="/?area=incarico" className={styles.brand}><span className={styles.brandMark}><Plus size={17} aria-hidden /></span><strong>MediFlow</strong></Link>
        <nav aria-label="Navigazione principale" className={styles.navigation}>
          {destinations.map(({ href, label, icon: Icon }) => <Link key={href} href={href} title={label} aria-label={label} aria-current={(href.includes('?area=') ? (pathname === '/' && href.endsWith(`=${area}`)) || (href.endsWith('=incarico') && pathname.startsWith('/patients/')) : pathname.startsWith(href)) ? 'page' : undefined}><Icon size={17} aria-hidden /><span>{label}</span></Link>)}
        </nav>
        <div className={styles.railBottom}>
          <Link href="/settings" aria-label="Impostazioni" title="Impostazioni" aria-current={pathname.startsWith('/settings') || (pathname === '/' && area === 'governance') ? 'page' : undefined}><Settings2 size={17} aria-hidden /><span>Impostazioni</span></Link>
          <button type="button" onClick={lock} aria-label="Blocca" title="Blocca"><LockKeyhole size={17} aria-hidden /><span>Blocca</span></button>
        </div>
      </aside>
      <div className={styles.workarea}>
        <header className={styles.workspaceBar}>
          <button type="button" className={styles.iconButton} aria-label={railOpen ? 'Riduci navigazione' : 'Espandi navigazione'} aria-expanded={railOpen} onClick={() => setRailOpen(value => !value)}>
            {railOpen ? <PanelLeftClose size={18} aria-hidden /> : <PanelLeftOpen size={18} aria-hidden />}
          </button>
          <nav className={styles.openRecords} aria-label="Cartelle aperte">
            <Link className={styles.directoryTab} href="/?area=incarico" aria-current={pathname === '/' ? 'page' : undefined}>Pazienti</Link>
            {records.map((patient, index) => <span className={styles.recordTab} key={patient.id} data-active={patient.id === patientId}>
              <Link href={`/patients/${patient.id}/modules`} aria-current={patient.id === patientId ? 'page' : undefined}><PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur></Link>
              {patient.id === patientId ? <Link href="/?area=incarico" aria-label={`Chiudi cartella ${index + 1}`} onClick={() => setOpened(value => value.filter(id => id !== patient.id))}><X size={13} aria-hidden /></Link>
                : <button type="button" aria-label={`Chiudi cartella ${index + 1}`} onClick={() => setOpened(value => value.filter(id => id !== patient.id))}><X size={13} aria-hidden /></button>}
            </span>)}
          </nav>
          <PrivacyModeToggle className={styles.privacy} />
        </header>
        <div className={styles.page}>{children}</div>
      </div>
    </div>
    </WorkspaceAreaContext.Provider>
  );
}

/* @Codex: this menu reorganizes the existing canonical anchors, never drops a
   capability or treats an unloaded count as an empty record. */
export function RuntimeTwinPatientNavigation({ items, active }: { items: readonly { href: string; label: string; meta?: string }[]; active: string }) {
  const primary = items.filter(item => ['#quadro', '#diario'].includes(item.href)
    || (['#terapie', '#documenti', '#parametri'].includes(item.href) && item.meta !== undefined && Number(item.meta) > 0));
  const secondary = items.filter(item => !primary.includes(item));
  return <nav className={styles.patientNavigation} aria-label="Sezioni della vista">
    {primary.map(item => <a key={item.href} href={item.href} aria-current={active === item.href.slice(1) ? 'location' : undefined}>{item.href === '#quadro' ? 'Riepilogo' : item.label}{item.meta && Number(item.meta) > 0 ? <span>{item.meta}</span> : null}</a>)}
    <details className={styles.moreSections} onClick={event => {
      if ((event.target as HTMLElement).closest('a')) event.currentTarget.open = false;
    }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
      <summary aria-current={secondary.some(item => item.href === `#${active}`) ? 'location' : undefined}>Altre sezioni <ChevronDown size={14} aria-hidden /></summary>
      <div className={styles.sectionMenu}>
        {secondary.map(item => <a key={item.href} href={item.href} aria-current={active === item.href.slice(1) ? 'location' : undefined}><span>{item.label}</span><small>{item.meta === '0' ? 'Nessun dato' : item.meta}</small></a>)}
      </div>
    </details>
  </nav>;
}
