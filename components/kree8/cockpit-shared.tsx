import type * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  Cloud,
  Database,
  FileSearch,
  FileText,
  Filter,
  Inbox,
  Search,
  Settings as SettingsIcon,
  Upload,
  UserSquare2,
  Workflow,
} from 'lucide-react';

import type { ClinicalEntry } from '@/lib/db';
/* @Codex WUL-UIUX Fase 7: pipeline dati del Quadro condivisa con la Scheda. */
import {
  clinicalEntryTypeLabel,
  formatWorkspaceDate,
  parseDiagnosisLabels,
  type Kree8AgendaRow,
  type Kree8Patient,
  type Kree8PatientSource,
  type PillVariant,
} from '@/lib/patient-workspace';
import styles from './kree8-clinical-cockpit.module.css';


export type AreaId =
  | 'turno'
  | 'incarico'
  | 'scheda'
  | 'diario'
  | 'revisione'
  | 'repertori'
  | 'handoff'
  | 'governance';

/* @Codex WUL-UIUX: id validi per il deep-link ?area= letto da app/page.tsx. */
export const AREA_ID_VALUES: AreaId[] = ['turno', 'incarico', 'scheda', 'diario', 'revisione', 'repertori', 'handoff', 'governance'];
type DocDecision = 'pending' | 'apply' | 'note' | 'ignore';
type StageId = 'identity' | 'consent' | 'handoff' | 'outcome';
type StatusFilter = 'all' | 'urgent' | 'ai' | 'manual';
type InboxScope = 'ambulatorio' | 'network' | 'tutti';
type HandoffFeedback = {
  kind: 'success' | 'warning' | 'error';
  message: string;
  correlationId?: string | null;
};

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

type Kree8PatientStatus = 'idle' | 'loading' | 'ready' | 'error';

type Kree8PatientClientState = {
  status: Kree8PatientStatus;
  patients: Kree8Patient[];
};

type Kree8AgendaClientState = {
  status: Kree8PatientStatus;
  rows: Kree8AgendaRow[];
  /* @Codex WUL-UIUX: conteggio degli appuntamenti di oggi sull'intero set, non
     limitato alle max 6 righe mostrate. */
  todayCount?: number;
  /* @Codex WUL-UIUX: totale dei passaggi pianificati (oggi + futuri) prima dello
     slice(0,6), cosi la testata non dichiara solo le righe visibili. */
  plannedCount?: number;
};

/* @Codex */
type Kree8DiaryEntry = {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  patientHref: string;
  title: string;
  typeLabel: string;
  dateLabel: string;
  preview: string;
  deleted: boolean;
  attachmentCount: number;
};

/* @Codex */
type Kree8DiaryClientState = {
  status: Kree8PatientStatus;
  entries: Kree8DiaryEntry[];
  activeCount: number;
  patientCount: number;
};

type Kree8DecisionCard = {
  title: string;
  body: string;
  pill: string;
  pillVariant: PillVariant;
  action: string;
  target?: AreaId;
};

const AREAS: { id: AreaId; label: string; icon: typeof Inbox; meta?: string }[] = [
  { id: 'turno', label: 'Agenda', icon: CalendarClock },
  { id: 'incarico', label: 'Pazienti', icon: Inbox },
  { id: 'scheda', label: 'Quadro paziente', icon: UserSquare2 },
  { id: 'diario', label: 'Diario', icon: FileText },
  { id: 'revisione', label: 'Documenti', icon: FileSearch },
  { id: 'repertori', label: 'Repertori', icon: Database },
  { id: 'handoff', label: 'SISS e portali', icon: Workflow },
  { id: 'governance', label: 'Impostazioni', icon: SettingsIcon },
];

const PRIMARY_AREA_IDS: AreaId[] = ['turno', 'incarico', 'diario', 'repertori', 'governance'];

