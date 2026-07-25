import { useMemo } from 'react';
import {
  ArrowUpRight,
  ChevronRight,
} from 'lucide-react';

import {
  ClinicalAgendaBridgePanel,
  PillBadge,
  STATUS_FILTERS,
  classNames,
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


const AI_QUEUE: Kree8DecisionCard[] = [
  {
    title: 'Follow-up suggerito',
    body:
      'Paziente AB-2026-014 · ultima visita 14 mesi fa, profilo cronicità incompleto.',
    pill: 'AI',
    pillVariant: 'plum',
    action: 'Apri quadro',
    target: 'scheda',
  },
  {
    title: 'Codifica mancante',
    body:
      '2 documenti in coda con diagnosi senza ICD. Suggerimento automatico disponibile.',
    pill: 'In coda',
    pillVariant: 'warning',
    action: 'Vai alla revisione',
  },
  {
    title: 'Esenzione in scadenza',
    body:
      'Codice 031 su paziente CD-2026-088 · scade tra 27 giorni. Predisporre rinnovo.',
    pill: 'Attenzione',
    pillVariant: 'warning',
    action: 'Apri esenzioni',
  },
];

/* @Codex */
function formatCountLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function TurnoArea({
  filter,
  agendaBridge,
  patientState,
  agendaState,
  isReview,
  onOpenArea,
}: {
  filter: StatusFilter;
  agendaBridge: ClinicalAgendaBridgeClientState;
  patientState: Kree8PatientClientState;
  agendaState: Kree8AgendaClientState;
  isReview: boolean;
  onOpenArea: (area: AreaId) => void;
}) {
  const visibleAgenda = useMemo(() => {
    return agendaState.rows.filter((row) => agendaFilterMatches(filter, row.filterCategory));
  }, [agendaState.rows, filter]);
  const activePatientCount = patientState.patients.filter((patient) => patient.list === 'attivi').length;
  const patientCountLabel =
    patientState.status === 'loading' || patientState.status === 'idle'
      ? '…'
      : patientState.status === 'error'
        ? '–'
        : String(activePatientCount);
  const patientTrendLabel =
    patientState.status === 'ready'
      ? `${formatCountLabel(patientState.patients.length, 'scheda', 'schede')} in carico`
      : patientState.status === 'error'
        ? 'pazienti non disponibili'
        : 'aggiornamento in corso';
  const todayVisitCount = agendaState.todayCount ?? agendaState.rows.filter((row) => row.pillLabel === 'Oggi').length;
  /* @Codex WUL-UIUX: totale pianificato reale (pre-slice), per non dichiarare
     nella testata solo le max 6 righe mostrate. */
  const plannedVisitCount = agendaState.plannedCount ?? agendaState.rows.length;
  const visitCountLabel =
    agendaState.status === 'loading' || agendaState.status === 'idle'
      ? '…'
      : agendaState.status === 'error'
        ? '–'
        : String(todayVisitCount);
  const visitSubLabel =
    agendaState.status === 'ready'
      ? formatCountLabel(plannedVisitCount, 'passaggio pianificato', 'passaggi pianificati')
      : agendaState.status === 'error'
        ? 'agenda non disponibile'
        : 'aggiornamento agenda';
  const documentCountLabel = isReview ? '24' : '–';
  const documentSubLabel = isReview
    ? '7 con suggerimento AI'
    : 'dettaglio nella sezione Documenti';
  const decisionCountLabel = isReview ? '7' : '–';
  const decisionSubLabel = isReview
    ? '2 oltre SLA'
    : 'priorità dal paziente selezionato';
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

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Oggi</p>
          <h1 className={styles.areaTitle}>
            Agenda di oggi <em>{formatCountLabel(todayVisitCount, 'appuntamento', 'appuntamenti')}</em>
          </h1>
          <p className={styles.areaSubtitle}>
            {patientState.status === 'ready'
              ? 'Rivedi i passaggi della giornata: i filtri in alto ordinano l’agenda per urgenze, suggerimenti AI e passaggi manuali.'
              : 'Preparazione della giornata dopo sblocco PIN.'}
          </p>
        </div>
      </header>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Pazienti attivi</span>
          <span className={styles.statValue}>{patientCountLabel}</span>
          <span className={styles.statTrend}>
            <ArrowUpRight size={12} /> {patientTrendLabel}
          </span>
        </div>
        {/* @Codex WUL-UIUX: in live queste due card restavano fisse a '-' con un
            trend simulato: meglio non mostrarle finche non hanno dati reali. */}
        {isReview ? (
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Documenti in coda</span>
            <span className={styles.statValue}>{documentCountLabel}</span>
            <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
              {documentSubLabel}
            </span>
          </div>
        ) : null}
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Appuntamenti oggi</span>
          <span className={styles.statValue}>{visitCountLabel}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            {visitSubLabel}
          </span>
        </div>
        {isReview ? (
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Suggerimenti da rivedere</span>
            <span className={styles.statValue}>{decisionCountLabel}</span>
            <span className={classNames(styles.statTrend, styles.statTrendDown)}>
              <ArrowUpRight size={12} style={{ transform: 'rotate(90deg)' }} />
              {decisionSubLabel}
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Agenda di oggi</h2>
            <PillBadge variant="neutral">
              {formatCountLabel(visibleAgenda.length, 'evento', 'eventi')}
            </PillBadge>
            {agendaBridge.data?.stats.candidates ? (
              <PillBadge variant="neutral">
                {agendaBridge.data.stats.candidates} esterni
              </PillBadge>
            ) : null}
            <span className={styles.panelActions}>
              <span className={styles.rowSub}>
                filtro: {STATUS_FILTERS.find((f) => f.id === filter)?.label}
              </span>
            </span>
          </header>
          <div>
            {visibleAgenda.map((row) => (
              <div key={row.id} className={styles.row}>
                <span className={styles.rowTime}>{row.time}</span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{row.title}</span>
                  <span className={styles.rowSub}>{row.sub}</span>
                </span>
                <span className={styles.rowEnd}>
                  <PillBadge variant={row.pill as PillVariant}>{row.pillLabel}</PillBadge>
                </span>
              </div>
            ))}
            {visibleAgenda.length === 0 && (
              <p className={styles.emptyState}>
                {/* @Codex WUL-UIUX: distingue l'agenda davvero vuota dal filtro
                    specifico che non trova appuntamenti. */}
                {agendaState.status === 'ready'
                  ? filter === 'all'
                    ? 'Nessun appuntamento in agenda.'
                    : 'Nessun appuntamento con questo filtro.'
                  : agendaState.status === 'error'
                    ? 'Agenda non disponibile.'
                    : 'Caricamento appuntamenti…'}
              </p>
            )}
          </div>
          <ClinicalAgendaBridgePanel bridge={agendaBridge} />
        </section>

        <section className={styles.panelInset}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              {isReview ? 'Documenti da revisionare' : 'Da fare oggi'}
            </h2>
            {isReview ? <PillBadge variant="warning">7 casi</PillBadge> : null}
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {decisionCards.map((card) => (
              <div key={card.title} className={styles.compositeCard}>
                <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={styles.evidenceTitle}>{card.title}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <PillBadge variant={card.pillVariant}>
                      {card.pill}
                    </PillBadge>
                  </span>
                </header>
                <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.55 }}>
                  {card.body}
                </p>
                <button
                  type="button"
                  className={styles.ghostBtnSm}
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => {
                    if (card.target) onOpenArea(card.target);
                  }}
                >
                  {card.action}
                  <ChevronRight size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export { TurnoArea };
