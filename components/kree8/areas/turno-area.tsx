import { formatCountLabel } from '@/lib/format-count';
import ink from '@/components/ink-secondary.module.css';
import { useMemo } from 'react';
import {
  ChevronRight,
} from 'lucide-react';

import {
  ClinicalAgendaBridgePanel,
  PillBadge,
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
import { agendaFilterMatches } from '@/lib/ui-semantic-signal';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import agendaStyles from './turno-area.module.css';
/* @Codex */
const AI_QUEUE: Kree8DecisionCard[] = [
  {
    title: 'Follow-up suggerito',
    body:
      'Paziente AB-2026-014 · ultima visita 14 mesi fa, profilo cronicità incompleto.',
    pill: 'AI',
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

/* @Codex */
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
}: {
  filter: StatusFilter;
  setFilter: (filter: StatusFilter) => void;
  agendaBridge: ClinicalAgendaBridgeClientState;
  patientState: Kree8PatientClientState;
  agendaState: Kree8AgendaClientState;
  isReview: boolean;
  onSelectPatient: (patientId: string) => void;
  onOpenArea: (area: AreaId) => void;
}) {
  const visibleAgenda = useMemo(() => agendaState.rows.filter(
    (row) => agendaFilterMatches(filter, row.filterCategory),
  ), [agendaState.rows, filter]);
  const todayVisitCount = agendaState.todayCount ?? agendaState.rows.filter((row) => row.pillLabel === 'Oggi').length;
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
            ? 'Agenda non disponibile: resta visibile la lista pazienti.'
            : 'Preparazione degli appuntamenti.',
        pill: agendaState.status === 'error' ? 'Errore' : 'Agenda',
        pillVariant: agendaState.status === 'error' ? 'critical' : 'neutral',
        action: 'Rivedi agenda',
        target: 'turno',
      },
      {
        title: 'Revisione e codifiche',
        body: 'Usa la scheda paziente per rivedere documenti, suggerimenti AI e codifiche prima di applicare aggiornamenti clinici.',
        pill: 'AI',
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

  return (
    <div className={`${styles.areaShell} ${ink.surface} ${agendaStyles.agenda}`}>
      <header className={styles.areaHeader}>
        <div>
          <h1 className={styles.areaTitle}>Agenda<span aria-hidden="true">.</span></h1>
          <p className={styles.areaSubtitle}>
            {formatCountLabel(todayVisitCount, 'appuntamento oggi', 'appuntamenti oggi')}
            {patientState.status === 'ready' ? ` · ${formatCountLabel(patientState.patients.length, 'paziente in carico', 'pazienti in carico')}` : ''}
          </p>
        </div>
      </header>
      <div className={agendaStyles.filters} aria-label="Filtri agenda">{STATUS_FILTERS.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      <section aria-labelledby={AGENDA_HEADING_ID}>
        <h2 id={AGENDA_HEADING_ID} tabIndex={-1} className={agendaStyles.agendaTitle}>Appuntamenti</h2>
        {groups.map((group) => (
          <section key={group.title} className={agendaStyles.group} aria-label={group.title}>
            <h3>{group.title} <span>{group.rows.length}</span></h3>
            <div className={agendaStyles.columns} aria-hidden="true"><span>Ora</span><span>Paziente e controllo</span><span>Stato</span></div>
            {group.rows.map((row) => (
              <div key={row.id} className={agendaStyles.row}>
                <span className={agendaStyles.time}>{row.time}</span>
                <span className={agendaStyles.subject}><strong>{row.title}</strong><span>{row.sub}</span></span>
                <PillBadge variant={row.pill as PillVariant}>{row.pillLabel}</PillBadge>
              </div>
            ))}
          </section>
        ))}
        {visibleAgenda.length === 0 && <p className={styles.emptyState}>
          {agendaState.status === 'ready'
            ? filter === 'all' ? 'Nessun appuntamento in agenda.' : 'Nessun appuntamento con questo filtro.'
            : agendaState.status === 'error' ? 'Agenda non disponibile.' : 'Caricamento appuntamenti…'}
        </p>}
      </section>
      <section className={agendaStyles.external}><ClinicalAgendaBridgePanel bridge={agendaBridge} /></section>
      <section className={agendaStyles.actions} aria-label={isReview ? 'Documenti da revisionare' : 'Da fare oggi'}>
        <h2>{isReview ? 'Documenti da revisionare' : 'Da fare oggi'}</h2>
        {decisionCards.map((card) => <div key={card.title} className={agendaStyles.actionRow}>
          <div><strong>{card.title}</strong><p>{card.body}</p></div>
          <PillBadge variant={card.pillVariant}>{card.pill}</PillBadge>
          <button type="button" className={styles.ghostBtnSm}
            aria-controls={card.target === 'turno' ? AGENDA_HEADING_ID : undefined}
            onClick={() => runDecisionAction(card)}>{card.action}<ChevronRight size={13} /></button>
        </div>)}
      </section>
    </div>
  );
}

export { TurnoArea };