function railAreaIsSelected(navArea: AreaId, currentArea: AreaId): boolean {
  if (navArea === currentArea) return true;
  if (navArea === 'incarico') {
    return currentArea === 'scheda' || currentArea === 'revisione' || currentArea === 'handoff';
  }
  return false;
}

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'Tutti' },
  { id: 'urgent', label: 'Urgenti' },
  { id: 'ai', label: 'AI' },
  { id: 'manual', label: 'Manuali' },
];

const STAGES: { id: StageId; index: number; label: string; title: string }[] = [
  { id: 'identity', index: 1, label: 'Passo 1', title: 'Identità & ruolo' },
  { id: 'consent', index: 2, label: 'Passo 2', title: 'Consenso assistito' },
  { id: 'handoff', index: 3, label: 'Passo 3', title: 'Portale ufficiale' },
  { id: 'outcome', index: 4, label: 'Passo 4', title: 'Esito registrato' },
];

const STAGE_ORDER: StageId[] = ['identity', 'consent', 'handoff', 'outcome'];

type FieldKind = 'structured' | 'note' | 'blocked';

/* @Codex */
type Kree8CatalogFreshness = 'fresh' | 'ok' | 'stale' | 'broken' | 'off';

/* @Codex */
type Kree8CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

/* @Codex */
type Kree8CatalogRow = {
  id: string;
  name: string;
  sub: string;
  freshness: Kree8CatalogFreshness;
  age: string;
  href?: string;
  actionLabel?: string;
};

/* @Codex */
type Kree8CatalogClientState = {
  status: Kree8CatalogStatus;
  rows: Kree8CatalogRow[];
  indexedCount: number;
};

const REVIEW_AGENDA: Kree8AgendaRow[] = [
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
    title: 'Prescrizione SISS',
    sub: 'Sessione consenso scaduta tra 6g',
    pill: 'coral',
    pillLabel: 'Attenzione',
  },
];

const REVIEW_PATIENT_LIST: Kree8Patient[] = [
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
    href: '/patients/p1',
    modulesHref: '/patients/p1/modules',
    ageLabel: '64 anni',
    summary: 'Profilo a cronicità multipla · aderenza terapeutica buona · vitali ultima rilevazione nella norma.',
    raw: { id: 'p1' },
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
    href: '/patients/p2',
    modulesHref: '/patients/p2/modules',
    ageLabel: 'Età n/d',
    summary: 'Follow-up e verifica esami in preparazione.',
    raw: { id: 'p2' },
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
    pathway: 'Rete locale',
    href: '/patients/p3',
    modulesHref: '/patients/p3/modules',
    ageLabel: 'Età n/d',
    summary: 'Percorso territoriale attivo con continuità domiciliare.',
    raw: { id: 'p3' },
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
    href: '/patients/p4',
    modulesHref: '/patients/p4/modules',
    ageLabel: 'Età n/d',
    summary: 'Percorso chiuso, consultabile come storico clinico. Nessuna azione di scrittura.',
    raw: { id: 'p4' },
  },
  {
    id: 'p5',
    name: 'I. L.',
    code: 'IL-2026-047',
    scope: 'ambulatorio',
    list: 'attivi',
    status: 'blue',
    statusLabel: 'Smart Import in revisione',
    diagnoses: ['Nuova scheda', 'Documento in coda'],
    lastTouch: '08 mag · Smart Import',
    pathway: 'Ambulatorio locale',
    href: '/patients/p5',
    modulesHref: '/patients/p5/modules',
    ageLabel: 'Età n/d',
    summary: 'Documento in coda di revisione.',
    raw: { id: 'p5' },
  },
];

/* @Codex */
const REVIEW_DIARY_ENTRIES: Kree8DiaryEntry[] = [
  { id: 'review-diary-1', patientId: 'p1', patientName: 'M. R.', patientCode: 'AB-2026-014', patientHref: '/patients/p1', title: 'Controllo pressorio domiciliare', typeLabel: 'Visita', dateLabel: '08 mag, 09:30', preview: 'Pressione domiciliare nella norma, terapia confermata e prossimo controllo programmato.', deleted: false, attachmentCount: 1 },
  { id: 'review-diary-2', patientId: 'p2', patientName: 'C. D.', patientCode: 'CD-2026-088', patientHref: '/patients/p2', title: 'Review esami metabolici', typeLabel: 'Nota', dateLabel: '07 mag, 11:15', preview: 'Documenti in revisione: verificare esenzione e follow-up diabetologico.', deleted: false, attachmentCount: 2 },
];

