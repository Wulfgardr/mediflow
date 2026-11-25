import { formatCountLabel } from '@/lib/format-count';
import surface from '@/components/record-surface.module.css';
import { useMemo, type ReactNode } from 'react';
import {
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  ChevronRight,
} from 'lucide-react';

import {
  ClinicalAgendaBridgePanel,
  STATUS_FILTERS,
} from '../cockpit-shared';
import type {
  AreaId,
  ClinicalAgendaBridgeClientState,
  Kree8AgendaClientState,
  Kree8DecisionCard,
  Kree8PatientClientState,
  StatusFilter,
} from '../cockpit-shared';
import type { PillVariant } from '@/lib/patient-workspace';
import { agendaFilterMatches, resolveSemanticSignal, type SemanticSignal } from '@/lib/ui-semantic-signal';
import { ViewState } from '@/components/ui/view-state';
import agendaStyles from './turno-area.module.css';

const SIGNAL_PILL: Record<SemanticSignal, string> = {
  neutral: surface.pillNeutral,
  success: surface.pillSuccess,
  warning: surface.pillWarning,
  critical: surface.pillCritical,
  plum: surface.pillProposal,
};
const AI_QUEUE: Kree8DecisionCard[] = [
  {
    title: 'Follow-up suggerito',
    body:
      'Paziente AB-2026-014 · ultima visita 14 mesi fa, profilo cronicità incompleto.',
    pill: 'IA',
    pillVariant: 'plum',
    action: 'Apri quadro',
    target: 'scheda',
    patientId: 'p1',
  },
  {
    title: 'Codifica mancante',
    body:
      '2 documenti in coda con diagnosi senza ICD. Suggerimento automatico disponibile.',
    pill: 'In coda',
    pillVariant: 'warning',
    action: 'Apri documenti',
    target: 'revisione',
  },
  {
    title: 'Esenzione in scadenza',
    body:
      'Codice 031 su paziente CD-2026-088 · scade tra 27 giorni. Predisporre rinnovo.',
    pill: 'Attenzione',
    pillVariant: 'warning',
    action: 'Apri paziente',
    target: 'incarico',
    patientId: 'p2',
  },
];

const AGENDA_HEADING_ID = 'turno-agenda-heading';

