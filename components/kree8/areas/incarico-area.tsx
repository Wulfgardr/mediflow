import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  Ellipsis,
  FileSearch,
  FileText,
  Plus,
  Search,
  UserSquare2,
  Workflow,
} from 'lucide-react';

import {
  DiagnosisPill,
  classNames,
  normalizeClinicalSearch,
  patientMatchesSearch,
} from '../cockpit-shared';
import type {
  AreaId,
  InboxScope,
  Kree8PatientStatus,
} from '../cockpit-shared';
import type { InboxList, Kree8Patient } from '@/lib/patient-workspace';
import { parseDiagnosisLabels } from '@/lib/patient-workspace';
import { nextVirtualRowIndex, type VirtualListNavigationKey } from '@/lib/kree8-keyboard-navigation';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import patientStyles from '../kree8-clinical-cockpit-patient-inbox.module.css';
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';


/* ───────────────────────── Pazienti in carico ───────────────────────── */

/* @Codex */

function IncaricoArea({
  patients,
  patientStatus,
  selectedPatientId,
  searchFocusSignal,
  onSelectPatient,
  onAlignPatient,
  onOpenArea,
  onRetryPatients,
  isReview,
}: {
  patients: Kree8Patient[];
  patientStatus: Kree8PatientStatus;
  selectedPatientId?: string;
  searchFocusSignal: number;
  onSelectPatient: (patientId: string) => void;
  onAlignPatient: (patientId: string) => void;
  onOpenArea: (area: AreaId) => void;
  onRetryPatients?: () => void;
  isReview: boolean;
}) {
  const router = useRouter();
  const { proposal } = useRuntimeTwinDesign();
  const [scope, setScope] = useState<InboxScope>('ambulatorio');
  const [list, setList] = useState<InboxList>('attivi');
  const [query, setQuery] = useState('');
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [actionsMenuPosition, setActionsMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = useMemo(() => normalizeClinicalSearch(query), [query]);

  useEffect(() => {
    if (searchFocusSignal <= 0) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchFocusSignal]);


  const scopedPatients = useMemo(
    () =>
      patients.filter((p) => {
        if (list === 'attivi' && p.list !== 'attivi') return false;
        if (list === 'archivio' && p.list !== 'archivio') return false;
        if (scope === 'tutti') return true;
        if (scope === 'ambulatorio') return p.scope === 'ambulatorio';
        return p.scope === 'network';
      }),
    [patients, scope, list],
  );
  const visible = useMemo(
    () => scopedPatients.filter((patient) => patientMatchesSearch(patient, normalizedQuery)),
    [normalizedQuery, scopedPatients],
  );

  const selected = visible.find((p) => p.id === selectedPatientId) ?? visible[0] ?? null;

  /* @Codex: a filtered directory can display its first visible record while
     the cockpit still retains an archived/nonmatching patient. Keep actions
     and the visible record aligned in the proposal. This changes view state. */
  useEffect(() => {
    if (proposal && selected && selected.id !== selectedPatientId) onAlignPatient(selected.id);
  }, [proposal, selected, selectedPatientId, onAlignPatient]);

  /* @Codex WUL-560 L6A: the disclosure owns focus and closes when its patient
     context changes. The four existing actions keep their original handlers. */
  useEffect(() => {
    setIsActionsOpen(false);
  }, [selected?.id]);

  useLayoutEffect(() => {
    if (!isActionsOpen) return;
    const positionMenu = () => {
      const trigger = actionsTriggerRef.current?.getBoundingClientRect();
      const menu = actionsMenuRef.current;
      if (!trigger || !menu) return;
      const margin = 8;
      const gap = 8;
      const below = trigger.bottom + gap;
      const above = trigger.top - gap - menu.offsetHeight;
      const top = below + menu.offsetHeight <= innerHeight - margin
        ? below
        : above >= margin && above + menu.offsetHeight <= innerHeight - margin ? above : Math.max(margin, innerHeight - margin - menu.offsetHeight);
      const left = Math.min(Math.max(margin, trigger.right - menu.offsetWidth), innerWidth - margin - menu.offsetWidth);
      setActionsMenuPosition({ left, top });
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [isActionsOpen]);

  useEffect(() => {
    if (!isActionsOpen) return;
    const firstItem = actionsMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    window.requestAnimationFrame(() => firstItem?.focus());

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target) && !actionsMenuRef.current?.contains(event.target)) {
        setIsActionsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsActionsOpen(false);
      window.requestAnimationFrame(() => actionsTriggerRef.current?.focus());
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isActionsOpen]);

  const handleActionMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const lastIndex = items.length - 1;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const overflowActions: Array<{ href?: string; icon: ReactNode; label: string; run?: () => void }> = selected ? [
    { label: 'Quadro', icon: <FileSearch size={14} aria-hidden="true" />, run: () => onOpenArea('scheda') },
    { label: 'Nuova voce', icon: <Plus size={14} aria-hidden="true" />, href: `${selected.href}/entries/new` },
    { label: 'Documenti', icon: <FileText size={14} aria-hidden="true" />, href: `${selected.modulesHref}#documenti` },
    { label: 'Prepara SISS', icon: <Workflow size={14} aria-hidden="true" />, run: () => onOpenArea('handoff') },
  ] : [];

  const patientListParentRef = useRef<HTMLDivElement>(null);
  const rowFocusRequest = useRef(0); // @Codex
  const rowFocusFrame = useRef<number | null>(null); // @Codex
  useEffect(() => () => {
    rowFocusRequest.current += 1;
    if (rowFocusFrame.current !== null) window.cancelAnimationFrame(rowFocusFrame.current);
  }, []);

  const patientRowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => patientListParentRef.current,
    estimateSize: () => 44,
    overscan: 8,
  });
  useEffect(() => { patientRowVirtualizer.measure(); }, [proposal, patientRowVirtualizer]);

  /* @Codex: il focus segue l'indice completo, non il sottoinsieme DOM prodotto
     dalla virtualizzazione. Dopo lo scroll attende il nuovo render e porta il
     focus sulla riga corrispondente. */
  const focusRowAtIndex = useCallback((requestedIndex: number) => {
    if (visible.length === 0) return;
    const index = Math.min(visible.length - 1, Math.max(0, requestedIndex));
    const patient = visible[index];
    if (!patient) return;
    // @Codex: virtualisation may defer focus. A later key command, focus outside
    // the list or unmount owns the destination before this frame can run.
    const request = ++rowFocusRequest.current;
    const origin = document.activeElement;
    if (rowFocusFrame.current !== null) window.cancelAnimationFrame(rowFocusFrame.current);
    onSelectPatient(patient.id);
    patientRowVirtualizer.scrollToIndex(index, { align: 'auto' });

    const focusRenderedRow = (attempts: number) => {
      rowFocusFrame.current = null;
      const active = document.activeElement;
      if (rowFocusRequest.current !== request || (active !== origin && active !== document.body)) return;
      const row = patientListParentRef.current?.querySelector<HTMLButtonElement>(
        `[data-patient-index="${index}"]`,
      );
      if (row) {
        row.focus();
        return;
      }
      if (attempts > 0) rowFocusFrame.current = window.requestAnimationFrame(() => focusRenderedRow(attempts - 1));
    };
    rowFocusFrame.current = window.requestAnimationFrame(() => focusRenderedRow(2));
  }, [onSelectPatient, patientRowVirtualizer, visible]);

  const currentRowIndex = useCallback((target: EventTarget | null) => {
    const focusedRow = target instanceof HTMLElement
      ? target.closest<HTMLElement>('[data-patient-index]')
      : null;
    const parsed = focusedRow ? Number(focusedRow.dataset.patientIndex) : Number.NaN;
    if (Number.isInteger(parsed)) return parsed;
    const selectedIndex = visible.findIndex((patient) => patient.id === selectedPatientId);
    return selectedIndex >= 0 ? selectedIndex : 0;
  }, [selectedPatientId, visible]);

  const navigateRows = useCallback((key: VirtualListNavigationKey, target: EventTarget | null) => {
    const viewportHeight = patientListParentRef.current?.clientHeight ?? 62;
    const index = nextVirtualRowIndex({
      key,
      currentIndex: currentRowIndex(target),
      rowCount: visible.length,
      pageSize: Math.max(1, Math.floor(viewportHeight / 44)),
    });
    if (index !== null) focusRowAtIndex(index);
  }, [currentRowIndex, focusRowAtIndex, proposal, visible.length]);

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const navigationKeys: VirtualListNavigationKey[] = [
      'ArrowDown', 'ArrowUp', 'j', 'k', 'Home', 'End', 'PageDown', 'PageUp',
    ];
    if (navigationKeys.includes(event.key as VirtualListNavigationKey)) {
      event.preventDefault();
      navigateRows(event.key as VirtualListNavigationKey, event.target);
      return;
    }
    if (event.key !== 'Enter') return;
    const patient = visible[currentRowIndex(event.target)];
    if (!patient) return;
    event.preventDefault();
    onSelectPatient(patient.id);
    if (isReview) onOpenArea('scheda');
    else router.push(patient.modulesHref);
  };

  /* @Codex: scorciatoie contestuali, disattivate nei campi editabili. */
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      else if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        const patient = visible[currentRowIndex(document.activeElement)];
        router.push(patient ? `${patient.href}/entries/new` : '/patients/new');
      } else if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        navigateRows(event.key, document.activeElement);
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [currentRowIndex, navigateRows, router, visible]);

  return (
    <div className={styles.areaShell} data-patient-directory={proposal ? 'proposal' : undefined}>
      <header className={patientStyles.directoryToolbar}>
        <h1 className="lume-voice">Pazienti<span aria-hidden="true">.</span></h1>
        <label className={patientStyles.patientSearchField}>
          <Search size={16} aria-hidden="true" />
          <input ref={searchInputRef} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca per nome, codice fiscale o diagnosi" aria-label="Cerca nella lista pazienti" />
          {query ? <button type="button" className={patientStyles.patientSearchClear} onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}>Cancella</button> : null}
        </label>
        <div className={patientStyles.inboxScope} aria-label="Stato elenco">
          <button type="button" className={classNames(patientStyles.scopeChip, list === 'attivi' && patientStyles.scopeChipActive)} aria-pressed={list === 'attivi'} onClick={() => setList('attivi')}>Attivi</button>
          <button type="button" className={classNames(patientStyles.scopeChip, list === 'archivio' && patientStyles.scopeChipActive)} aria-pressed={list === 'archivio'} onClick={() => setList('archivio')}>Archivio</button>
        </div>
        {isReview ? <select aria-label="Ambito pazienti" value={scope} onChange={event => setScope(event.target.value as InboxScope)}><option value="ambulatorio">Ambulatorio locale</option><option value="network">Rete locale</option><option value="tutti">Tutti gli ambulatori</option></select> : null}
        <Link href="/patients/new" className={styles.primaryBtn} data-lume-action="primary"><Plus size={16} aria-hidden />Nuova scheda</Link>
      </header>
      <div className={patientStyles.inboxLayout}>
        <section className={patientStyles.worklistPanel} aria-label={list === 'attivi' ? 'Pazienti in carico' : 'Archivio pazienti'} data-testid="lume-worklist">
          <header className={patientStyles.worklistPanelHeader}>
            <span className={patientStyles.resultCount}>{visible.length} {visible.length === 1 ? 'risultato' : 'risultati'}</span>
            <span className={patientStyles.keyboardHint}>↑ ↓ per scorrere · Invio per aprire</span>
          </header>
          <div className={patientStyles.columnHeadings} aria-hidden="true"><span>Paziente</span><span>Età</span><span>Problema principale</span><span>Aggiornato</span><span>Stato</span></div>
          <div style={{ marginTop: 8 }}>
            {/* @Codex */}
            {patientStatus === 'idle' || patientStatus === 'loading' ? (
              <div className={styles.emptyState} role="status" aria-live="polite" aria-label="Caricamento pazienti">
                <div className="mf-skeleton h-12" />
                <div className="mf-skeleton h-12 mt-2" />
                <div className="mf-skeleton h-12 mt-2" />
              </div>
            ) : patientStatus === 'error' ? (
              <div className={styles.emptyState} role="alert">
                {/* @Codex WUL-UIUX: l'errore dichiara cosa è successo e offre
                    l'azione di recupero, come chiede il contratto PRODUCT.md. */}
                <p>Lista pazienti non disponibile. Verifica sessione e servizi locali.</p>
                {onRetryPatients ? (
                  <button type="button" className={styles.ghostBtnSm} onClick={onRetryPatients}>
                    Riprova
                  </button>
                ) : null}
              </div>
            ) : visible.length === 0 ? (
              <p className={styles.emptyState}>
                {normalizedQuery
                  ? `Nessun risultato per “${query.trim()}”. Modifica la ricerca o cambia ambito.`
                  : 'Nessun paziente nell’ambito selezionato.'}
              </p>
            ) : (
              <div
                ref={patientListParentRef}
                className={patientStyles.patientListViewport}
                role="listbox"
                aria-label="Elenco pazienti in carico"
                data-testid="lume-patient-list"
                onKeyDown={handleListKeyDown}
              >
                <div
                  className={patientStyles.patientList}
                  style={{
                    height: `${patientRowVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {patientRowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const p = visible[virtualRow.index];
                    const isSelected = p.id === selected?.id;
                    const recordedDiagnoses = parseDiagnosisLabels(p.raw.diagnoses);
                    const diagnosisParts = recordedDiagnoses[0]?.split(' · ') ?? [];
                    const diagnosisDescription = diagnosisParts.length > 1 ? diagnosisParts.slice(1).join(' · ') : diagnosisParts[0];
                    return (
                      <div
                        key={p.id}
                        ref={patientRowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className={patientStyles.patientRowWrap}
                        role="presentation"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <button
                          type="button"
                          className={classNames(
                            patientStyles.patientRow,
                            isSelected && patientStyles.patientRowSelected,
                          )}
                          onClick={() => { onSelectPatient(p.id); if (proposal && window.matchMedia('(max-width: 850px)').matches) router.push(p.modulesHref); }}
                          onDoubleClick={() => { if (!isReview) router.push(p.modulesHref); }}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={isSelected ? 0 : -1}
                          data-patient-index={virtualRow.index}
                          data-testid="lume-patient-row"
                        >
                          <span className={patientStyles.recordIdentity}><strong>{p.name}</strong><span className={patientStyles.compactDiagnosis}>{diagnosisDescription || 'Diagnosi non registrata'}</span></span>
                          <span className={patientStyles.recordAge}>{p.ageLabel}</span>
                          <span className={patientStyles.recordDiagnosis}>{diagnosisDescription || 'Diagnosi non registrata'}</span>
                          <span className={patientStyles.patientWhen} data-testid="lume-patient-when">{p.lastTouch}</span>
                          <span className={patientStyles.patientStatusText} data-lume-row-part="status">{p.statusLabel}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {selected ? (
          <aside
            className={patientStyles.caseLens}
            key={selected.id}
            aria-label={`Lente paziente: ${selected.name}`}
            data-testid="lume-patient-lens"
          >
            <header className={patientStyles.caseLensHeader}>

              <h2 className={patientStyles.caseLensName}>{selected.name}</h2>
              <p className={classNames(patientStyles.caseLensAtoms, 'lume-registro')} data-testid="lume-patient-atoms">
                <span>{selected.ageLabel}</span>
                <span aria-hidden="true">·</span>
                <span>aggiornato {selected.lastTouch}</span>
                <span aria-hidden="true">·</span>
                <span>{selected.pathway}</span>
              </p>
            </header>
            {/* @Codex: codice e descrizione restano contenuto naturale delle voci. */}
            <ul
              className={patientStyles.caseLensDiagnoses}
              aria-label={`Diagnosi codificate di ${selected.name}`}
              data-lume-diagnosis-list="true"
            >
              {selected.diagnoses.map((d) => (
                <li key={d} className={patientStyles.patientDiagnosisPill}>
                  <DiagnosisPill diagnosis={d} />
                </li>
              ))}
            </ul>
            <p className={patientStyles.caseLensStatus}>
              {selected.statusLabel}
            </p>
            <p className="lume-code" data-testid="lume-patient-code">{selected.code}</p>
            <p className={patientStyles.caseLensSummary}>
              {selected.summary}
            </p>
            <div className={classNames(patientStyles.caseLensActions, patientStyles.worklistLensActions)}>
              <Link href={selected.modulesHref} className={styles.primaryBtn} data-lume-action="primary">
                <UserSquare2 size={13} />
                Apri scheda paziente
              </Link>
              <div ref={actionsRef} className={patientStyles.caseLensActionOverflow}>
                <button
                  ref={actionsTriggerRef}
                  type="button"
                  className={patientStyles.caseLensOverflowTrigger}
                  aria-label="Altre azioni paziente"
                  aria-haspopup="menu"
                  aria-expanded={isActionsOpen}
                  aria-controls={isActionsOpen ? 'lume-patient-actions-menu' : undefined}
                  data-lume-action="overflow"
                  onClick={() => setIsActionsOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown') return;
                    event.preventDefault();
                    setIsActionsOpen(true);
                  }}
                >
                  <Ellipsis size={18} aria-hidden="true" />
                </button>
                {isActionsOpen ? createPortal(
                  <div
                    ref={actionsMenuRef}
                    id="lume-patient-actions-menu"
                    className={patientStyles.caseLensActionMenu}
                    role="menu"
                    aria-label="Azioni paziente"
                    data-positioned={actionsMenuPosition ? 'true' : 'false'}
                    style={actionsMenuPosition ?? undefined}
                    onKeyDown={handleActionMenuKeyDown}
                  >
                    {overflowActions.map(({ href, icon, label, run }) => href ? (
                      <Link key={label} href={href} className={patientStyles.caseLensMenuItem} role="menuitem" tabIndex={-1} onClick={() => setIsActionsOpen(false)}>
                        {icon}{label}
                      </Link>
                    ) : (
                      <button key={label} type="button" className={patientStyles.caseLensMenuItem} role="menuitem" tabIndex={-1} onClick={() => { setIsActionsOpen(false); run?.(); }}>
                        {icon}{label}
                      </button>
                    ))}
                  </div>,
                  document.body,
                ) : null}
              </div>
            </div>
          </aside>
        ) : (
          <aside className={patientStyles.caseLens} aria-label="Lente paziente" data-testid="lume-patient-lens">

            <p className={patientStyles.caseLensEmpty} data-testid="lume-patient-lens-empty">
              {normalizedQuery
                ? 'Nessun paziente corrisponde alla ricerca corrente.'
                : 'Nessun paziente selezionabile in questa vista.'}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

export { IncaricoArea };
