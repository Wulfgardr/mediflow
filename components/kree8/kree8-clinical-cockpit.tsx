'use client';

/* WUL-272 live Kree8-inspired MediFlow cockpit.
   Renders as the root local web entry in live mode and remains available under
   /mockups/kree8 as a review alias. WUL-273 starts the real-data migration for
   live patients/checkups after PIN unlock; the review alias remains synthetic. */

import { type FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import { useRuntimeWorkspaceArea, useRuntimeWorkspaceCommand } from '@/components/runtime-twin-workspace';
import { X } from 'lucide-react';

import { db } from '@/lib/db';
/* WUL-UIUX Fase 7: pipeline dati del Quadro condivisa con la Scheda. */
import {
  buildPatientWorkspace,
  countPlannedCheckups,
  countTodayCheckups,
  mapCheckupsForKree8,
  type Kree8Patient,
  type Kree8PatientWorkspace,
} from '@/lib/patient-workspace';
import { projectWorklistTodos, type WorklistTodos } from '@/lib/worklist-todo';
import { useLiveQuery, useLiveQueryState } from '@/lib/live-query';
import { subscribeClientAccountAuthority } from '@/lib/security/client-auth-api';
import { readCockpitRows } from './cockpit-read-snapshot';
import { ThemeToggle } from '@/components/theme-toggle';
// WUL-297: persistent privacy affordance in the app header.
import { PrivacyModeToggle } from '@/components/privacy-mode-toggle';
import { TurnoArea } from './areas/turno-area';
import { IncaricoArea } from './areas/incarico-area';
import { SchedaArea } from './areas/scheda-area';
import { LiveDocumentReviewArea } from './areas/live-document-review-area';
import { LiveHandoffArea } from './areas/live-handoff-area';
import { LiveGovernanceArea } from './areas/live-governance-area';
import { DiarioArea } from './areas/diario-area';
import { RevisioneArea } from './areas/revisione-area';
import { RepertoriArea } from './areas/repertori-area';
import { HandoffArea } from './areas/handoff-area';
import { GovernanceArea } from './areas/governance-area';
import { Kree8CommandCenter, type CommandCenterMode } from './kree8-command-center';
import {
  AREA_ID_VALUES,
  AREAS,
  PRIMARY_AREA_IDS,
  REVIEW_AGENDA,
  REVIEW_DIARY_STATE,
  REVIEW_PATIENT_LIST,
  Toolbar,
  buildGlobalDiaryState,
  classNames,
  mapPatientForKree8,
  railAreaIsSelected,
} from './cockpit-shared';
import type {
  AreaId,
  ClinicalAgendaBridgeClientState,
  ClinicalAgendaBridgePreview,
  Kree8AgendaClientState,
  Kree8DiaryClientState,
  Kree8PatientClientState,
  StatusFilter,
} from './cockpit-shared';
import styles from './kree8-clinical-cockpit-shell.module.css';

export { AREA_ID_VALUES };
export type { AreaId };

function revealFocusedRailControl(event: FocusEvent<HTMLElement>): void {
  const rail = event.currentTarget;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const focusOutset =
    Number.parseFloat(getComputedStyle(rail).getPropertyValue('--k8-rail-focus-outset')) || 0;
  const horizontalDelta = () => {
    const railRect = rail.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scrollportLeft = railRect.left + rail.clientLeft;
    const scrollportRight = scrollportLeft + rail.clientWidth;
    const leftOverflow = targetRect.left - focusOutset - scrollportLeft;
    if (leftOverflow < 0) return leftOverflow;
    return Math.max(0, targetRect.right + focusOutset - scrollportRight);
  };

  if (horizontalDelta() === 0) return;
  target.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
  const residualDelta = horizontalDelta();
  if (residualDelta === 0) return;

  const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
  rail.scrollLeft = Math.min(maxScrollLeft, Math.max(0, rail.scrollLeft + residualDelta));
}

/* ───────────────────────── shell ───────────────────────── */

function AreaContent({
  area,
  filter,
  setFilter,
  agendaBridge,
  patientState,
  agendaState,
  diaryState,
  worklistTodos,
  selectedPatient,
  selectedPatientId,
  patientWorkspace,
  patientSearchFocusSignal,
  isReview,
  onSelectPatient,
  onAlignPatient,
  onOpenArea,
  onRetryPatients,
  onRetryAgenda,
  onRetryDiary,
  onRetryTodos,
}: {
  area: AreaId;
  filter: StatusFilter;
  setFilter: (filter: StatusFilter) => void;
  agendaBridge: ClinicalAgendaBridgeClientState;
  patientState: Kree8PatientClientState;
  agendaState: Kree8AgendaClientState;
  diaryState: Kree8DiaryClientState;
  worklistTodos: WorklistTodos;
  selectedPatient?: Kree8Patient | null;
  selectedPatientId?: string;
  patientWorkspace?: Kree8PatientWorkspace | null;
  patientSearchFocusSignal: number;
  isReview: boolean;
  onSelectPatient: (patientId: string) => void;
  onAlignPatient: (patientId: string) => void;
  onOpenArea: (area: AreaId) => void;
  onRetryPatients: () => void;
  onRetryAgenda: () => void;
  onRetryDiary: () => void;
  onRetryTodos: () => void;
}) {
  switch (area) {
    case 'turno':
      return (
        <TurnoArea
          filter={filter}
          setFilter={setFilter}
          agendaBridge={agendaBridge}
          patientState={patientState}
          agendaState={agendaState}
          isReview={isReview}
          onSelectPatient={onSelectPatient}
          onOpenArea={onOpenArea}
          onRetry={onRetryAgenda}
        />
      );
    case 'incarico':
      return (
        <IncaricoArea
          patients={patientState.patients}
          patientStatus={patientState.status}
          todos={worklistTodos}
          onRetryTodos={isReview ? undefined : onRetryTodos}
          selectedPatientId={selectedPatientId}
          searchFocusSignal={patientSearchFocusSignal}
          onSelectPatient={onSelectPatient}
          onAlignPatient={onAlignPatient}
          onOpenArea={onOpenArea}
          onRetryPatients={onRetryPatients}
          isReview={isReview}
        />
      );
    case 'scheda':
      return (
        <SchedaArea
          patient={selectedPatient}
          isReview={isReview}
          onOpenArea={onOpenArea}
        />
      );
    case 'diario':
      return (
        <DiarioArea
          diaryState={diaryState}
          onOpenArea={onOpenArea}
          onSelectPatient={onSelectPatient}
          onRetry={isReview ? undefined : onRetryDiary}
        />
      );
    case 'revisione':
      return isReview
        ? <RevisioneArea />
        : (
          <LiveDocumentReviewArea
            patient={selectedPatient}
            workspace={patientWorkspace}
            onOpenArea={onOpenArea}
          />
        );
    case 'repertori':
      return <RepertoriArea isReview={isReview} />;
    case 'handoff':
      return isReview
        ? <HandoffArea />
        : <LiveHandoffArea patient={selectedPatient} onOpenArea={onOpenArea} />;
    case 'governance':
      return isReview
        ? <GovernanceArea />
        : <LiveGovernanceArea patientCount={patientState.patients.length} />;
  }
}

type Kree8ClinicalCockpitProps = {
  surface?: 'live' | 'review';
  initialArea?: AreaId;
  initialPatientId?: string;
  operatorName?: string;
};

export function Kree8ClinicalCockpit({
  surface = 'live',
  initialArea = 'turno',
  initialPatientId,
  operatorName: operatorNameProp,
}: Kree8ClinicalCockpitProps) {
  const { proposal } = useRuntimeTwinDesign();
  const router = useRouter();
  const isReview = surface === 'review';
  const operatorName = operatorNameProp || (isReview ? 'Review design' : 'Sessione locale');
  const [area, setArea] = useState<AreaId>(() => (isReview ? 'turno' : initialArea));
  useRuntimeWorkspaceArea(isReview ? null : area);
  const [areaFocusRequest, setAreaFocusRequest] = useState(0);
  const previousRouteArea = useRef(initialArea);
  const focusSurfaceRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [patientSearchFocusSignal, setPatientSearchFocusSignal] = useState(0);
  const [commandCenterMode, setCommandCenterMode] = useState<CommandCenterMode>(null);
  const openCommandCenter = useCallback(() => setCommandCenterMode('commands'), []);
  const commandsInWorkspace = useRuntimeWorkspaceCommand(isReview ? null : openCommandCenter);
  const [agendaBridge, setAgendaBridge] = useState<ClinicalAgendaBridgeClientState>({
    status: 'idle',
  });
  const [patientState, setPatientState] = useState<Kree8PatientClientState>(() => (
    isReview
      ? { status: 'ready', patients: REVIEW_PATIENT_LIST }
      : { status: 'idle', patients: [] }
  ));
  const snapshotVisibility = useRef({ valid: true });
  const [, invalidateVisibleSnapshots] = useState(0);
  useEffect(() => {
    snapshotVisibility.current = { valid: true };
    const hide = () => {
      snapshotVisibility.current.valid = false;
      invalidateVisibleSnapshots(value => value + 1);
    };
    const show = () => {
      if (!snapshotVisibility.current.valid) snapshotVisibility.current = { valid: true };
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      snapshotVisibility.current.valid = false;
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, []);
  const [selectedPatientId, setSelectedPatientId] = useState<string | undefined>(() => (
    isReview ? REVIEW_PATIENT_LIST[0]?.id : initialPatientId
  ));

  /* Next keeps the cockpit mounted when only the query changes. */
  useEffect(() => {
    if (!isReview && previousRouteArea.current !== initialArea) {
      // Our own URL reflection already changed area and placed focus.
      // Only navigation to another area schedules a new heading focus request.
      if (area !== initialArea) {
        setArea(initialArea);
        setAreaFocusRequest((current) => current + 1);
      }
    }
    previousRouteArea.current = initialArea;
  }, [area, initialArea, isReview, proposal]);
  useEffect(() => {
    if (!isReview && initialPatientId) setSelectedPatientId(initialPatientId);
  }, [initialPatientId, isReview, proposal]);

  /* only an explicit command writes the URL. Deriving a default or
     filtered selection from a late read must not cancel a pending Next link.
     Patch only the command's field so batched selection + navigation compose. */
  const updateLocation = useCallback((change: { area?: AreaId; patientId?: string }) => {
    if (isReview || window.location.pathname !== '/') return;
    const url = new URL(window.location.href);
    if (change.area) url.searchParams.set('area', change.area);
    if (change.patientId) url.searchParams.set('paziente', change.patientId);
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  }, [isReview]);
  const selectPatient = useCallback((patientId: string) => {
    setSelectedPatientId(patientId);
    updateLocation({ patientId });
  }, [updateLocation]);

  /* ogni CTA interna termina sul titolo semantico della nuova area.
     La ricerca conserva invece il proprio target di focus dedicato. */
  const openArea = useCallback((nextArea: AreaId, focusDestination = true) => {
    setArea(nextArea);
    // preserve the originating area for Back from the patient folder.
    if (!(proposal && !isReview && nextArea === 'scheda')) updateLocation({ area: nextArea });
    if (focusDestination) setAreaFocusRequest((current) => current + 1);
  }, [isReview, proposal, updateLocation]);

  /* il contatore rende osservabile anche una richiesta verso l'area
     gia attiva; requestAnimationFrame lascia completare render e cleanup di
     eventuali dialog prima di spostare focus e viewport. */
  useEffect(() => {
    if (areaFocusRequest === 0) return;
    const animationFrame = window.requestAnimationFrame(() => {
      // A modal may open after navigation scheduled this frame. Its
      // focus owns keyboard input until close, including Escape and Tab.
      const visibleModal = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-modal="true"]',
      )).some((dialog) => dialog.getClientRects().length > 0);
      if (visibleModal) return;
      // Typing or the search shortcut may take focus before this
      // deferred navigation frame. Preserve that newer editing intent.
      const active = document.activeElement;
      if (active instanceof HTMLElement && (
        active.matches('input, textarea, select, [role="textbox"], [role="combobox"]')
        || active.isContentEditable
      )) return;
      const focusSurface = focusSurfaceRef.current;
      if (!focusSurface) return;
      const focusTarget = focusSurface.querySelector<HTMLElement>(
        'h1, [role="heading"][aria-level="1"]',
      ) ?? focusSurface;
      focusTarget.tabIndex = -1;
      focusTarget.scrollIntoView({ behavior: 'auto', block: 'start' });
      focusTarget.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [areaFocusRequest]);

  /* owner unico dei soli comandi globali della shell. K1 conserva / e
     j/k nella worklist; i target editabili e modificatori non standard restano
     fuori da questa scorciatoia per non intercettare input dell'utente. */
  useEffect(() => {
    const handleGlobalCommand = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLocaleLowerCase('it-IT') === 'k') {
        event.preventDefault();
        setCommandCenterMode((current) => current === 'commands' ? null : 'commands');
        return;
      }
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      setCommandCenterMode('help');
    };
    window.addEventListener('keydown', handleGlobalCommand);
    return () => window.removeEventListener('keydown', handleGlobalCommand);
  }, []);

  const selectedPatient = useMemo(
    () => {
      const selected = patientState.patients.find((patient) => patient.id === selectedPatientId);
      if (selected) return selected;
      if (!isReview && initialPatientId && selectedPatientId === initialPatientId) return null;
      return patientState.patients[0] ?? null;
    },
    [initialPatientId, isReview, patientState.patients, selectedPatientId],
  );

  /* a single owner resolves batched patient selection + Apri quadro.
     A child redirect must not replace the explicit hash with a generic folder.
     The original comparison keeps its existing replace navigation. */
  const folderPatientId = selectedPatientId ?? selectedPatient?.id;
  const liveSchedaHref = isReview || area !== 'scheda' ? null
    : proposal && folderPatientId ? `/patients/${folderPatientId}/modules#quadro`
      : selectedPatient?.modulesHref ?? null;
  useEffect(() => {
    if (!liveSchedaHref) return;
    if (proposal) router.push(liveSchedaHref);
    else router.replace(liveSchedaHref);
  }, [liveSchedaHref, proposal, router]);

  const {
    data: patientSnapshot,
    error: livePatientError,
    loading: livePatientLoading,
    refresh: refreshPatients,
  } = useLiveQueryState(
    async () => isReview ? null : readCockpitRows(options => db.patients.toArray(options), snapshotVisibility.current),
    [isReview],
    undefined,
    ['patients', 'patients_to_ambulatories'],
  );

  const { data: checkupSnapshot, loading: checkupLoading, error: checkupError, refresh: refreshCheckups } = useLiveQueryState(
    async () => isReview ? null : readCockpitRows(options => db.checkups.toArray(options), snapshotVisibility.current),
    [isReview],
    undefined,
    ['checkups'],
  );

  const { data: diarySnapshot, loading: diaryLoading, error: diaryError, refresh: refreshDiary } = useLiveQueryState(
    async () => isReview ? null : readCockpitRows(options => db.entries.query({ orderBy: 'date', orderDir: 'desc', limit: 50 }).toArray(options), snapshotVisibility.current),
    [isReview],
    undefined,
    ['entries'],
  );

  useEffect(() => subscribeClientAccountAuthority(() => {
    invalidateVisibleSnapshots(value => value + 1);
    refreshPatients();
    refreshCheckups();
    refreshDiary();
  }), [refreshPatients, refreshCheckups, refreshDiary]);

  const livePatientRows = patientSnapshot?.isCurrent() ? patientSnapshot.rows : undefined;
  const liveCheckupRows = checkupSnapshot?.isCurrent() ? checkupSnapshot.rows : undefined;
  const worklistTodos = useMemo(() => projectWorklistTodos({
    data: liveCheckupRows, loading: !isReview && checkupLoading, error: checkupError,
  }), [liveCheckupRows, isReview, checkupLoading, checkupError]);
  const liveDiaryRows = diarySnapshot?.isCurrent() ? diarySnapshot.rows : undefined;
  const directoryPatientState: Kree8PatientClientState = (() => {
    if (isReview || area !== 'incarico') return patientState;
    if (livePatientLoading) return { status: 'loading', patients: [] };
    if (livePatientError || (patientSnapshot && !livePatientRows)) return { status: 'error', patients: [] };
    const currentRows = new Set<object>(livePatientRows);
    const projectionCurrent = livePatientRows && patientState.status === 'ready'
      && patientState.patients.length === livePatientRows.length
      && patientState.patients.every(patient => currentRows.has(patient.raw));
    return projectionCurrent ? patientState : { status: 'loading', patients: [] };
  })();
  const mappedPatients = useMemo(() => (livePatientRows ?? []).map(mapPatientForKree8), [livePatientRows]);
  const agendaLoading = livePatientLoading || checkupLoading;
  const agendaError = Boolean(livePatientError || checkupError);
  const agendaHasSnapshot = Boolean(livePatientRows && liveCheckupRows
    && (!(agendaLoading || agendaError) || (patientSnapshot?.retainOnRefresh && checkupSnapshot?.retainOnRefresh)));
  const agendaState: Kree8AgendaClientState = isReview ? { status: 'ready', rows: REVIEW_AGENDA } : {
    status: agendaLoading ? 'loading' : agendaError ? 'error' : agendaHasSnapshot ? 'ready' : 'loading',
    rows: agendaHasSnapshot ? mapCheckupsForKree8(liveCheckupRows!, mappedPatients, filter) : [],
    hasSnapshot: agendaHasSnapshot,
    canRefresh: Boolean(livePatientRows && liveCheckupRows),
    patientsUnavailable: Boolean(livePatientError),
    todayCount: agendaHasSnapshot ? countTodayCheckups(liveCheckupRows!) : undefined,
    plannedCount: agendaHasSnapshot ? countPlannedCheckups(liveCheckupRows!) : undefined,
  };
  const diaryPending = livePatientLoading || diaryLoading;
  const diaryFailed = Boolean(livePatientError || diaryError);
  const diaryHasSnapshot = Boolean(livePatientRows && liveDiaryRows
    && (!(diaryPending || diaryFailed) || (patientSnapshot?.retainOnRefresh && diarySnapshot?.retainOnRefresh)));
  const diaryState: Kree8DiaryClientState = isReview ? REVIEW_DIARY_STATE : {
    ...(diaryHasSnapshot ? buildGlobalDiaryState(liveDiaryRows!, mappedPatients) : { entries: [], activeCount: 0, patientCount: 0 }),
    status: diaryPending ? 'loading' : diaryFailed ? 'error' : diaryHasSnapshot ? 'ready' : 'loading',
    hasSnapshot: diaryHasSnapshot,
    canRefresh: Boolean(livePatientRows && liveDiaryRows),
    patientsUnavailable: Boolean(livePatientError),
  };

  const patientWorkspace = useLiveQuery<Kree8PatientWorkspace | null>(
    async () => {
      if (isReview || !selectedPatient) return null;
      const patientId = selectedPatient.id;
      const [entries, therapies, checkups, observations, attachments] = await Promise.all([
        db.entries.query({ patientId }).toArray(),
        db.therapies.query({ patientId }).toArray(),
        db.checkups.query({ patientId }).toArray(),
        db.observations.query({ patientId }).toArray(),
        db.attachments.query({ patientId, metadataOnly: true }).toArray(),
      ]);

      return buildPatientWorkspace({
        patient: selectedPatient,
        entries,
        therapies,
        checkups,
        observations,
        attachments,
      });
    },
    [isReview, selectedPatient?.id],
    undefined,
    ['patients', 'entries', 'therapies', 'checkups', 'observations', 'attachments'],
  );

  useEffect(() => {
    if (isReview) return;

    const controller = new AbortController();
    setAgendaBridge({ status: 'loading' });

    fetch('/api/clinical-agenda/candidates?days=45&pastDays=1&limit=6', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('clinical agenda bridge unavailable');
        return response.json() as Promise<ClinicalAgendaBridgePreview>;
      })
      .then((data) => {
        setAgendaBridge({ status: 'ready', data });
      })
      .catch((error: Error) => {
        if (error.name === 'AbortError') return;
        setAgendaBridge({ status: 'error' });
      });

    return () => controller.abort();
  }, [isReview]);

  useEffect(() => {
    if (isReview) return;

    if (livePatientLoading) {
      setPatientState({ status: 'loading', patients: [] });
      return;
    }

    if (livePatientError) {
      setPatientState({ status: 'error', patients: [] });
      return;
    }

    /* WUL-UIUX: ordina per aggiornamento piu recente (updatedAt, poi
       createdAt) cosi la lista pazienti non esce in ordine di inserimento
       IndexedDB e lo scanning "recenti" e possibile. */
    const patients = [...(livePatientRows ?? [])]
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
        const rightTime = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
        return rightTime - leftTime;
      })
      .map(mapPatientForKree8);
    setPatientState({ status: 'ready', patients });
    setSelectedPatientId((current) => {
      if (current && patients.some((patient) => patient.id === current)) return current;
      if (initialPatientId) return initialPatientId;
      return patients[0]?.id;
    });
  }, [
    initialPatientId,
    isReview,
    livePatientError,
    livePatientLoading,
    livePatientRows,
  ]);

  const patientNavMeta =
    isReview
      ? '312'
      : patientState.status === 'ready'
        ? String(patientState.patients.filter((patient) => patient.list === 'attivi').length)
        : patientState.status === 'error'
          ? 'n.d.'
          : '…';
  const diaryNavMeta =
    isReview
      ? String(REVIEW_DIARY_STATE.entries.length)
      : diaryState.status === 'ready'
        ? String(diaryState.activeCount)
        : '…';

  return (
    <div
      className={styles.shell}
      aria-label={isReview ? 'MediFlow · Kree8 review surface' : 'MediFlow · spazio clinico Kree8'}
      data-testid="lume-frame"
      data-lume-frame-element="shell"
    >
      <aside
        className={styles.rail}
        data-testid="lume-frame-rail"
        data-lume-frame-element="rail"
        onFocusCapture={revealFocusedRailControl}
      >
        <div className={styles.brand}>
          <span className={styles.brandMark}>MF</span>
          <span className={styles.brandWord}>MEDIFLOW</span>
          <span className={styles.brandActions}>
            {/* WUL-297: persistent privacy affordance in the app header */}
            <PrivacyModeToggle />
            <span className={styles.brandThemeToggle}>
              <ThemeToggle />
            </span>
            {/* WUL-UIUX: campanella rimossa: sembrava un centro notifiche
                ma non faceva nulla. Torna quando esistera un centro notifiche reale. */}
          </span>
        </div>

        <span className={styles.railLabel}>Navigazione</span>
        {AREAS.filter((a) => PRIMARY_AREA_IDS.includes(a.id)).map((a) => {
          const selected = railAreaIsSelected(a.id, area);
          const navMeta =
            a.id === 'incarico'
              ? patientNavMeta
              : a.id === 'diario'
                ? diaryNavMeta
                : a.meta;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => openArea(a.id)}
              className={classNames(styles.navItem, selected && styles.navSelected)}
              aria-current={selected ? 'page' : undefined}
              data-lume-frame-nav="true"
              data-lume-frame-element="nav-item"
            >
              <span>{a.label}</span>
              {navMeta && <span className={`${styles.navMeta} lume-registro`}>{navMeta}</span>}
            </button>
          );
        })}

        <div className={styles.railFooter}>
          {/* WUL-UIUX: un solo ThemeToggle (qui rimosso): era renderizzato
              due volte, nel brand e a piè rail, con lo stesso stato. */}
          <span className={styles.railTag}>
            <span className={styles.railDot} />
            Mac principale
          </span>
          {isReview ? <span>Review design</span> : null}
        </div>
      </aside>

      <section
        className={styles.canvas}
        data-lume-context={area}
        data-testid="lume-frame-canvas"
        data-lume-frame-element="canvas"
      >
        <Toolbar
          activeArea={area}
          filter={filter}
          setFilter={setFilter}
          onOpenArea={openArea}
          onSearchRequest={() => {
            openArea('incarico', false);
            setPatientSearchFocusSignal((current) => current + 1);
          }}
          onOpenCommand={openCommandCenter}
          commandsInWorkspace={commandsInWorkspace}
          searchAcrossAreas={isReview}
          operatorName={operatorName}
        />
        <div
          className={styles.framePanel}
          data-testid="lume-frame-panel"
          data-lume-frame-element="panel"
        >
          <main
            ref={focusSurfaceRef}
            tabIndex={-1}
            className={styles.focusSurface}
            data-lume-focus="true"
            data-testid="lume-frame-focus"
            data-lume-frame-element="focus"
          >
            {/* WUL-UIUX: where-am-i persistente nelle sotto-aree paziente
                (il rail le colora come Pazienti): tab Quadro / Documenti / SISS con
                aria-current e nome del paziente attivo. */}
            {(area === 'scheda' || area === 'revisione' || area === 'handoff') ? (
              <nav className={styles.subareaTabs} aria-label="Sezioni del paziente">
                {selectedPatient ? (
                  <span className={styles.subareaPatient}>{selectedPatient.name}</span>
                ) : null}
                {([
                  { id: 'scheda' as AreaId, label: 'Quadro' },
                  { id: 'revisione' as AreaId, label: 'Documenti' },
                  { id: 'handoff' as AreaId, label: 'SISS' },
                ]).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => openArea(tab.id)}
                    aria-current={area === tab.id ? 'page' : undefined}
                    className={`${styles.subareaTab} ${area === tab.id ? styles.subareaTabActive : ''}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            ) : null}
            <div className={styles.focusContent}>
              <AreaContent
                setFilter={setFilter}
                area={area}
                filter={filter}
                agendaBridge={agendaBridge}
                patientState={directoryPatientState}
                agendaState={agendaState}
                diaryState={diaryState}
                worklistTodos={worklistTodos}
                onRetryTodos={refreshCheckups}
                selectedPatient={selectedPatient}
                selectedPatientId={selectedPatientId}
                patientWorkspace={patientWorkspace}
                patientSearchFocusSignal={patientSearchFocusSignal}
                isReview={isReview}
                onSelectPatient={selectPatient}
                onAlignPatient={setSelectedPatientId}
                onOpenArea={openArea}
                onRetryPatients={refreshPatients}
                onRetryAgenda={() => { refreshPatients(); refreshCheckups(); }}
                onRetryDiary={() => { refreshPatients(); refreshDiary(); }}
              />
            </div>
          </main>
        </div>
      </section>

      <Kree8CommandCenter
        mode={commandCenterMode}
        onClose={() => setCommandCenterMode(null)}
        onOpenArea={openArea}
        onSearchRequest={() => {
          openArea('incarico', false);
          setPatientSearchFocusSignal((current) => current + 1);
        }}
        onShowHelp={() => setCommandCenterMode('help')}
      />

      {isReview && (
        <Link href="/" className={styles.exit} aria-label="Torna alla home MediFlow live">
          <X size={12} />
          Esci dalla review
        </Link>
      )}
    </div>
  );
}

export default Kree8ClinicalCockpit;