/* @Codex */
const REVIEW_DIARY_STATE: Kree8DiaryClientState = {
  status: 'ready',
  entries: REVIEW_DIARY_ENTRIES,
  activeCount: REVIEW_DIARY_ENTRIES.filter((entry) => !entry.deleted).length,
  patientCount: new Set(REVIEW_DIARY_ENTRIES.map((entry) => entry.patientId)).size,
};

function formatPatientDate(value: string | Date | null | undefined): string {
  if (!value) return 'n/d';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/d';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}

function calculatePatientAge(value: string | Date | null | undefined): string {
  if (!value) return 'Età n/d';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Età n/d';
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const hasBirthdayPassed =
    now.getMonth() > date.getMonth()
    || (now.getMonth() === date.getMonth() && now.getDate() >= date.getDate());
  if (!hasBirthdayPassed) age -= 1;
  return age >= 0 && age < 130 ? `${age} anni` : 'Età n/d';
}

function maskTaxCode(value: string | null | undefined): string {
  if (!value?.trim()) return 'CF non disponibile';
  const trimmed = value.trim().toUpperCase();
  if (
    trimmed.startsWith('ENC:')
    || trimmed.includes('[LOCKED')
    || trimmed.length > 32
    || !/^[A-Z0-9]{16}$/.test(trimmed)
  ) {
    return 'CF non disponibile';
  }
  return trimmed.length <= 6 ? trimmed : `CF …${trimmed.slice(-6)}`;
}

/* @Codex */
function normalizeClinicalSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* @Codex */
function formatKnownMonitoringProfile(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'taken_in_charge') {
    return 'Presa in carico attiva. Nessuna sintesi clinica disponibile.';
  }
  if (normalized === 'extemporaneous' || normalized === 'episodic') {
    return 'Accesso estemporaneo, contesto da completare.';
  }
  return null;
}

/* @Codex */
function isMetadataLikeClinicalText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('ENC:') || trimmed.includes('[LOCKED')) return true;
  if (/^[A-Z0-9_.:-]{24,}$/i.test(trimmed)) return true;
  if (/^\s*[\[{]/.test(trimmed) && /["{}[\]:]/.test(trimmed)) return true;
  if (/(^|[,{]\s*)"(?:id|type|source|payload|metadata|createdAt|updatedAt|hash|raw|version)"\s*:/i.test(trimmed)) {
    return true;
  }
  return false;
}

/* @Codex */
function extractReadableClinicalText(value: unknown, depth = 0): string | null {
  if (depth > 2 || value == null) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\s*[\[{]/.test(trimmed)) {
      try {
        return extractReadableClinicalText(JSON.parse(trimmed) as unknown, depth + 1);
      } catch {
        return isMetadataLikeClinicalText(trimmed) ? null : trimmed;
      }
    }

    return isMetadataLikeClinicalText(trimmed) ? null : trimmed;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => extractReadableClinicalText(item, depth + 1))
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join(' · ') : null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const priorityKeys = [
      'summary',
      'clinicalSummary',
      'currentState',
      'text',
      'content',
      'description',
      'reason',
      'statusReason',
      'note',
      'notes',
      'label',
      'name',
    ];
    for (const key of priorityKeys) {
      const extracted = extractReadableClinicalText(record[key], depth + 1);
      if (extracted) return extracted;
    }
  }

  return null;
}

/* @Codex */
function compactPatientPreviewText(value: string): string | null {
  const plain = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*]|\d+\.)\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain || isMetadataLikeClinicalText(plain)) return null;
  return plain.length > 230 ? `${plain.slice(0, 227).trim()}…` : plain;
}

