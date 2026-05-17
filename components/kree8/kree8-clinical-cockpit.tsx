'use client';

/* @Codex */
/* WUL-272 live Kree8-inspired MediFlow cockpit.
   Renders as the root local web entry in live mode and remains available under
   /mockups/kree8 as a review alias. All data is synthetic in this first visual
   promotion; no PHI, no remote assets, no new npm dependencies. */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Bell,
  CalendarClock,
  Check,
  ChevronRight,
  Cloud,
  Database,
  Edit3,
  FileSearch,
  FileSignature,
  FileText,
  Filter,
  HardDrive,
  Inbox,
  KeyRound,
  ListChecks,
  MapPin,
  Minus,
  Paperclip,
  Pill as PillIcon,
  Plus,
  RefreshCcw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Upload,
  UserSquare2,
  Users,
  Workflow,
  X,
} from 'lucide-react';

import styles from './kree8-clinical-cockpit.module.css';

type AreaId =
  | 'turno'
  | 'incarico'
  | 'scheda'
  | 'revisione'
  | 'cataloghi'
  | 'handoff'
  | 'governance';
type DocDecision = 'pending' | 'apply' | 'note' | 'ignore';
type StageId = 'identity' | 'consent' | 'handoff' | 'outcome';
type StatusFilter = 'all' | 'urgent' | 'ai' | 'manual';
type InboxScope = 'ambulatorio' | 'network' | 'tutti';
type InboxList = 'attivi' | 'archivio';

type ClinicalAgendaBridgeStatus = 'idle' | 'loading' | 'ready' | 'error';

type ClinicalAgendaCandidatePreview = {
  id: string;
  title: string;
  startIso: string;
  endIso?: string;
  location?: string;
  sourceLabel: string;
  score: number;
  reasons: string[];
  reviewState: 'candidate';
};

type ClinicalAgendaBridgePreview = {
  enabled: boolean;
  stats: {
    candidates: number;
    parsed: number;
    ignored: number;
    invalid: number;
  };
  sourceStatuses?: {
    sourceLabel: string;
    status: 'ready' | 'missing' | 'unreadable';
    parsed: number;
    candidates: number;
  }[];
  candidates: ClinicalAgendaCandidatePreview[];
};

type ClinicalAgendaBridgeClientState = {
  status: ClinicalAgendaBridgeStatus;
  data?: ClinicalAgendaBridgePreview;
};

const AREAS: { id: AreaId; label: string; icon: typeof Inbox; meta?: string }[] = [
  { id: 'turno', label: 'Turno clinico', icon: CalendarClock },
  { id: 'incarico', label: 'Pazienti / incarico', icon: Inbox, meta: '312' },
  { id: 'scheda', label: 'Scheda paziente', icon: UserSquare2 },
  { id: 'revisione', label: 'Revisione documenti', icon: FileSearch, meta: '24' },
  { id: 'cataloghi', label: 'Cataloghi locali', icon: Database },
  { id: 'handoff', label: 'Handoff regionale', icon: Workflow },
  { id: 'governance', label: 'Governance locale', icon: SettingsIcon },
];

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'Tutti' },
  { id: 'urgent', label: 'Urgenti' },
  { id: 'ai', label: 'AI' },
  { id: 'manual', label: 'Manuali' },
];

const STAGES: { id: StageId; index: number; label: string; title: string }[] = [
  { id: 'identity', index: 1, label: 'Stage 1', title: 'Identità & ruolo' },
  { id: 'consent', index: 2, label: 'Stage 2', title: 'Consenso assistito' },
  { id: 'handoff', index: 3, label: 'Stage 3', title: 'Handoff webapp' },
  { id: 'outcome', index: 4, label: 'Stage 4', title: 'Esito registrato' },
];

const STAGE_ORDER: StageId[] = ['identity', 'consent', 'handoff', 'outcome'];

type FieldKind = 'structured' | 'note' | 'blocked';

const DOC_FIELDS: {
  id: string;
  label: string;
  value: string;
  kind: FieldKind;
  evidence: string;
  sourceHint: string;
  blockedReason?: string;
}[] = [
  {
    id: 'diagnosis',
    label: 'Diagnosi clinica',
    value: 'Ipertensione essenziale non specificata',
    kind: 'structured',
    evidence:
      '«Paziente con anamnesi positiva per ipertensione essenziale in trattamento con Ramipril 5 mg.» — pag. 1, paragrafo 2',
    sourceHint: 'confidence 0.91 · qwen3.5 locale',
  },
  {
    id: 'icd',
    label: 'Codifica ICD-10',
    value: 'I10',
    kind: 'structured',
    evidence: 'Mappata da diagnosi clinica · catalogo ICD-10 IT v2026.01 (locale).',
    sourceHint: 'mapping deterministico · nessun fetch remoto',
  },
  {
    id: 'drug',
    label: 'Farmaco prescritto',
    value: 'Ramipril 5 mg',
    kind: 'structured',
    evidence:
      '«…in trattamento con Ramipril 5 mg 1 cpr/die.» — pag. 1, paragrafo 2',
    sourceHint: 'risolto via AIFA · AIC 029402017',
  },
  {
    id: 'posology',
    label: 'Posologia',
    value: '1 cpr · 1 volta/die · per 90 giorni',
    kind: 'note',
    evidence:
      '«Si conferma prosecuzione terapia per 90 giorni.» — pag. 2, paragrafo 1',
    sourceHint: 'pattern verbale non strutturato · annotabile come nota',
  },
  {
    id: 'exemption',
    label: 'Esenzione applicabile',
    value: '031 — Ipertensione arteriosa',
    kind: 'note',
    evidence:
      '«Esenzione applicabile 031 — previa verifica del medico curante.» — pag. 2, paragrafo 2',
    sourceHint: 'inferita · richiede conferma operatore',
  },
  {
    id: 'siss',
    label: 'Trasmissione SISS automatica',
    value: '—',
    kind: 'blocked',
    evidence: '—',
    sourceHint: '',
    blockedReason:
      'Nessun canale A2A SISS certificato. Solo handoff portale ufficiale + registrazione manuale dell’esito.',
  },
];

const CATALOGS: {
  id: string;
  name: string;
  sub: string;
  freshness: 'fresh' | 'ok' | 'stale' | 'broken' | 'off';
  age: string;
}[] = [
  {
    id: 'aifa-pt',
    name: 'AIFA · Piani Terapeutici',
    sub: 'PT regionale + condizioni speciali',
    freshness: 'fresh',
    age: '12 g fa',
  },
  {
    id: 'aic',
    name: 'AIFA · AIC farmaci',
    sub: 'manifest v7 di 24 disponibili',
    freshness: 'ok',
    age: '3 g fa',
  },
  {
    id: 'exemptions',
    name: 'Esenzioni · regionali',
    sub: 'piano cronicità + reddito',
    freshness: 'stale',
    age: '41 g fa',
  },
  {
    id: 'icd',
    name: 'ICD-11 IT',
    sub: 'release ministeriale 2026',
    freshness: 'fresh',
    age: '7 g fa',
  },
  {
    id: 'loinc',
    name: 'LOINC IT',
    sub: 'import manuale richiesto',
    freshness: 'broken',
    age: 'mai',
  },
  {
    id: 'rxnorm',
    name: 'RxNORM map',
    sub: 'non abilitato in questa shell',
    freshness: 'off',
    age: '—',
  },
];

const AGENDA = [
  {
    time: '08:30',
    title: 'Visita ambulatoriale · paziente AB-2026-014',
    sub: 'Controllo cronicità',
    pill: 'green',
    pillLabel: 'Confermata',
  },
  {
    time: '09:15',
    title: 'Telefonata follow-up · paziente CD-2026-088',
    sub: 'Esito esami ematochimici',
    pill: 'blue',
    pillLabel: 'Da preparare',
  },
  {
    time: '10:00',
    title: 'Domiciliare · paziente EF-2026-002',
    sub: 'Medicazione + vitali',
    pill: 'yellow',
    pillLabel: 'Logistica',
  },
  {
    time: '11:30',
    title: 'Riunione équipe distretto',
    sub: 'Discussione casi complessi',
    pill: 'muted',
    pillLabel: 'Interno',
  },
  {
    time: '15:00',
    title: 'Revisione documenti firmati',
    sub: 'Coda decisioni AI · 7 casi',
    pill: 'violet',
    pillLabel: 'AI',
  },
  {
    time: '17:45',
    title: 'Handoff SISS prescrittivo',
    sub: 'Sessione consenso scaduta tra 6g',
    pill: 'coral',
    pillLabel: 'Attenzione',
  },
];