function TurnoArea({
  filter,
  setFilter,
  agendaBridge,
  patientState,
  agendaState,
  isReview,
  onSelectPatient,
  onOpenArea,
  onRetry,
  commandTrigger,
}: {
  filter: StatusFilter;
  setFilter: (filter: StatusFilter) => void;
  agendaBridge: ClinicalAgendaBridgeClientState;
  patientState: Kree8PatientClientState;
  agendaState: Kree8AgendaClientState;
  isReview: boolean;
  onSelectPatient: (patientId: string) => void;
  onOpenArea: (area: AreaId) => void;
  onRetry: () => void;
  commandTrigger?: ReactNode;
}) {
  const visibleAgenda = useMemo(() => agendaState.rows.filter(
    (row) => agendaFilterMatches(filter, row.filterCategory),
  ), [agendaState.rows, filter]);
  const todayVisitCount = agendaState.todayCount ?? agendaState.rows.filter((row) => row.pillLabel === 'Oggi').length;
  const pending = agendaState.status === 'idle' || agendaState.status === 'loading';
  const hasSnapshot = agendaState.hasSnapshot ?? agendaState.status === 'ready';
  const groups = [
    { title: 'Scaduti', rows: visibleAgenda.filter((row) => row.pillLabel === 'Scaduto') },
    { title: 'Oggi', rows: visibleAgenda.filter((row) => row.pillLabel === 'Oggi') },
    { title: 'Prossimi', rows: visibleAgenda.filter((row) => !['Oggi', 'Scaduto'].includes(row.pillLabel)) },
  ].filter((group) => group.rows.length > 0);
  const decisionCards: Kree8DecisionCard[] = isReview
    ? AI_QUEUE
    : [
      {
        title: 'Pazienti in carico',
        body: patientState.status === 'ready'
          ? `${formatCountLabel(patientState.patients.length, 'scheda pronta', 'schede pronte')} nell’archivio locale.`
          : patientState.status === 'error'
            ? 'Impossibile aggiornare i dati dei pazienti per l’agenda.'
            : 'Preparazione della lista pazienti.',
        pill: patientState.status === 'error' ? 'Errore' : 'In carico',
        pillVariant: patientState.status === 'error' ? 'critical' : 'neutral',
        action: 'Vai ai pazienti',
        target: 'incarico',
      },
      {
        title: 'Agenda clinica',
        body: agendaState.status === 'ready'
          ? 'Passaggi locali e candidati esterni della giornata, da rivedere prima delle visite.'
          : agendaState.status === 'error'
            ? patientState.status === 'ready' ? 'Agenda non disponibile: resta visibile la lista pazienti.' : 'Agenda non disponibile.'
            : 'Preparazione degli appuntamenti.',
        pill: agendaState.status === 'error' ? 'Errore' : 'Agenda',
        pillVariant: agendaState.status === 'error' ? 'critical' : 'neutral',
        action: 'Rivedi agenda',
        target: 'turno',
      },
      {
        title: 'Revisione e codifiche',
        body: 'Usa la scheda paziente per rivedere documenti, suggerimenti IA e codifiche prima di applicare aggiornamenti clinici.',
        pill: 'IA',
        pillVariant: 'plum',
        action: 'Apri revisione',
        target: 'revisione',
      },
    ];

  const runDecisionAction = (card: Kree8DecisionCard) => {
    if (card.patientId) onSelectPatient(card.patientId);
    if (card.target === 'turno') {
      document.getElementById(AGENDA_HEADING_ID)?.focus();
      return;
    }
    onOpenArea(card.target);
  };

  const showBridge = agendaBridge.status !== 'ready' || Boolean(agendaBridge.data?.enabled);

  return (
    <div className={`${surface.page} ${agendaStyles.agenda}`} data-record-page data-testid="agenda-area">
      <header className={surface.pageHeader}>
        <div className={surface.pageHeading}>
          <h1 className={surface.pageTitle}>Agenda</h1>
          <p className={surface.pageMeta}>
            {hasSnapshot ? formatCountLabel(todayVisitCount, 'appuntamento oggi', 'appuntamenti oggi') : '…'}
            {patientState.status === 'ready' ? ` · ${formatCountLabel(patientState.patients.length, 'paziente in carico', 'pazienti in carico')}` : ''}
          </p>
        </div>
        <div className={surface.pageActions}>
          {!isReview && agendaState.canRefresh && agendaState.status !== 'error' && <button type="button" className="mf-button-secondary" disabled={pending} onClick={onRetry}>Aggiorna</button>}
          {commandTrigger}
        </div>
      </header>
      <div className={surface.segmented} role="group" aria-label="Filtri agenda">{STATUS_FILTERS.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      <div className={agendaStyles.trays}>
        <section className={surface.tray} data-record-tray="appuntamenti" aria-labelledby={AGENDA_HEADING_ID} aria-busy={pending}>
          <h2 id={AGENDA_HEADING_ID} tabIndex={-1} className={surface.zoneTitle}>Appuntamenti</h2>
          {showBridge ? <div className={`${surface.islandProposal} ${agendaStyles.bridge}`}><ClinicalAgendaBridgePanel bridge={agendaBridge} /></div> : null}
          {pending && <ViewState state="loading" title="Caricamento appuntamenti…"
            detail={hasSnapshot ? 'Aggiornamento dell’agenda in corso. Sono mostrati gli ultimi appuntamenti letti.' : undefined} />}
          {agendaState.status === 'error' && <ViewState state="error" title="Agenda non disponibile."
            detail={[hasSnapshot ? 'Impossibile aggiornare l’agenda. Sono mostrati gli ultimi appuntamenti letti.' : '',
              agendaState.patientsUnavailable ? 'Impossibile aggiornare i dati dei pazienti per l’agenda.' : ''].filter(Boolean).join(' ') || undefined}
            action={{ label: 'Riprova', onClick: onRetry }} />}
          {groups.map((group) => (
            <section key={group.title} className={surface.island} aria-label={group.title}>
              <div className={surface.islandHeader}>
                <span className={surface.islandIcon} aria-hidden="true">{group.title === 'Scaduti' ? <CalendarX2 size={15} /> : group.title === 'Oggi' ? <CalendarCheck2 size={15} /> : <CalendarClock size={15} />}</span>
                <h3>{group.title} <span>{group.rows.length}</span></h3>
              </div>
              <ul className={agendaStyles.rows}>
                {group.rows.map((row) => (
                  <li key={row.id} className={agendaStyles.row}>
                    <span className={agendaStyles.time}>{row.time}</span>
                    <span className={agendaStyles.subject}><strong>{row.title}</strong><span>{row.sub}</span></span>
                    <span className={SIGNAL_PILL[resolveSemanticSignal(row.pill as PillVariant)]}>{row.pillLabel}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {agendaState.status === 'ready' && visibleAgenda.length === 0 && <ViewState state="empty"
            title={filter === 'all' ? 'Nessun appuntamento in agenda.' : 'Nessun appuntamento con questo filtro.'} />}
        </section>
        <section className={surface.tray} data-record-tray="da-fare" aria-labelledby="turno-da-fare-heading">
          <h2 id="turno-da-fare-heading" className={surface.zoneTitle}>{isReview ? 'Documenti da revisionare' : 'Da fare oggi'}</h2>
          <div className={surface.island}>
            <ul className={agendaStyles.actions}>
              {decisionCards.map((card) => <li key={card.title} className={agendaStyles.actionRow}>
                <div className={agendaStyles.actionText}>
                  <strong>{card.title}</strong>
                  <span className={SIGNAL_PILL[resolveSemanticSignal(card.pillVariant)]}>{card.pill}</span>
                  <p>{card.body}</p>
                </div>
                <button type="button" className={agendaStyles.actionLink}
                  aria-controls={card.target === 'turno' ? AGENDA_HEADING_ID : undefined}
                  onClick={() => runDecisionAction(card)}>{card.action}<ChevronRight size={14} aria-hidden="true" /></button>
              </li>)}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

export { TurnoArea };