/* @Codex */
function buildPatientPreviewSummary(
  patient: Kree8PatientSource,
  isArchived: boolean,
  isAdi: boolean,
): string {
  const candidates: unknown[] = [
    patient.aiSummary,
    patient.notes,
    patient.statusReason,
  ];

  for (const candidate of candidates) {
    const extracted = extractReadableClinicalText(candidate);
    const compact = extracted ? compactPatientPreviewText(extracted) : null;
    if (compact) return compact;
  }

  const profileSummary = formatKnownMonitoringProfile(patient.monitoringProfile);
  if (profileSummary) return profileSummary;

  if (isArchived) return 'Percorso clinico chiuso. Consultabile in sola lettura.';
  if (isAdi) return 'Percorso territoriale attivo con continuità domiciliare.';
  return 'Nessuna sintesi clinica disponibile.';
}

/* @Codex */
function patientMatchesSearch(patient: Kree8Patient, query: string): boolean {
  if (!query) return true;
  const searchable = normalizeClinicalSearch([
    patient.name,
    patient.code,
    patient.raw.taxCode ?? '',
    patient.ageLabel,
    patient.pathway,
    patient.statusLabel,
    patient.lastTouch,
    patient.summary,
    ...patient.diagnoses,
  ].join(' '));
  return searchable.includes(query);
}

function mapPatientForKree8(patient: Kree8PatientSource): Kree8Patient {
  const firstName = patient.firstName?.trim() || '';
  const lastName = patient.lastName?.trim() || '';
  const name = [lastName, firstName].filter(Boolean).join(' ') || 'Paziente senza nome';
  const diagnoses = parseDiagnosisLabels(patient.diagnoses);
  const isArchived = Boolean(patient.isArchived);
  const isAdi = Boolean(patient.isAdi);
  const lastTouch = formatPatientDate(patient.updatedAt ?? patient.createdAt);
  const summary = buildPatientPreviewSummary(patient, isArchived, isAdi);

  return {
    id: patient.id,
    name,
    code: maskTaxCode(patient.taxCode),
    scope: 'ambulatorio',
    list: isArchived ? 'archivio' : 'attivi',
    status: isArchived ? 'muted' : isAdi ? 'green' : diagnoses.length > 0 ? 'blue' : 'green',
    statusLabel: isArchived ? 'Archiviato' : isAdi ? 'ADI' : diagnoses.length > 0 ? 'In carico' : 'Attivo',
    diagnoses: diagnoses.length > 0
      ? diagnoses
      : [isArchived ? 'Storico clinico' : isAdi ? 'ADI territoriale' : 'Profilo da completare'],
    lastTouch,
    pathway: 'Ambulatorio locale',
    href: `/patients/${encodeURIComponent(patient.id)}`,
    modulesHref: `/patients/${encodeURIComponent(patient.id)}/modules`,
    ageLabel: calculatePatientAge(patient.birthDate),
    summary,
    raw: patient,
  };
}

