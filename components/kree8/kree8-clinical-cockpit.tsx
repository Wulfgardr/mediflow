'use client';

/* @Codex */
/* WUL-272 live Kree8-inspired MediFlow cockpit.
   Renders as the root local web entry in live mode and remains available under
   /mockups/kree8 as a review alias. WUL-273 starts the real-data migration for
   live patients/checkups after PIN unlock; the review alias remains synthetic. */

import { type FocusEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

import {
  db,
  type Checkup,
  type ClinicalEntry,
  type Patient,
} from '@/lib/db';
/* @Codex WUL-UIUX Fase 7: pipeline dati del Quadro condivisa con la Scheda. */
import {
  buildPatientWorkspace,
  countPlannedCheckups,
  countTodayCheckups,
  mapCheckupsForKree8,
  type Kree8Patient,
  type Kree8PatientWorkspace,
} from '@/lib/patient-workspace';
import { useLiveQuery, useLiveQueryState } from '@/lib/live-query';
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

/* @Codex */
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
  agendaBridge,
  patientState,
  agendaState,
  diaryState,
  selectedPatient,
  selectedPatientId,
  patientWorkspace,
  patientSearchFocusSignal,
  isReview,
  onSelectPatient,
  onOpenArea,
}: {
  area: AreaId;
  filter: StatusFilter;
  agendaBridge: ClinicalAgendaBridgeClientState;
  patientState: Kree8PatientClientState;
  agendaState: Kree8AgendaClientState;
  diaryState: Kree8DiaryClientState;
  selectedPatient?: Kree8Patient | null;
  selectedPatientId?: string;
  patientWorkspace?: Kree8PatientWorkspace | null;
  patientSearchFocusSignal: number;
  isReview: boolean;
  onSelectPatient: (patientId: string) => void;
  onOpenArea: (area: AreaId) => void;
}) {
  switch (area) {
    case 'turno':
      return (
        <TurnoArea
          filter={filter}
          agendaBridge={agendaBridge}
          patientState={patientState}
          agendaState={agendaState}
          isReview={isReview}
          onOpenArea={onOpenArea}
        />
      );
    case 'incarico':
      return (
        <IncaricoArea
          patients={patientState.patients}
          patientStatus={patientState.status}
          selectedPatientId={selectedPatientId}
          searchFocusSignal={patientSearchFocusSignal}
          onSelectPatient={onSelectPatient}
          onOpenArea={onOpenArea}
          isReview={isReview}
        />
      );
    case 'scheda':
      return (
        <SchedaArea
          patient={selectedPatient}
          workspace={patientWorkspace}
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
  const isReview = surface === 'review';
  const operatorName = operatorNameProp || (isReview ? 'Review design' : 'Sessione locale');
  const [area, setArea] = useState<AreaId>(() => (isReview ? 'turno' : initialArea));
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [patientSearchFocusSignal, setPatientSearchFocusSignal] = useState(0);
  const [agendaBridge, setAgendaBridge] = useState<ClinicalAgendaBridgeClientState>({
    status: 'idle',
  });
  const [patientState, setPatientState] = useState<Kree8PatientClientState>(() => (
    isReview
      ? { status: 'ready', patients: REVIEW_PATIENT_LIST }
      : { status: 'idle', patients: [] }
  ));
  const [agendaState, setAgendaState] = useState<Kree8AgendaClientState>(() => (
    isReview
      ? { status: 'ready', rows: REVIEW_AGENDA }
      : { status: 'idle', rows: [] }
  ));
  const [selectedPatientId, setSelectedPatientId] = useState<string | undefined>(() => (
    isReview ? REVIEW_PATIENT_LIST[0]?.id : initialPatientId
  ));

  /* @Codex WUL-UIUX: riflette area e paziente selezionato nella query string di
     '/', cosi refresh e back del browser non perdono il punto di lavoro. Solo
     sulla home (le route dedicate come /diary restano canoniche) e solo in live.
     replaceState conserva history.state per non disturbare il router Next. */
  useEffect(() => {
    if (isReview || typeof window === 'undefined') return;
    if (window.location.pathname !== '/') return;
    const url = new URL(window.location.href);
    url.searchParams.set('area', area);
    if (selectedPatientId) {
      url.searchParams.set('paziente', selectedPatientId);
    } else {
      url.searchParams.delete('paziente');
    }
    window.history.replaceState(window.history.state, '', url);
  }, [area, selectedPatientId, isReview]);

  const selectedPatient = useMemo(
    () => {
      const selected = patientState.patients.find((patient) => patient.id === selectedPatientId);
      if (selected) return selected;
      if (!isReview && initialPatientId && selectedPatientId === initialPatientId) return null;
      return patientState.patients[0] ?? null;
    },
    [initialPatientId, isReview, patientState.patients, selectedPatientId],
  );

  /* @Codex */
  const {
    data: livePatientRows,
    error: livePatientError,
    loading: livePatientLoading,
  } = useLiveQueryState<Patient[]>(
    async () => (isReview ? [] : db.patients.toArray()),
    [isReview],
    undefined,
    ['patients', 'patients_to_ambulatories'],
  );

  /* @Codex */
  const liveCheckupRows = useLiveQuery<Checkup[]>(
    async () => (isReview ? [] : db.checkups.toArray()),
    [isReview],
    undefined,
    ['checkups'],
  );

  /* @Codex */
  const liveDiaryRows = useLiveQuery<ClinicalEntry[]>(
    async () => (isReview ? [] : db.entries.query({ orderBy: 'date', orderDir: 'desc', limit: 50 }).toArray()),
    [isReview],
    undefined,
    ['entries'],
  );

  /* @Codex */
  const diaryState = useMemo<Kree8DiaryClientState>(() => {
    if (isReview) return REVIEW_DIARY_STATE;
    if (!liveDiaryRows || patientState.status !== 'ready') {
      return {
        status: 'loading',
        entries: [],
        activeCount: 0,
        patientCount: 0,
      };
    }
    return buildGlobalDiaryState(liveDiaryRows, patientState.patients);
  }, [isReview, liveDiaryRows, patientState.patients, patientState.status]);

  /* @Codex */
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
    if (isReview || !initialPatientId) return;
    setSelectedPatientId(initialPatientId);
    setArea(initialArea);
  }, [initialArea, initialPatientId, isReview]);

  useEffect(() => {
    if (isReview) return;

    if (livePatientLoading) {
      setPatientState({ status: 'loading', patients: [] });
      setAgendaState({ status: 'loading', rows: [] });
      return;
    }

    if (livePatientError) {
      setPatientState({ status: 'error', patients: [] });
      setAgendaState({ status: 'loading', rows: [] });
      return;
    }

    /* @Codex WUL-UIUX: ordina per aggiornamento piu recente (updatedAt, poi
       createdAt) cosi la lista pazienti non esce in ordine di inserimento
       IndexedDB e lo scanning "recenti" e possibile. */
    const patients = [...(livePatientRows ?? [])]
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
        const rightTime = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
        return rightTime - leftTime;
      })
      .map(mapPatientForKree8);
    const checkups = liveCheckupRows ?? [];
    setPatientState({ status: 'ready', patients });
    setAgendaState({
      status: liveCheckupRows ? 'ready' : 'loading',
      rows: mapCheckupsForKree8(checkups, patients),
      todayCount: countTodayCheckups(checkups),
      plannedCount: countPlannedCheckups(checkups),
    });
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
    liveCheckupRows,
  ]);

  const patientNavMeta =
    isReview
      ? '312'
      : patientState.status === 'ready'
        ? String(patientState.patients.filter((patient) => patient.list === 'attivi').length)
        : patientState.status === 'error'
          ? '!'
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
            {/* @Codex WUL-UIUX: campanella rimossa: sembrava un centro notifiche
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
              onClick={() => setArea(a.id)}
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
          <div className={styles.railThemeToggle} aria-label="Tema interfaccia">
            <ThemeToggle />
          </div>
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
          onOpenArea={setArea}
          onSearchRequest={() => {
            setArea('incarico');
            setPatientSearchFocusSignal((current) => current + 1);
          }}
          operatorName={operatorName}
        />
        <div
          className={styles.framePanel}
          data-testid="lume-frame-panel"
          data-lume-frame-element="panel"
        >
          <main
            className={styles.focusSurface}
            data-lume-focus="true"
            data-testid="lume-frame-focus"
            data-lume-frame-element="focus"
          >
            {/* @Codex WUL-UIUX: where-am-i persistente nelle sotto-aree paziente
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
                    onClick={() => setArea(tab.id)}
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
                area={area}
                filter={filter}
                agendaBridge={agendaBridge}
                patientState={patientState}
                agendaState={agendaState}
                diaryState={diaryState}
                selectedPatient={selectedPatient}
                selectedPatientId={selectedPatientId}
                patientWorkspace={patientWorkspace}
                patientSearchFocusSignal={patientSearchFocusSignal}
                isReview={isReview}
                onSelectPatient={setSelectedPatientId}
                onOpenArea={setArea}
              />
            </div>
          </main>
        </div>
      </section>

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