const AI_QUEUE = [
  {
    title: 'Follow-up suggerito',
    body:
      'Paziente AB-2026-014 · ultima visita 14 mesi fa, profilo cronicità incompleto.',
    pill: 'AI',
    pillVariant: 'violet',
    action: 'Apri scheda',
  },
  {
    title: 'Codifica mancante',
    body:
      '2 documenti in coda con diagnosi senza ICD. Suggerimento automatico disponibile.',
    pill: 'In coda',
    pillVariant: 'blue',
    action: 'Vai alla revisione',
  },
  {
    title: 'Esenzione in scadenza',
    body:
      'Codice 031 su paziente CD-2026-088 · scade tra 27 giorni. Predisporre rinnovo.',
    pill: 'Attenzione',
    pillVariant: 'coral',
    action: 'Apri esenzioni',
  },
];

const PATIENT_AI_SUMMARY = (
  <>
    Paziente <b>M. R.</b>, 64 anni, profilo a cronicità multipla
    (<b>ipertensione</b>, <b>dislipidemia</b>, <b>BPCO lieve</b>). Aderenza
    terapeutica buona negli ultimi 90 giorni; vitali nella norma all&apos;ultima
    rilevazione. <b>Possibile rinforzo</b> sul follow-up cardiologico previsto
    a 6 mesi. <b>Manca codifica ICD</b> su ultimo documento allegato; codice
    suggerito <b>I10</b>.
  </>
);

const PATIENT_SOURCES = [
  { date: '08 mag 2026', text: 'Diario · controllo pressorio domiciliare 130/82 mmHg, paziente asintomatico.' },
  { date: '02 mag 2026', text: 'Documento · referto cardiologico Cardiologia ASL · esame Holter nella norma.' },
  { date: '21 apr 2026', text: 'Terapia · rinnovo Ramipril 5 mg · piano 90 giorni.' },
  { date: '04 apr 2026', text: 'Visita · obiettività cardiopolmonare nei limiti. Programmato follow-up.' },
];

const PATIENT_LIST: {
  id: string;
  name: string;
  code: string;
  scope: 'ambulatorio' | 'network';
  list: InboxList;
  status: 'green' | 'blue' | 'muted';
  statusLabel: string;
  diagnoses: string[];
  lastTouch: string;
  pathway: string;
}[] = [
  {
    id: 'p1',
    name: 'M. R.',
    code: 'AB-2026-014',
    scope: 'ambulatorio',
    list: 'attivi',
    status: 'green',
    statusLabel: 'Cronicità',
    diagnoses: ['Ipertensione', 'Dislipidemia', 'BPCO lieve'],
    lastTouch: '08 mag · Diario',
    pathway: 'Ambulatorio locale',
  },
  {
    id: 'p2',
    name: 'C. D.',
    code: 'CD-2026-088',
    scope: 'ambulatorio',
    list: 'attivi',
    status: 'blue',
    statusLabel: 'Follow-up',
    diagnoses: ['Esenzione 031', 'Diabete tipo 2'],
    lastTouch: '07 mag · Documento',
    pathway: 'Ambulatorio locale',
  },
  {
    id: 'p3',
    name: 'E. F.',
    code: 'EF-2026-002',
    scope: 'network',
    list: 'attivi',
    status: 'green',
    statusLabel: 'Territorio attivo',
    diagnoses: ['ADI · medicazione', 'Vitali instabili'],
    lastTouch: '06 mag · Visita domic.',
    pathway: 'Network paired',
  },
  {
    id: 'p4',
    name: 'G. H.',
    code: 'GH-2025-921',
    scope: 'ambulatorio',
    list: 'archivio',
    status: 'muted',
    statusLabel: 'Archiviato',
    diagnoses: ['Storico clinico', 'Percorso chiuso'],
    lastTouch: '12 ott 2025',
    pathway: 'Ambulatorio locale',
  },
  {
    id: 'p5',
    name: 'I. L.',
    code: 'IL-2026-047',
    scope: 'ambulatorio',
    list: 'attivi',
    status: 'blue',
    statusLabel: 'Smart Import in revisione',
    diagnoses: ['Nuova anagrafica', 'Documento in coda'],
    lastTouch: '08 mag · Smart Import',
    pathway: 'Ambulatorio locale',
  },
];

function classNames(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type PillVariant = 'blue' | 'yellow' | 'green' | 'coral' | 'muted' | 'violet' | 'ink';

const PILL_VARIANT_CLASS: Record<PillVariant, string> = {
  blue: styles.pillBlue,
  yellow: styles.pillYellow,
  green: styles.pillGreen,
  coral: styles.pillCoral,
  muted: styles.pillMuted,
  violet: styles.pillViolet,
  ink: styles.pillInk,
};

function PillBadge({
  variant,
  children,
  commitKey,
}: {
  variant: PillVariant;
  children: React.ReactNode;
  commitKey?: string;
}) {
  return (
    <span
      key={commitKey}
      className={classNames(
        styles.pill,
        PILL_VARIANT_CLASS[variant],
        commitKey && styles.pillCommit,
      )}
    >
      {children}
    </span>
  );
}

function Toolbar({
  filter,
  setFilter,
}: {
  filter: StatusFilter;
  setFilter: (id: StatusFilter) => void;
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.search}>
        <Search size={14} />
        <span>Cerca paziente, ICD, esenzione, documento…</span>
        <kbd>⌘K</kbd>
      </div>
      {STATUS_FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={filter === f.id}
          className={classNames(
            styles.toolChip,
            filter !== f.id && styles.toolChipMuted,
          )}
          onClick={() => setFilter(f.id)}
        >
          <Filter size={12} />
          {f.label}
        </button>
      ))}
      <button type="button" className={styles.toolChip}>
        <Upload size={13} />
        Carica
      </button>
      <button type="button" className={styles.aiButton}>
        <Sparkles size={13} />
        Chiedi a MediFlow
      </button>
      <span className={styles.avatarPill}>
        <span className={styles.avatarDot}>LP</span>
        Dr. L.P.
      </span>
    </div>
  );
}

/* ───────────────────────── Turno clinico ───────────────────────── */