/* @Codex */
function compactClinicalText(value: string | null | undefined): string {
  const plain = (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return 'Voce senza testo clinico.';
  return plain.length > 180 ? `${plain.slice(0, 177)}…` : plain;
}

/* @Codex */
function buildGlobalDiaryState(
  entries: ClinicalEntry[],
  patients: Kree8Patient[],
): Kree8DiaryClientState {
  const patientById = new Map(patients.map((patient) => [patient.id, patient]));
  const recentEntries = entries.slice(0, 50);
  let activeCount = 0;
  const patientIds = new Set<string>();

  const mappedEntries = recentEntries.map((entry) => {
    const patient = patientById.get(entry.patientId);
    const deleted = Boolean(entry.deletedAt);
    if (!deleted) {
      activeCount += 1;
    }
    patientIds.add(entry.patientId);

    return {
      id: entry.id,
      patientId: entry.patientId,
      patientName: patient?.name ?? 'Paziente non trovato',
      patientCode: patient?.code ?? 'CF non disponibile',
      patientHref: patient?.href ?? `/patients/${encodeURIComponent(entry.patientId)}`,
      title: entry.title || 'Voce diario',
      typeLabel: clinicalEntryTypeLabel(entry.type),
      dateLabel: formatWorkspaceDate(entry.date),
      preview: compactClinicalText(entry.content),
      deleted,
      attachmentCount: Array.isArray(entry.attachments) ? entry.attachments.length : 0,
    };
  });

  return {
    status: 'ready',
    entries: mappedEntries,
    activeCount,
    patientCount: patientIds.size,
  };
}

function classNames(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

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
  activeArea,
  filter,
  setFilter,
  onOpenArea,
  onSearchRequest,
  operatorName,
}: {
  activeArea: AreaId;
  filter: StatusFilter;
  setFilter: (id: StatusFilter) => void;
  onOpenArea: (area: AreaId) => void;
  onSearchRequest: () => void;
  operatorName: string;
}) {
  const operatorInitials = buildOperatorInitials(operatorName);

  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={styles.search}
        onClick={onSearchRequest}
      >
        <Search size={14} />
        <span>Cerca nella lista pazienti</span>
      </button>
      {activeArea === 'turno' ? STATUS_FILTERS.map((f) => (
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
        )) : null}
      <Link href="/patients/new" className={styles.toolChip}>
        <Upload size={13} />
        Nuova scheda da documento
      </Link>
      {/* @Codex WUL-UIUX: apre la revisione documenti, non una funzione AI:
          icona e stile standard per non promettere piu di quanto consegna. */}
      <button type="button" className={styles.toolChip} onClick={() => onOpenArea('revisione')}>
        <FileSearch size={13} />
        Documenti paziente
      </button>
      <span className={styles.avatarPill}>
        <span className={styles.avatarDot}>{operatorInitials}</span>
        {operatorName}
      </span>
    </div>
  );
}

function buildOperatorInitials(value: string): string {
  const words = value
    .replace(/\bdr\.?\s*/gi, '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]?.toLocaleUpperCase('it-IT') ?? '').join('');
  return initials || 'MF';
}

/* ───────────────────────── Oggi ───────────────────────── */

function formatCandidateTime(startIso: string): string {
  const date = new Date(startIso);
  if (Number.isNaN(date.getTime())) return '–';
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
          <span>Suggerimenti da e-mail e agenda</span>
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
          <span>Suggerimenti da e-mail e agenda</span>
          <PillBadge variant="coral">non disponibile</PillBadge>
        </div>
        <p className={styles.agendaBridgeCopy}>
          Nessun dato acquisito. L&apos;agenda resta sui passaggi confermati.
        </p>
      </div>
    );
  }

  if (!bridge.data?.enabled) {
    return (
      <div className={styles.agendaBridge}>
        <div className={styles.agendaBridgeHeader}>
          <Cloud size={13} />
          <span>Suggerimenti da e-mail e agenda</span>
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
        <span>Suggerimenti da e-mail e agenda</span>
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
                <PillBadge variant="yellow">da rivedere</PillBadge>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export {
  AREAS,
  PRIMARY_AREA_IDS,
  STATUS_FILTERS,
  STAGES,
  STAGE_ORDER,
  REVIEW_AGENDA,
  REVIEW_PATIENT_LIST,
  REVIEW_DIARY_STATE,
  normalizeClinicalSearch,
  patientMatchesSearch,
  mapPatientForKree8,
  buildGlobalDiaryState,
  classNames,
  PillBadge,
  Toolbar,
  ClinicalAgendaBridgePanel,
  railAreaIsSelected,
};

export type {
  DocDecision,
  StageId,
  StatusFilter,
  InboxScope,
  HandoffFeedback,
  ClinicalAgendaBridgeStatus,
  ClinicalAgendaCandidatePreview,
  ClinicalAgendaBridgePreview,
  ClinicalAgendaBridgeClientState,
  Kree8PatientStatus,
  Kree8PatientClientState,
  Kree8AgendaClientState,
  Kree8DiaryEntry,
  Kree8DiaryClientState,
  Kree8DecisionCard,
  FieldKind,
  Kree8CatalogFreshness,
  Kree8CatalogStatus,
  Kree8CatalogRow,
  Kree8CatalogClientState,
};