function formatCandidateTime(startIso: string): string {
  const date = new Date(startIso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function summarizeAgendaBridgeSources(data?: ClinicalAgendaBridgePreview): string {
  if (!data?.sourceStatuses?.length) return '';

  return data.sourceStatuses
    .map((source) => {
      if (source.status === 'ready') {
        return `${source.sourceLabel}: ${source.parsed} letti`;
      }
      if (source.status === 'missing') {
        return `${source.sourceLabel}: cache assente`;
      }
      return `${source.sourceLabel}: non leggibile`;
    })
    .join(' · ');
}

function ClinicalAgendaBridgePanel({
  bridge,
}: {
  bridge: ClinicalAgendaBridgeClientState;
}) {
  const candidates = bridge.data?.candidates ?? [];
  const sourceSummary = summarizeAgendaBridgeSources(bridge.data);

  if (bridge.status === 'loading' || bridge.status === 'idle') {
    return (
      <div className={styles.agendaBridge}>
        <div className={styles.agendaBridgeHeader}>
          <Cloud size={13} />
          <span>Bridge Zimbra/iCloud</span>
          <PillBadge variant="muted">lettura locale</PillBadge>
        </div>
        <p className={styles.agendaBridgeCopy}>
          Sto cercando solo segnali clinici o FBF gia presenti nelle cache locali.
        </p>
      </div>
    );
  }

  if (bridge.status === 'error') {
    return (
      <div className={styles.agendaBridge}>
        <div className={styles.agendaBridgeHeader}>
          <AlertTriangle size={13} />
          <span>Bridge Zimbra/iCloud</span>
          <PillBadge variant="coral">non disponibile</PillBadge>
        </div>
        <p className={styles.agendaBridgeCopy}>
          Nessun dato acquisito. La cockpit resta sulla agenda confermata.
        </p>
      </div>
    );
  }

  if (!bridge.data?.enabled) {
    return (
      <div className={styles.agendaBridge}>
        <div className={styles.agendaBridgeHeader}>
          <Cloud size={13} />
          <span>Bridge Zimbra/iCloud</span>
          <PillBadge variant="muted">cache assente</PillBadge>
        </div>
        <p className={styles.agendaBridgeCopy}>
          Pronto per leggere le cache evento del mail assistant, senza importare
          calendario personale o posta.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.agendaBridge}>
      <div className={styles.agendaBridgeHeader}>
        <Cloud size={13} />
        <span>Bridge Zimbra/iCloud</span>
        <PillBadge variant={candidates.length > 0 ? 'blue' : 'muted'}>
          {bridge.data.stats.candidates} candidati
        </PillBadge>
      </div>

      {candidates.length === 0 ? (
        <p className={styles.agendaBridgeCopy}>
          Nessun segnale clinico/FBF nella finestra locale. Nulla viene importato.
          {sourceSummary ? <span> {sourceSummary}.</span> : null}
        </p>
      ) : (
        <div className={styles.agendaCandidateList}>
          {candidates.slice(0, 3).map((candidate) => (
            <div key={candidate.id} className={styles.agendaCandidateRow}>
              <span className={styles.agendaCandidateTime}>
                {formatCandidateTime(candidate.startIso)}
              </span>
              <span className={styles.agendaCandidateMain}>
                <span className={styles.agendaCandidateTitle}>
                  {candidate.title}
                </span>
                <span className={styles.agendaCandidateMeta}>
                  {candidate.sourceLabel}
                  {candidate.location ? ` · ${candidate.location}` : ''}
                </span>
                <span className={styles.agendaCandidateReason}>
                  {candidate.reasons.slice(0, 2).join(' · ')}
                </span>
              </span>
              <span className={styles.agendaCandidateEnd}>
                <PillBadge variant="yellow">review</PillBadge>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TurnoArea({
  filter,
  agendaBridge,
}: {
  filter: StatusFilter;
  agendaBridge: ClinicalAgendaBridgeClientState;
}) {
  const visibleAgenda = useMemo(() => {
    if (filter === 'all') return AGENDA;
    if (filter === 'urgent') return AGENDA.filter((r) => r.pill === 'coral' || r.pill === 'yellow');
    if (filter === 'ai') return AGENDA.filter((r) => r.pill === 'violet');
    return AGENDA.filter((r) => r.pill === 'green' || r.pill === 'blue' || r.pill === 'muted');
  }, [filter]);

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Turno clinico · ambulatorio locale</p>
          <h1 className={styles.areaTitle}>
            Buongiorno, Dr. L.P. <em>oggi, 6 turni governati.</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Sintetizzati 240 documenti questa settimana · margin AI &lt; 3% ·
            ultimo backup locale 02:14.
          </p>
        </div>
      </header>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Pazienti attivi</span>
          <span className={styles.statValue}>312</span>
          <span className={styles.statTrend}>
            <ArrowUpRight size={12} /> +4 questa settimana
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Documenti in coda</span>
          <span className={styles.statValue}>24</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            7 con suggerimento AI
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Visite oggi</span>
          <span className={styles.statValue}>18</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            3 domiciliari · 15 ambulatoriali
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Decisioni AI in attesa</span>
          <span className={styles.statValue}>7</span>
          <span className={classNames(styles.statTrend, styles.statTrendDown)}>
            <ArrowUpRight size={12} style={{ transform: 'rotate(90deg)' }} />
            2 oltre SLA
          </span>
        </div>
      </div>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Agenda clinica di oggi</h2>
            <PillBadge variant="muted">{visibleAgenda.length} eventi</PillBadge>
            {agendaBridge.data?.stats.candidates ? (
              <PillBadge variant="blue">
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
              <div key={row.time + row.title} className={styles.row}>
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
              <p className={styles.rowSub} style={{ padding: '24px 0' }}>
                Nessun evento per il filtro selezionato.
              </p>
            )}
          </div>
          <ClinicalAgendaBridgePanel bridge={agendaBridge} />
        </section>

        <section className={styles.panelInset}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Coda decisionale review</h2>
            <PillBadge variant="violet">7 casi</PillBadge>
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {AI_QUEUE.map((card) => (
              <div key={card.title} className={styles.compositeCard}>
                <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={styles.evidenceTitle}>{card.title}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <PillBadge variant={card.pillVariant as PillVariant}>
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

/* ───────────────────────── Pazienti / incarico ───────────────────────── */

function IncaricoArea({ onOpenScheda }: { onOpenScheda: () => void }) {
  const [scope, setScope] = useState<InboxScope>('ambulatorio');
  const [list, setList] = useState<InboxList>('attivi');
  const [selectedId, setSelectedId] = useState<string>('p1');

  const visible = useMemo(
    () =>
      PATIENT_LIST.filter((p) => {
        if (list === 'attivi' && p.list !== 'attivi') return false;
        if (list === 'archivio' && p.list !== 'archivio') return false;
        if (scope === 'tutti') return true;
        if (scope === 'ambulatorio') return p.scope === 'ambulatorio';
        return p.scope === 'network';
      }),
    [scope, list],
  );

  const selected = PATIENT_LIST.find((p) => p.id === selectedId) ?? visible[0] ?? PATIENT_LIST[0];

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Pazienti · incarico clinico</p>
          <h1 className={styles.areaTitle}>
            Inbox pazienti <em>· flusso clinico governato</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Scope ambulatoriale, network paired o intero distretto · selezione
            singola con anteprima Case Lens.
          </p>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={styles.inboxScope}>
          <button
            type="button"
            className={classNames(styles.scopeChip, scope === 'ambulatorio' && styles.scopeChipActive)}
            onClick={() => setScope('ambulatorio')}
          >
            <MapPin size={12} />
            Ambulatorio locale
          </button>
          <button
            type="button"
            className={classNames(styles.scopeChip, scope === 'network' && styles.scopeChipActive)}
            onClick={() => setScope('network')}
          >
            <Cloud size={12} />
            Network paired
          </button>
          <button
            type="button"
            className={classNames(styles.scopeChip, scope === 'tutti' && styles.scopeChipActive)}
            onClick={() => setScope('tutti')}
          >
            <Users size={12} />
            Tutti gli ambulatori
          </button>

          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button
              type="button"
              className={classNames(styles.scopeChip, list === 'attivi' && styles.scopeChipActive)}
              onClick={() => setList('attivi')}
            >
              <Activity size={12} />
              Attivi
            </button>
            <button
              type="button"
              className={classNames(styles.scopeChip, list === 'archivio' && styles.scopeChipActive)}
              onClick={() => setList('archivio')}
            >
              <Archive size={12} />
              Archivio
            </button>
          </span>
        </div>
      </section>

      <div className={styles.inboxLayout}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              {list === 'attivi' ? 'Pazienti in carico' : 'Archivio pazienti'}
            </h2>
            <PillBadge variant="muted">{visible.length} risultati</PillBadge>
            <span className={styles.panelActions}>
              <button type="button" className={styles.ghostBtnSm}>
                <Plus size={12} />
                Nuova anagrafica
              </button>
            </span>
          </header>

          <div style={{ marginTop: 8 }}>
            {visible.length === 0 && (
              <p className={styles.rowSub} style={{ padding: '24px 0' }}>
                Nessun paziente nell&apos;ambito selezionato.
              </p>
            )}
            {visible.map((p) => {
              const isSelected = p.id === selected.id;
              const dotClass =
                p.status === 'green'
                  ? styles.patientDotGreen
                  : p.status === 'blue'
                    ? styles.patientDotBlue
                    : styles.patientDotMuted;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={classNames(
                    styles.patientRow,
                    isSelected && styles.patientRowSelected,
                  )}
                  onClick={() => setSelectedId(p.id)}
                  aria-pressed={isSelected}
                >
                  <span className={classNames(styles.patientDot, dotClass)} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span className={styles.patientName}>{p.name}</span>
                    <span className={styles.patientCode}>{p.code} · {p.pathway}</span>
                  </span>
                  <span className={styles.patientMeta}>
                    {p.diagnoses.map((d) => (
                      <PillBadge key={d} variant="muted">{d}</PillBadge>
                    ))}
                  </span>
                  <span className={styles.rowSub}>{p.lastTouch}</span>
                  <span style={{ display: 'inline-flex', justifyContent: 'flex-end' }}>
                    <PillBadge
                      variant={p.status === 'muted' ? 'muted' : p.status === 'blue' ? 'blue' : 'green'}
                    >
                      {p.statusLabel}
                    </PillBadge>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className={styles.caseLens} key={selected.id}>
          <span className={styles.areaCaption}>Case Lens · anteprima</span>
          <div className={styles.caseLensHero}>
            <span className={styles.caseLensName}>{selected.name}</span>
            <span className={styles.caseLensSub}>
              {selected.code} · {selected.pathway} · ultimo evento {selected.lastTouch}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selected.diagnoses.map((d) => (
              <PillBadge key={d} variant="blue">{d}</PillBadge>
            ))}
            <PillBadge
              variant={selected.status === 'muted' ? 'muted' : selected.status === 'blue' ? 'blue' : 'green'}
            >
              {selected.statusLabel}
            </PillBadge>
          </div>
          <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.6 }}>
            {selected.list === 'archivio'
              ? 'Percorso chiuso, consultabile come storico clinico. Nessuna azione di scrittura.'
              : 'Profilo a cronicità multipla · aderenza terapeutica buona · vitali ultima rilevazione nella norma.'}
          </p>
          <div className={styles.caseLensActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={onOpenScheda}
              disabled={selected.list === 'archivio'}
            >
              <UserSquare2 size={13} />
              Apri scheda
            </button>
            <button type="button" className={styles.ghostBtnSm}>
              <FileText size={12} />
              Allega documento
            </button>
            <button type="button" className={styles.ghostBtnSm}>
              <Workflow size={12} />
              Prepara handoff SISS
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ───────────────────────── Scheda paziente ───────────────────────── */

function SchedaArea() {
  const [view, setView] = useState<'ai' | 'source'>('ai');

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Scheda paziente · cronicità multipla</p>
          <h1 className={styles.areaTitle}>
            M. R. <em>· 64 · M · codice fittizio AB-2026-014</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Profilo aggiornato il 08 mag · ultimo documento 02 mag · ultima
            sincronizzazione home-base 5 min fa.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostBtnSm}>
            <Plus size={12} /> Nuova voce diario
          </button>
          <button type="button" className={styles.ghostBtnSm}>
            <Paperclip size={12} /> Allega documento
          </button>
          <button type="button" className={styles.ghostBtnSm}>
            <CalendarClock size={12} /> Pianifica visita
          </button>
          <button type="button" className={styles.ghostBtnSm}>
            <Sparkles size={12} /> Smart Import
          </button>
          <button type="button" className={styles.primaryBtn}>
            <Workflow size={13} /> Prepara handoff SISS
          </button>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={styles.identityDock}>
          <div className={styles.identityChips}>
            <PillBadge variant="blue">Ipertensione</PillBadge>
            <PillBadge variant="violet">Dislipidemia</PillBadge>
            <PillBadge variant="green">BPCO lieve</PillBadge>
            <PillBadge variant="muted">PA 132/84</PillBadge>
            <PillBadge variant="muted">HR 76</PillBadge>
            <PillBadge variant="muted">SpO₂ 97%</PillBadge>
          </div>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <PillBadge variant="ink">
              <Sparkles size={11} />
              MediFlow Insight
            </PillBadge>
            <PillBadge variant="muted">
              <ShieldCheck size={11} />
              Contesto SISS pronto
            </PillBadge>
            <PillBadge variant="violet">Protesica-RL · monitorato</PillBadge>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <h2 className={styles.panelTitle}>Sintesi clinica</h2>
          <span style={{ marginLeft: 'auto' }}>
            <div className={styles.segmented} role="tablist" aria-label="Vista sintesi paziente">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'ai'}
                className={classNames(styles.segItem, view === 'ai' && styles.segSelected)}
                onClick={() => setView('ai')}
              >
                Sintesi AI
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'source'}
                className={classNames(styles.segItem, view === 'source' && styles.segSelected)}
                onClick={() => setView('source')}
              >
                Fonti grezze
              </button>
            </div>
          </span>
        </div>

        <div className={styles.insightBody}>
          {view === 'ai' ? (
            <p style={{ margin: 0 }}>{PATIENT_AI_SUMMARY}</p>
          ) : (
            <div>
              {PATIENT_SOURCES.map((s) => (
                <div key={s.date + s.text} className={styles.sourceItem}>
                  <span className={styles.sourceDate}>{s.date}</span>
                  <span>{s.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Timeline del caso</h2>
            <PillBadge variant="muted">12 voci</PillBadge>
            <span className={styles.panelActions}>
              <button type="button" className={styles.ghostBtnSm}>
                <Plus size={12} /> Nuova voce
              </button>
            </span>
          </header>
          <div>
            {[
              { time: '08 mag', text: 'Controllo pressorio domiciliare 130/82', tag: 'Diario', variant: 'muted' as const },
              { time: '02 mag', text: 'Referto Holter (24h) nella norma', tag: 'Documento', variant: 'blue' as const },
              { time: '21 apr', text: 'Rinnovo Ramipril 5 mg · 90 giorni', tag: 'Terapia', variant: 'violet' as const },
              { time: '04 apr', text: 'Visita ambulatoriale · obiettività nella norma', tag: 'Visita', variant: 'green' as const },
            ].map((row) => (
              <div key={row.time + row.text} className={styles.row}>
                <span className={styles.rowTime}>{row.time}</span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{row.text}</span>
                </span>
                <span className={styles.rowEnd}>
                  <PillBadge variant={row.variant}>{row.tag}</PillBadge>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panelInset}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Terapia attiva</h2>
            <PillBadge variant="muted">3 prescrizioni</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>
            1 piano terapeutico AIFA · prossimo rinnovo tra 27 giorni.
          </p>
          {[
            { drug: 'Ramipril', dose: '5 mg · 1 cpr/die', tag: 'Cronicità', variant: 'green' as const },
            { drug: 'Atorvastatina', dose: '20 mg · 1 cpr/sera', tag: 'PT AIFA', variant: 'violet' as const },
            { drug: 'Salbutamolo', dose: 'al bisogno', tag: 'Al bisogno', variant: 'muted' as const },
          ].map((row) => (
            <div key={row.drug} className={styles.compositeCard} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PillIcon size={14} color="var(--ink-muted)" />
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                  {row.drug}
                </span>
                <span className={styles.rowSub}>{row.dose}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <PillBadge variant={row.variant}>{row.tag}</PillBadge>
                </span>
              </div>
            </div>
          ))}
        </section>
      </div>

      <div className={styles.threeCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Evidence Stack</h2>
            <PillBadge variant="muted">5 fonti</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>Referti, note ed evidenze recenti citabili.</p>
          {[
            {
              date: '02 mag',
              title: 'Referto cardiologico ASL',
              snippet: '«Holter 24h nella norma. Si conferma terapia per 90 giorni.»',
              tag: 'Documento',
              variant: 'blue' as const,
            },
            {
              date: '21 apr',
              title: 'Nota diario · pressione domiciliare',
              snippet: 'Serie 7 giorni: media 128/80 · variabilità contenuta.',
              tag: 'Diario',
              variant: 'muted' as const,
            },
            {
              date: '04 apr',
              title: 'Visita ambulatoriale',
              snippet: 'Obiettività cardiopolmonare nei limiti · suggerito follow-up 6 mesi.',
              tag: 'Visita',
              variant: 'green' as const,
            },
          ].map((e) => (
            <div key={e.title} className={styles.evidenceItem}>
              <span className={styles.evidenceDate}>{e.date}</span>
              <span>
                <span className={styles.evidenceTitle}>{e.title}</span>
                <span className={styles.evidenceSnippet}>{e.snippet}</span>
              </span>
              <PillBadge variant={e.variant}>{e.tag}</PillBadge>
            </div>
          ))}
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Smart Import</h2>
            <PillBadge variant="violet">
              <Sparkles size={11} /> qwen3.5
            </PillBadge>
          </header>
          <p className={styles.panelSubtitle}>
            Documento in coda · estratti rivedibili prima di applicare al form.
          </p>
          <div className={styles.compositeCard}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} color="var(--ink-muted)" />
              <span className={styles.evidenceTitle}>Referto cardiologico — DOC-2026-241</span>
            </header>
            <span className={styles.rowSub}>3 write strutturate · 2 note da riconciliare · 1 bloccato</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <PillBadge variant="green">match AIFA</PillBadge>
              <PillBadge variant="blue">match ICD</PillBadge>
              <PillBadge variant="yellow">posologia incerta</PillBadge>
              <PillBadge variant="coral">SISS bloccato</PillBadge>
            </div>
            <button type="button" className={styles.ghostBtnSm} style={{ alignSelf: 'flex-start' }}>
              Vai alla revisione
              <ChevronRight size={13} />
            </button>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Lavoro pianificato</h2>
            <PillBadge variant="muted">3 attività</PillBadge>
          </header>
          {[
            {
              icon: <CalendarClock size={14} />,
              title: 'Controllo cardiologico',
              sub: 'pianificato per 18 lug · 6 mesi dall’ultima visita',
              tag: 'Follow-up',
              variant: 'blue' as const,
            },
            {
              icon: <FileSignature size={14} />,
              title: 'Rinnovo esenzione 031',
              sub: 'scadenza tra 27 giorni · azione MMG',
              tag: 'Attenzione',
              variant: 'coral' as const,
            },
            {
              icon: <ListChecks size={14} />,
              title: 'Valutazioni rapide',
              sub: 'Tinetti · MMSE in finestra di rivalutazione',
              tag: 'Scales',
              variant: 'muted' as const,
            },
          ].map((row) => (
            <div key={row.title} className={styles.plannedItem}>
              <span className={styles.plannedIcon}>{row.icon}</span>
              <span>
                <span className={styles.plannedTitle}>{row.title}</span>
                <br />
                <span className={styles.plannedSub}>{row.sub}</span>
              </span>
              <PillBadge variant={row.variant}>{row.tag}</PillBadge>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/* ───────────────────────── Revisione documenti ───────────────────────── */

function RevisioneArea() {
  const [decisions, setDecisions] = useState<Record<string, DocDecision>>(() =>
    Object.fromEntries(DOC_FIELDS.map((f) => [f.id, 'pending'])),
  );

  const reviewable = DOC_FIELDS.filter((f) => f.kind !== 'blocked');
  const elaborated = reviewable.filter((f) => decisions[f.id] !== 'pending').length;
  const total = reviewable.length;
  const canApply = elaborated === total;

  const structuredWrites = reviewable.filter(
    (f) => f.kind === 'structured' && decisions[f.id] === 'apply',
  ).length;
  const noteWrites = reviewable.filter(
    (f) =>
      (f.kind === 'note' && decisions[f.id] === 'note') ||
      (f.kind === 'structured' && decisions[f.id] === 'note'),
  ).length;
  const ignored = reviewable.filter((f) => decisions[f.id] === 'ignore').length;
  const blocked = DOC_FIELDS.filter((f) => f.kind === 'blocked').length;

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Revisione documento · review-first</p>
          <h1 className={styles.areaTitle}>
            Referto cardiologico <em>· document #DOC-2026-241</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Conferma cosa applicare al form. Nessun auto-write · ogni decisione
            è auditata localmente.
          </p>
        </div>
        <div className={styles.headerActions}>
          <PillBadge variant={canApply ? 'green' : 'yellow'}>
            {elaborated} / {total} rivisti
          </PillBadge>
          <button type="button" className={styles.ghostBtn}>
            <FileSignature size={13} />
            Salva come bozza
          </button>
          <button type="button" className={styles.primaryBtn} disabled={!canApply}>
            <Check size={14} />
            Applica al form
          </button>
        </div>
      </header>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Estratti del documento</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="violet">
              <Sparkles size={11} /> qwen3.5 · locale
            </PillBadge>
          </span>
        </header>
        <div className={styles.docCounters}>
          <span className={styles.docCounter}>
            <Check size={11} color="var(--pill-green-fg)" />
            <b>{structuredWrites}</b> write strutturate
          </span>
          <span className={styles.docCounter}>
            <Edit3 size={11} color="var(--pill-blue-fg)" />
            <b>{noteWrites}</b> note da riconciliare
          </span>
          <span className={styles.docCounter}>
            <X size={11} color="var(--ink-subtle)" />
            <b>{ignored}</b> ignorati
          </span>
          <span className={styles.docCounter}>
            <AlertTriangle size={11} color="var(--pill-coral-fg)" />
            <b>{blocked}</b> non integrabile ora
          </span>
        </div>
      </section>

      <div className={styles.docGrid}>
        <section className={styles.docPreview}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PillBadge variant="muted">Anteprima OCR</PillBadge>
            <span className={styles.rowSub}>2 pagine · 87% leggibile</span>
            <span style={{ marginLeft: 'auto' }}>
              <PillBadge variant="blue">PDF · 318 KB</PillBadge>
            </span>
          </header>
          <article className={styles.docPaper}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b>Referto cardiologico — sintetico</b>
              <span className={styles.evidenceDate}>esempio · nessun PHI</span>
            </header>
            <p style={{ margin: 0 }}>
              Paziente con anamnesi positiva per{' '}
              <span className={styles.docHighlight}>ipertensione essenziale</span>{' '}
              in trattamento con{' '}
              <span className={styles.docHighlight}>Ramipril 5 mg</span> 1 cpr/die.
              Holter delle 24h nella norma. Si conferma prosecuzione terapia per{' '}
              <span className={styles.docHighlight}>90 giorni</span> e si raccomanda
              controllo a 6 mesi.
            </p>
            <p style={{ margin: 0 }}>
              Codifica suggerita <b>I10</b>. Esenzione applicabile <b>031</b>
              {' '}— previa verifica del medico curante.
            </p>
            <footer style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <PillBadge variant="muted">pag 1 di 2</PillBadge>
              <PillBadge variant="muted">firma digitale assente</PillBadge>
            </footer>
          </article>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Campi suggeriti</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="violet">5 estratti · 1 bloccato</PillBadge>
            </span>
          </header>
          <div>
            {DOC_FIELDS.map((f) => {
              const decision = decisions[f.id];
              const isBlocked = f.kind === 'blocked';
              const kindLabel =
                f.kind === 'structured'
                  ? 'write strutturata'
                  : f.kind === 'note'
                    ? 'note-only'
                    : 'non integrabile ora';
              return (
                <div key={f.id} className={styles.fieldRow}>
                  <div className={styles.fieldHead}>
                    <span>{f.label}</span>
                    <span className={styles.fieldKind}>· {kindLabel}</span>
                    <span style={{ marginLeft: 'auto' }}>
                      {decision === 'apply' && (
                        <PillBadge variant="green" commitKey={`${f.id}-apply`}>
                          applicato
                        </PillBadge>
                      )}
                      {decision === 'note' && (
                        <PillBadge variant="blue" commitKey={`${f.id}-note`}>
                          come nota
                        </PillBadge>
                      )}
                      {decision === 'ignore' && (
                        <PillBadge variant="muted" commitKey={`${f.id}-ignore`}>
                          ignorato
                        </PillBadge>
                      )}
                      {decision === 'pending' && !isBlocked && (
                        <PillBadge variant="yellow">da rivedere</PillBadge>
                      )}
                      {isBlocked && (
                        <PillBadge variant="coral">
                          <AlertTriangle size={11} /> bloccato
                        </PillBadge>
                      )}
                    </span>
                  </div>
                  {!isBlocked && <div className={styles.fieldValue}>{f.value}</div>}
                  {!isBlocked && (
                    <div className={styles.fieldEvidence}>{f.evidence}</div>
                  )}
                  {!isBlocked && <div className={styles.rowSub}>{f.sourceHint}</div>}
                  {isBlocked && (
                    <div className={styles.fieldBlocked}>
                      <AlertTriangle size={12} />
                      {f.blockedReason}
                    </div>
                  )}
                  {!isBlocked && (
                    <div className={styles.fieldActions}>
                      <button
                        type="button"
                        aria-pressed={decision === 'apply'}
                        className={classNames(
                          styles.fieldBtn,
                          decision === 'apply' && styles.fieldBtnActiveAccept,
                        )}
                        onClick={() => setDecisions((p) => ({ ...p, [f.id]: 'apply' }))}
                      >
                        <Check size={12} />
                        Applica
                      </button>
                      <button
                        type="button"
                        aria-pressed={decision === 'note'}
                        className={classNames(
                          styles.fieldBtn,
                          decision === 'note' && styles.fieldBtnActiveCorrect,
                        )}
                        onClick={() => setDecisions((p) => ({ ...p, [f.id]: 'note' }))}
                      >
                        <Edit3 size={12} />
                        Come nota
                      </button>
                      <button
                        type="button"
                        aria-pressed={decision === 'ignore'}
                        className={classNames(
                          styles.fieldBtn,
                          decision === 'ignore' && styles.fieldBtnActiveIgnore,
                        )}
                        onClick={() => setDecisions((p) => ({ ...p, [f.id]: 'ignore' }))}
                      >
                        <X size={12} />
                        Ignora
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ───────────────────────── Cataloghi locali ───────────────────────── */

function CataloghiArea() {
  const TOTAL_MANIFESTS = 24;
  const [version, setVersion] = useState(7);

  const freshnessTier =
    version <= 3 ? 'broken' : version <= 8 ? 'fresh' : version <= 16 ? 'ok' : 'stale';
  const freshnessTitle = {
    fresh: 'Catalogo manifesto fresco',
    ok: 'Catalogo da verificare',
    stale: 'Catalogo manifesto invecchiato',
    broken: 'Import manuale richiesto',
  }[freshnessTier];
  const freshnessPct = Math.max(8, Math.round(100 - (version - 1) * 4));
  const freshnessClass = classNames(
    styles.freshness,
    freshnessTier === 'ok' && styles.freshnessOk,
    freshnessTier === 'stale' && styles.freshnessStale,
    freshnessTier === 'broken' && styles.freshnessBroken,
  );

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Cataloghi locali · AIFA · ICD · esenzioni</p>
          <h1 className={styles.areaTitle}>
            Governance cataloghi <em>· manifest snapshot v{version}</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Stato locale dei cataloghi clinici · revisione manifest senza
            invocare runtime remoto o sync cloud.
          </p>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={freshnessClass}>
          <Database size={18} color="var(--ink-muted)" />
          <div className={styles.freshnessLabel}>
            <span className={styles.freshnessTitle}>{freshnessTitle}</span>
            <span className={styles.freshnessSub}>
              snapshot {version} di {TOTAL_MANIFESTS} · sincronia locale ·
              ultimo audit 02 mag
            </span>
          </div>
          <span className={styles.freshnessNum}>{freshnessPct}%</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={styles.rowSub}>Seleziona manifest snapshot</span>
          <div className={styles.stepper} role="group" aria-label="Selettore manifest">
            <button
              type="button"
              className={styles.stepperBtn}
              onClick={() => setVersion((v) => Math.max(1, v - 1))}
              disabled={version === 1}
              aria-label="Snapshot precedente"
            >
              <Minus size={14} />
            </button>
            <span className={styles.stepperVal}>{version}</span>
            <button
              type="button"
              className={styles.stepperBtn}
              onClick={() => setVersion((v) => Math.min(TOTAL_MANIFESTS, v + 1))}
              disabled={version === TOTAL_MANIFESTS}
              aria-label="Snapshot successivo"
            >
              <Plus size={14} />
            </button>
          </div>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
            <button type="button" className={styles.ghostBtn}>
              <RefreshCcw size={13} /> Verifica manifest
            </button>
            <button type="button" className={styles.primaryBtn}>
              Segna snapshot valido
              <ChevronRight size={14} />
            </button>
          </span>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Cataloghi clinici</h2>
          <PillBadge variant="muted">{CATALOGS.length} pacchetti</PillBadge>
          <span className={styles.panelActions}>
            <PillBadge variant="green">scope locale · nessun fetch remoto</PillBadge>
          </span>
        </header>

        <div style={{ marginTop: 8 }}>
          {CATALOGS.map((c) => {
            const variant = {
              fresh: 'green',
              ok: 'blue',
              stale: 'yellow',
              broken: 'coral',
              off: 'muted',
            }[c.freshness] as PillVariant;
            const labelText = {
              fresh: 'fresco',
              ok: 'da verificare',
              stale: 'invecchiato',
              broken: 'import manuale richiesto',
              off: 'disattivato',
            }[c.freshness];

            return (
              <div key={c.id} className={styles.catalogRow}>
                <span className={styles.catalogIcon}>
                  <Stethoscope size={13} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className={styles.catalogName}>{c.name}</span>
                  <span className={styles.catalogSub}>{c.sub}</span>
                </div>
                <span className={styles.rowSub} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {c.age}
                </span>
                <PillBadge variant={variant}>{labelText}</PillBadge>
                <button type="button" className={styles.ghostBtnSm}>
                  Apri
                  <ChevronRight size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ───────────────────────── Handoff regionale (SISS) ───────────────────────── */

const LAUNCHERS: {
  id: string;
  label: string;
  caption: string;
  variant: PillVariant;
}[] = [
  {
    id: 'prescrittivo',
    label: 'Modulo Prescrittivo',
    caption:
      'Apri la webapp ufficiale del Modulo Prescrittivo Regionale con il CF pronto da incollare.',
    variant: 'blue',
  },
  {
    id: 'protesica',
    label: 'Protesica-RL',
    caption: 'Apri Assistente RL / Protesica-RL con il CF del paziente.',
    variant: 'violet',
  },
  {
    id: 'fse',
    label: 'FSE · OpeFseIE',
    caption: 'Apri OpeFseIE per consultazione FSE governata da consenso.',
    variant: 'green',
  },
  {
    id: 'anagrafe',
    label: 'Anagrafe · Gaia',
    caption: 'Apri Gaia con il CF pronto da incollare.',
    variant: 'muted',
  },
  {
    id: 'menu',
    label: 'Menu SISS',
    caption: 'Apri la home della sessione SISS regionale.',
    variant: 'muted',
  },
];

const BLOCKED_CAPS: { id: string; label: string; reason: string }[] = [
  {
    id: 'prescr-native',
    label: 'Prescrittivo nativo',
    reason: 'Richiede SSI qualificata + canale A2A non ancora autorizzato.',
  },
  {
    id: 'fse-embedded',
    label: 'FSE embedded',
    reason: 'Nessuno stack regionale certificato per viewer FSE in-app.',
  },
  {
    id: 'sgdt',
    label: 'SGDT / PAI',
    reason: 'Centralizzato regionale · nessun punto d’integrazione paziente-scope.',
  },
  {
    id: 'certificati',
    label: 'Certificati di malattia',
    reason: 'Modellazione SISS non completa · resta su webapp ufficiale.',
  },
];

function HandoffArea() {
  const [stage, setStage] = useState<StageId>('handoff');
  const currentIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Handoff regionale · prototipo contestuale</p>
          <h1 className={styles.areaTitle}>
            Webapp regionali ufficiali <em>· nessun runtime SISS custom</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Boundary chiari fra identità, consenso, lancio webapp ufficiali e
            registrazione manuale dell&apos;esito. Nessuna integrazione SISS
            nativa certificata oggi.
          </p>
        </div>
      </header>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Launcher contestuali</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="muted">5 webapp ufficiali</PillBadge>
            <PillBadge variant="green">CF prefilled · solo copia-incolla</PillBadge>
          </span>
        </header>
        <p className={styles.panelSubtitle}>
          Handoff governato verso webapp ufficiali. Il CF del paziente è
          preparato in clipboard per il copia-incolla.
        </p>
        <div className={styles.launcherGrid}>
          {LAUNCHERS.map((l) => (
            <button key={l.id} type="button" className={styles.launcherTile}>
              <div className={styles.launcherTileHeader}>
                <ArrowUpRight size={14} color="var(--ink-muted)" />
                <span className={styles.evidenceTitle}>{l.label}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <PillBadge variant={l.variant}>portal-handoff</PillBadge>
                </span>
              </div>
              <p className={styles.launcherTileBody}>{l.caption}</p>
              <div className={styles.launcherTileFoot}>
                <PillBadge variant="muted">CF pronto</PillBadge>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  Apri <ArrowUpRight size={11} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Stage handoff</h2>
          <PillBadge variant="muted">{currentIndex + 1} di {STAGES.length}</PillBadge>
        </header>

        <div className={styles.stageRow}>
          <span key={stage} className={styles.stageRowSweep} aria-hidden />
          {STAGES.map((s, i) => {
            const isActive = s.id === stage;
            const isDone = i < currentIndex;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={isActive ? 'step' : undefined}
                aria-label={`${s.label}: ${s.title} · ${
                  isActive ? 'in corso' : isDone ? 'completato' : 'da completare'
                }`}
                onClick={() => setStage(s.id)}
                className={classNames(
                  styles.stageBtn,
                  isActive && styles.stageBtnActive,
                  isDone && styles.stageBtnDone,
                )}
              >
                <span className={styles.stageBtnLabel}>{s.label}</span>
                <span className={styles.stageBtnTitle}>{s.title}</span>
                {isDone && (
                  <span>
                    <PillBadge variant="green">
                      <Check size={11} /> completato
                    </PillBadge>
                  </span>
                )}
                {isActive && !isDone && (
                  <span>
                    <PillBadge variant="ink">in corso</PillBadge>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 16 }}>
          <HandoffStageBody
            stage={stage}
            onAdvance={() => {
              const next = STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, currentIndex + 1)];
              setStage(next);
            }}
          />
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Capability non integrabili oggi</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="coral">
              <AlertTriangle size={11} /> blocked · WUL-180
            </PillBadge>
          </span>
        </header>
        <p className={styles.panelSubtitle}>
          Boundary canonico: senza SSI qualificata o stack regionale certificato
          MediFlow non re-implementa queste capacità.
        </p>
        <div className={styles.launcherGrid}>
          {BLOCKED_CAPS.map((c) => (
            <div key={c.id} className={classNames(styles.launcherTile, styles.launcherTileBlocked)}>
              <div className={styles.launcherTileHeader}>
                <AlertTriangle size={14} color="var(--pill-coral-fg)" />
                <span className={styles.evidenceTitle}>{c.label}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <PillBadge variant="coral">non integrabile ora</PillBadge>
                </span>
              </div>
              <p className={styles.launcherTileBody}>{c.reason}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HandoffStageBody({ stage, onAdvance }: { stage: StageId; onAdvance: () => void }) {
  if (stage === 'identity') {
    return (
      <div className={styles.stagePanel}>
        <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ShieldCheck size={16} color="var(--ink-muted)" />
          <h3 className={styles.panelTitle}>Identità &amp; ruolo MMG</h3>
          <span style={{ marginLeft: 'auto' }}>
            <PillBadge variant="muted">TS-CNS · cookie ufficiale</PillBadge>
          </span>
        </header>
        <dl className={styles.stagePanelKv}>
          <dt>Operatore</dt>
          <dd>Dr. L.P. · medico di medicina generale</dd>
          <dt>Scope ruolo</dt>
          <dd>MMG distretto fittizio 7 · sessione regionale attiva</dd>
          <dt>Token</dt>
          <dd>verificato localmente · scadenza 47 min</dd>
        </dl>
        <div>
          <button type="button" className={styles.primaryBtn} onClick={onAdvance}>
            Verifica ruolo &amp; prosegui
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'consent') {
    return (
      <div className={styles.stagePanel}>
        <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <FileSignature size={16} color="var(--ink-muted)" />
          <h3 className={styles.panelTitle}>Consenso assistito</h3>
          <span style={{ marginLeft: 'auto' }}>
            <PillBadge variant="green">consenso registrato</PillBadge>
          </span>
        </header>
        <dl className={styles.stagePanelKv}>
          <dt>Assistito</dt>
          <dd>codice fittizio AB-2026-014 · 64 anni · M</dd>
          <dt>Scope consenso</dt>
          <dd>FSE consultazione · 90 giorni</dd>
          <dt>Audit locale</dt>
          <dd>evento <code>consent.granted</code> · timestamp 09:12</dd>
        </dl>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <button type="button" className={styles.ghostBtn}>Revoca consenso</button>
          <button type="button" className={styles.primaryBtn} onClick={onAdvance}>
            Procedi all&apos;handoff
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'handoff') {
    return (
      <div className={styles.stagePanel}>
        <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ArrowUpRight size={16} color="var(--ink-muted)" />
          <h3 className={styles.panelTitle}>Handoff verso webapp ufficiale</h3>
          <span style={{ marginLeft: 'auto' }}>
            <PillBadge variant="blue">portal-handoff</PillBadge>
          </span>
        </header>
        <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.6 }}>
          MediFlow non re-implementa la webapp regionale: lancia il portale
          ufficiale con scope ridotti e l&apos;esito viene registrato
          manualmente dall&apos;operatore. Nessun viewer FSE embedded, nessun
          runtime prescrittivo custom.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className={styles.primaryBtn}>
            Apri FSE Viewer ufficiale
            <ArrowUpRight size={13} />
          </button>
          <button type="button" className={styles.ghostBtn}>
            Apri Modulo Prescrittivo Regionale
            <ArrowUpRight size={13} />
          </button>
          <button type="button" className={styles.ghostBtn} onClick={onAdvance}>
            Registra esito al ritorno
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stagePanel}>
      <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Check size={16} color="var(--ink-muted)" />
        <h3 className={styles.panelTitle}>Esito registrato manualmente</h3>
        <span style={{ marginLeft: 'auto' }}>
          <PillBadge variant="yellow">esito manuale · non certificato</PillBadge>
        </span>
      </header>
      <div className={styles.outcomeCapsule}>
        <AlertTriangle size={14} color="var(--rail-yellow)" />
        <span className={styles.outcomeText}>
          <b>Nessun artefatto di ritorno certificato.</b> L&apos;esito del
          portale viene <b>annotato manualmente</b> dall&apos;operatore: numero
          di ricetta, NRE o riferimento incollati dalla webapp. MediFlow non
          riceve oggi ricevute firmate XML né payload A2A SISS.
        </span>
      </div>
      <dl className={styles.stagePanelKv}>
        <dt>Correlation id</dt>
        <dd><code>hndoff-2026-05-15-7a3c</code></dd>
        <dt>Esito riportato</dt>
        <dd>Prescrizione emessa · NRE incollato manualmente</dd>
        <dt>Trace locale</dt>
        <dd>evento <code>handoff.outcome.manual</code> · audit append-only</dd>
      </dl>
      <div style={{ display: 'inline-flex', gap: 8 }}>
        <button type="button" className={styles.primaryBtn}>
          Annota esito sul diario
          <ChevronRight size={14} />
        </button>
        <button type="button" className={styles.ghostBtn}>
          Esporta audit
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Governance locale ───────────────────────── */

function GovernanceArea() {
  const [flags, setFlags] = useState({
    aiInsight: true,
    smartImport: true,
    reduceMotion: false,
    auditLog: true,
    backup: true,
    homeBaseNetwork: false,
    cloudComparator: false,
  });

  const toggle = (k: keyof typeof flags) =>
    setFlags((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Governance locale · on-device</p>
          <h1 className={styles.areaTitle}>
            Comportamenti runtime <em>· nessuna telemetria esterna</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Account, AI runtime, modalità di rete, backup, cataloghi e
            diagnostica · tutto resta sul dispositivo.
          </p>
        </div>
      </header>

      <div className={styles.settingsGrid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Account &amp; PIN</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="muted">solo locale</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Profilo operatore e rotazione PIN zero-knowledge. Nessun reset
            remoto.
          </p>
          <div className={styles.modeCard}>
            <span className={styles.modeIcon}><KeyRound size={16} /></span>
            <span>
              <span className={styles.modeTitle}>PIN operatore</span>
              <br />
              <span className={styles.modeSub}>ultima rotazione 18 apr · scadenza 90 gg</span>
            </span>
            <button type="button" className={styles.ghostBtnSm}>Ruota PIN</button>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><UserSquare2 size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Profilo MMG</span>
              <br />
              <span className={styles.modeSub}>Dr. L.P. · distretto fittizio 7</span>
            </span>
            <button type="button" className={styles.ghostBtnSm}>Modifica</button>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>AI runtime · kill-switch</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="violet">
                <Sparkles size={11} /> shadow mode
              </PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Lane AI locali con disattivazione immediata per lane. Nessun fetch
            cloud nei default.
          </p>

          {[
            {
              id: 'aiInsight' as const,
              title: 'AI Patient Insight',
              sub: 'sintesi locale al primo accesso paziente',
            },
            {
              id: 'smartImport' as const,
              title: 'Smart Import documento',
              sub: 'estrazione locale reviewable · niente auto-write',
            },
            {
              id: 'cloudComparator' as const,
              title: 'Cloud comparator shadow',
              sub: 'opt-in/off by default · solo case pack redatti fuori runtime clinico',
            },
          ].map((row) => (
            <div key={row.id} className={styles.toggleRow}>
              <div className={styles.toggleRowMain}>
                <span className={styles.toggleRowTitle}>{row.title}</span>
                <span className={styles.toggleRowSub}>{row.sub}</span>
              </div>
              <button
                type="button"
                aria-pressed={flags[row.id]}
                aria-label={`${row.title} ${flags[row.id] ? 'attivo' : 'disattivo'}`}
                className={classNames(styles.toggle, flags[row.id] && styles.toggleOn)}
                onClick={() => toggle(row.id)}
              />
            </div>
          ))}

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {[
              { name: 'qwen3.5 · locale', tag: 'attivo', variant: 'green' as const },
              { name: 'mlx · benchmark only', tag: 'visibile', variant: 'blue' as const },
              { name: 'openmed · redaction', tag: 'shadow', variant: 'violet' as const },
              { name: 'gpt-5.4 · cloud', tag: 'opt-in', variant: 'muted' as const },
            ].map((m) => (
              <div key={m.name} className={styles.compositeCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Activity size={13} color="var(--ink-muted)" />
                  <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{m.name}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <PillBadge variant={m.variant}>{m.tag}</PillBadge>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Modalità di rete</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="green">local-only by default</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Local-only è il default. Network home-base resta opzionale e
            richiede LAN fidata con nodo paired autorevole.
          </p>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Network home-base</span>
              <span className={styles.toggleRowSub}>
                opt-in LAN paired · scope ambulatoriale · read + write governato
              </span>
            </div>
            <button
              type="button"
              aria-pressed={flags.homeBaseNetwork}
              aria-label={`Network home-base ${flags.homeBaseNetwork ? 'attivo' : 'disattivo'}`}
              className={classNames(styles.toggle, flags.homeBaseNetwork && styles.toggleOn)}
              onClick={() => toggle('homeBaseNetwork')}
            />
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><Cloud size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Nodo paired</span>
              <br />
              <span className={styles.modeSub}>
                home-base macOS · LAN locale · ultimo handshake 12 ms
              </span>
            </span>
            <PillBadge variant="green">attivo</PillBadge>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Backup &amp; cataloghi</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="muted">launchd notturno</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Snapshot cifrato locale + import manifest AIFA/ICD. Retention
            keep-last-N tracciata in settings.
          </p>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Backup automatico</span>
              <span className={styles.toggleRowSub}>
                snapshot cifrato ogni 4 ore · retention ultimi 12
              </span>
            </div>
            <button
              type="button"
              aria-pressed={flags.backup}
              aria-label={`Backup automatico ${flags.backup ? 'attivo' : 'disattivo'}`}
              className={classNames(styles.toggle, flags.backup && styles.toggleOn)}
              onClick={() => toggle('backup')}
            />
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><HardDrive size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Ultimo backup</span>
              <br />
              <span className={styles.modeSub}>02:14 · 318 MB · preflight OK</span>
            </span>
            <button type="button" className={styles.ghostBtnSm}>Esegui ora</button>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><Database size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Import cataloghi</span>
              <br />
              <span className={styles.modeSub}>AIFA · ICD · esenzioni · LOINC manuale</span>
            </span>
            <button type="button" className={styles.ghostBtnSm}>Apri import</button>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Diagnostica locale</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="muted">audit append-only</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Log d&apos;uso PHI-safe restano on-device. Nessun invio remoto,
            nessuna telemetria di prodotto.
          </p>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Audit locale</span>
              <span className={styles.toggleRowSub}>
                eventi <code>audit.v1</code> on-device · esportabili manualmente
              </span>
            </div>
            <button
              type="button"
              aria-pressed={flags.auditLog}
              aria-label={`Audit locale ${flags.auditLog ? 'attivo' : 'disattivo'}`}
              className={classNames(styles.toggle, flags.auditLog && styles.toggleOn)}
              onClick={() => toggle('auditLog')}
            />
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Riduci animazioni</span>
              <span className={styles.toggleRowSub}>rispetta prefers-reduced-motion del sistema</span>
            </div>
            <button
              type="button"
              aria-pressed={flags.reduceMotion}
              aria-label={`Riduci animazioni ${flags.reduceMotion ? 'attivo' : 'disattivo'}`}
              className={classNames(styles.toggle, flags.reduceMotion && styles.toggleOn)}
              onClick={() => toggle('reduceMotion')}
            />
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Aggiornamento &amp; stato</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="green">in linea</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Versione applicazione corrente, manifest AI parlamento e prossimo
            check di disponibilità aggiornamenti.
          </p>
          <div className={styles.modeCard}>
            <span className={styles.modeIcon}><RefreshCcw size={16} /></span>
            <span>
              <span className={styles.modeTitle}>MediFlow · v0.6.4 (locale)</span>
              <br />
              <span className={styles.modeSub}>
                prossimo check 16 mag 06:00 · canale stable
              </span>
            </span>
            <button type="button" className={styles.ghostBtnSm}>Cerca aggiornamenti</button>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><ShieldCheck size={16} /></span>
            <span>
              <span className={styles.modeTitle}>AI parliament</span>
              <br />
              <span className={styles.modeSub}>
                4 modelli censiti · 1 attivo · 3 visibili / shadow
              </span>
            </span>
            <PillBadge variant="violet">parlamento sano</PillBadge>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ───────────────────────── shell ───────────────────────── */

function AreaContent({
  area,
  filter,
  agendaBridge,
  onOpenScheda,
}: {
  area: AreaId;
  filter: StatusFilter;
  agendaBridge: ClinicalAgendaBridgeClientState;
  onOpenScheda: () => void;
}) {
  switch (area) {
    case 'turno':
      return <TurnoArea filter={filter} agendaBridge={agendaBridge} />;
    case 'incarico':
      return <IncaricoArea onOpenScheda={onOpenScheda} />;
    case 'scheda':
      return <SchedaArea />;
    case 'revisione':
      return <RevisioneArea />;
    case 'cataloghi':
      return <CataloghiArea />;
    case 'handoff':
      return <HandoffArea />;
    case 'governance':
      return <GovernanceArea />;
  }
}

export function Kree8ClinicalCockpit({
  surface = 'live',
}: {
  surface?: 'live' | 'review';
}) {
  const [area, setArea] = useState<AreaId>('turno');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [agendaBridge, setAgendaBridge] = useState<ClinicalAgendaBridgeClientState>({
    status: 'idle',
  });
  const isReview = surface === 'review';

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

  return (
    <div
      className={styles.shell}
      aria-label={isReview ? 'MediFlow · Kree8 review surface' : 'MediFlow · Kree8 live cockpit'}
    >
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>MF</span>
          <span className={styles.brandWord}>
            MEDI<b>FLOW</b>
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <Bell size={14} color="var(--ink-subtle)" />
          </span>
        </div>

        <span className={styles.railLabel}>Turno</span>
        {AREAS.map((a) => {
          const Icon = a.icon;
          const selected = area === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setArea(a.id)}
              className={classNames(styles.navItem, selected && styles.navSelected)}
              aria-current={selected ? 'page' : undefined}
            >
              <Icon size={15} />
              <span>{a.label}</span>
              {a.meta && <span className={styles.navMeta}>{a.meta}</span>}
              {selected && <ChevronRight size={14} className={styles.navChevron} />}
            </button>
          );
        })}

        <span className={styles.railLabel}>Sessione</span>
        <button type="button" className={styles.navItem}>
          <Stethoscope size={15} />
          <span>Stato sistema</span>
          <span className={styles.navMeta}>OK</span>
        </button>
        <button type="button" className={styles.navItem}>
          <ShieldCheck size={15} />
          <span>Audit locale</span>
        </button>

        <div className={styles.railFooter}>
          <span className={styles.railTag}>
            <span className={styles.railDot} />
            home-base locale · 12 ms
          </span>
          <span>{isReview ? 'Review WUL-271 · design reference' : 'Live WUL-272 · localhost root'}</span>
        </div>
      </aside>

      <section className={styles.canvas}>
        <Toolbar filter={filter} setFilter={setFilter} />
        <AreaContent
          area={area}
          filter={filter}
          agendaBridge={agendaBridge}
          onOpenScheda={() => setArea('scheda')}
        />
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
