'use client';

/* @Codex */
/* WUL-272 live Kree8-inspired MediFlow cockpit.
   Renders as the root local web entry in live mode and remains available under
   /mockups/kree8 as a review alias. WUL-273 starts the real-data migration for
   live patients/checkups after PIN unlock; the review alias remains synthetic. */

import { useEffect, useMemo, useRef, useState } from 'react';
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

import {
  db,
  type Attachment,
  type Checkup,
  type ClinicalEntry,
  type Observation,
  type Patient,
  type Therapy,
} from '@/lib/db';
import { completeSissPortalHandoff, prepareSissPortalWindow } from '@/lib/siss';
import type {
  SissPatientContextAction,
  SissPatientContextHandoffResult,
} from '@/lib/siss-patient-context-shared';
import { useLiveQuery } from '@/lib/live-query';
import { ThemeToggle } from '@/components/theme-toggle';
import styles from './kree8-clinical-cockpit.module.css';

type AreaId =
  | 'turno'
  | 'incarico'
  | 'scheda'
  | 'diario'
  | 'revisione'
  | 'cataloghi'
  | 'handoff'
  | 'governance';
type DocDecision = 'pending' | 'apply' | 'note' | 'ignore';
type StageId = 'identity' | 'consent' | 'handoff' | 'outcome';
type StatusFilter = 'all' | 'urgent' | 'ai' | 'manual';
type InboxScope = 'ambulatorio' | 'network' | 'tutti';
type InboxList = 'attivi' | 'archivio';
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

type Kree8PatientSource = Partial<Patient> & {
  id: string;
  statusReason?: string | null;
};

type Kree8Patient = {
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
  href: string;
  modulesHref: string;
  ageLabel: string;
  summary: string;
  raw: Kree8PatientSource;
};

type Kree8PatientClientState = {
  status: Kree8PatientStatus;
  patients: Kree8Patient[];
};

/* @Codex */
type Kree8PatientWorkspace = {
  entriesCount: number;
  latestEntry?: { title: string; date: string; type: string };
  activeTherapiesCount: number;
  therapyLabels: string[];
  pendingCheckupsCount: number;
  nextCheckup?: { title: string; date: string; pill: PillVariant; pillLabel: string };
  observationsCount: number;
  latestObservation?: { label: string; date: string; value: string };
  attachmentsCount: number;
  recentAttachmentNames: string[];
  documentInsightCount: number;
  codingHints: string[];
};

type Kree8AgendaRow = {
  time: string;
  title: string;
  sub: string;
  pill: 'green' | 'blue' | 'yellow' | 'coral' | 'muted' | 'violet';
  pillLabel: string;
};

type Kree8CheckupSource = {
  id: string;
  patientId: string;
  date: string | Date;
  title: string;
  notes?: string | null;
  status?: string | null;
};

type Kree8AgendaClientState = {
  status: Kree8PatientStatus;
  rows: Kree8AgendaRow[];
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
  { id: 'cataloghi', label: 'Repertori', icon: Database },
  { id: 'handoff', label: 'SISS e portali', icon: Workflow },
  { id: 'governance', label: 'Impostazioni', icon: SettingsIcon },
];

const PRIMARY_AREA_IDS: AreaId[] = ['turno', 'incarico', 'diario', 'cataloghi', 'governance'];

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
      'Nessun canale A2A SISS certificato. Solo portale ufficiale + registrazione manuale dell’esito.',
  },
];

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

const REVIEW_CATALOGS: Kree8CatalogRow[] = [
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
    sub: 'pacchetto 7 di 24 disponibile',
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

/* @Codex */
const REVIEW_CATALOG_STATE: Kree8CatalogClientState = {
  status: 'ready',
  rows: REVIEW_CATALOGS,
  indexedCount: 0,
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

const AI_QUEUE: Kree8DecisionCard[] = [
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

function parseStructuredList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDiagnosisLabels(value: unknown): string[] {
  return parseStructuredList(value)
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const code = typeof record.code === 'string' ? record.code.trim() : '';
      const description =
        typeof record.description === 'string'
          ? record.description.trim()
          : typeof record.name === 'string'
            ? record.name.trim()
            : '';
      if (code && description) return `${code} · ${description}`;
      return description || code || null;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
}

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
    return 'Presa in carico attiva. Apri la scheda per diario, terapie e documenti.';
  }
  if (normalized === 'extemporaneous' || normalized === 'episodic') {
    return 'Accesso estemporaneo. Apri la scheda per completare contesto e prossimo passaggio.';
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
  return 'Apri la scheda per leggere diario, terapie e documenti del paziente.';
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

function formatCheckupTime(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function classifyCheckupPill(checkup: Kree8CheckupSource): Pick<Kree8AgendaRow, 'pill' | 'pillLabel'> {
  const status = checkup.status ?? 'pending';
  const date = new Date(checkup.date);
  const now = new Date();

  if (status === 'completed') return { pill: 'green', pillLabel: 'Completato' };
  if (status === 'cancelled') return { pill: 'muted', pillLabel: 'Annullato' };
  if (!Number.isNaN(date.getTime()) && date.getTime() < now.getTime() && !isSameCalendarDay(date, now)) {
    return { pill: 'coral', pillLabel: 'Scaduto' };
  }
  if (!Number.isNaN(date.getTime()) && isSameCalendarDay(date, now)) {
    return { pill: 'yellow', pillLabel: 'Oggi' };
  }
  return { pill: 'blue', pillLabel: 'Pianificato' };
}

function mapCheckupsForKree8(
  checkups: Kree8CheckupSource[],
  patients: Kree8Patient[],
): Kree8AgendaRow[] {
  const patientById = new Map(patients.map((patient) => [patient.id, patient]));

  return checkups
    .filter((checkup) => checkup.status !== 'cancelled')
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .slice(0, 6)
    .map((checkup) => {
      const patient = patientById.get(checkup.patientId);
      const pill = classifyCheckupPill(checkup);
      return {
        time: formatCheckupTime(checkup.date),
        title: checkup.title || 'Appuntamento clinico',
        sub: patient
          ? `${patient.name} · ${patient.code}`
          : 'Paziente locale non risolto nella lista corrente',
        ...pill,
      };
    });
}

/* @Codex */
function formatWorkspaceDate(value: string | Date | null | undefined): string {
  if (!value) return 'n/d';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/d';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/* @Codex */
function clinicalEntryTypeLabel(type: ClinicalEntry['type'] | undefined): string {
  switch (type) {
    case 'visit':
      return 'Visita';
    case 'phone':
      return 'Telefonata';
    case 'exam':
      return 'Esame';
    case 'hospitalization':
      return 'Ricovero';
    case 'access':
      return 'Accesso';
    case 'scale':
      return 'Scala';
    case 'remote':
      return 'Remoto';
    case 'note':
    default:
      return 'Nota';
  }
}

/* @Codex */
async function fetchCatalogCount(path: string): Promise<number> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Catalog count failed: ${response.status}`);
  const payload = await response.json() as { count?: unknown };
  return Number(payload.count || 0);
}

/* @Codex */
function formatCatalogCount(count: number, singular: string, plural: string): string {
  const label = count === 1 ? singular : plural;
  return `${count.toLocaleString('it-IT')} ${label}`;
}

/* @Codex */
function catalogFreshnessFromCount(count: number): Kree8CatalogFreshness {
  return count > 0 ? 'fresh' : 'broken';
}

/* @Codex */
function buildLiveCatalogState(drugCount: number, exemptionCount: number): Kree8CatalogClientState {
  const rows: Kree8CatalogRow[] = [
    {
      id: 'aic',
      name: 'AIFA · AIC farmaci',
      sub: drugCount > 0
        ? 'Prontuario farmaci indicizzato nel database locale.'
        : 'Nessun farmaco indicizzato: importa confezioni.csv dalle impostazioni.',
      freshness: catalogFreshnessFromCount(drugCount),
      age: formatCatalogCount(drugCount, 'farmaco', 'farmaci'),
      href: '/settings#data',
      actionLabel: drugCount > 0 ? 'Impostazioni' : 'Importa',
    },
    {
      id: 'exemptions',
      name: 'Esenzioni · codifiche locali',
      sub: exemptionCount > 0
        ? 'Catalogo esenzioni disponibile per ricerca anagrafica.'
        : 'Nessuna esenzione indicizzata: importa TXT/CSV dalle impostazioni.',
      freshness: catalogFreshnessFromCount(exemptionCount),
      age: formatCatalogCount(exemptionCount, 'codice', 'codici'),
      href: '/settings#data',
      actionLabel: exemptionCount > 0 ? 'Impostazioni' : 'Importa',
    },
    {
      id: 'icd',
      name: 'ICD-11 locale',
      sub: 'Servizio locale gestito dal launcher; nessun servizio remoto richiesto.',
      freshness: 'ok',
      age: 'porta 8888',
      href: '/settings#operations',
      actionLabel: 'Diagnostica',
    },
  ];

  return {
    status: 'ready',
    rows,
    indexedCount: drugCount + exemptionCount,
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

/* @Codex */
function summarizeObservation(observation: Observation): string {
  const unit = observation.unitCode ? ` ${observation.unitCode}` : '';
  return `${observation.display || observation.code}: ${observation.value}${unit}`;
}

/* @Codex */
function buildCodingHints(
  patient: Kree8Patient,
  therapies: Therapy[],
  attachments: Attachment[],
): string[] {
  const hints: string[] = [];
  const structuredDiagnoses = parseDiagnosisLabels(patient.raw.diagnoses);
  const hasCodedDiagnosis = structuredDiagnoses.some((diagnosis) => /^[A-Z][0-9A-Z.-]*\s*·/.test(diagnosis));
  const therapiesWithoutDiagnosis = therapies.filter((therapy) => therapy.status === 'active' && !therapy.diagnosisCode);

  if (!hasCodedDiagnosis) {
    hints.push('Diagnosi da collegare a codifica clinica');
  }
  if (therapiesWithoutDiagnosis.length > 0) {
    hints.push(`${therapiesWithoutDiagnosis.length} terapie senza aggancio diagnosi`);
  }
  if (attachments.length > 0) {
    hints.push('Documenti recenti da usare per confermare codifiche');
  }

  return hints.slice(0, 3);
}

/* @Codex */
function buildPatientWorkspace({
  patient,
  entries,
  therapies,
  checkups,
  observations,
  attachments,
}: {
  patient: Kree8Patient;
  entries: ClinicalEntry[];
  therapies: Therapy[];
  checkups: Checkup[];
  observations: Observation[];
  attachments: Attachment[];
}): Kree8PatientWorkspace {
  const activeEntries = entries
    .filter((entry) => !entry.deletedAt)
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
  const activeTherapies = therapies
    .filter((therapy) => therapy.status === 'active')
    .sort((left, right) => new Date(right.updatedAt ?? right.createdAt).getTime() - new Date(left.updatedAt ?? left.createdAt).getTime());
  const pendingCheckups = checkups
    .filter((checkup) => checkup.status !== 'completed' && checkup.status !== 'cancelled')
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  const latestObservations = observations
    .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime());
  const recentAttachments = attachments
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const nextCheckup = pendingCheckups[0];
  const latestEntry = activeEntries[0];
  const latestObservation = latestObservations[0];
  const documentInsightCount = Array.isArray(patient.raw.documentInsights)
    ? patient.raw.documentInsights.length
    : 0;

  return {
    entriesCount: activeEntries.length,
    latestEntry: latestEntry
      ? {
        title: latestEntry.title || 'Voce diario',
        date: formatWorkspaceDate(latestEntry.date),
        type: clinicalEntryTypeLabel(latestEntry.type),
      }
      : undefined,
    activeTherapiesCount: activeTherapies.length,
    therapyLabels: activeTherapies
      .slice(0, 3)
      .map((therapy) => [therapy.drugName, therapy.dosage].filter(Boolean).join(' · ')),
    pendingCheckupsCount: pendingCheckups.length,
    nextCheckup: nextCheckup
      ? {
        title: nextCheckup.title || 'Follow-up',
        date: formatWorkspaceDate(nextCheckup.date),
        ...classifyCheckupPill(nextCheckup),
      }
      : undefined,
    observationsCount: latestObservations.length,
    latestObservation: latestObservation
      ? {
        label: summarizeObservation(latestObservation),
        date: formatWorkspaceDate(latestObservation.observedAt),
        value: String(latestObservation.value),
      }
      : undefined,
    attachmentsCount: recentAttachments.length,
    recentAttachmentNames: recentAttachments.slice(0, 3).map((attachment) => attachment.name || 'Documento clinico'),
    documentInsightCount,
    codingHints: buildCodingHints(patient, activeTherapies, recentAttachments),
  };
}

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
        aria-label="Apri la ricerca nella lista pazienti"
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
      <button type="button" className={styles.aiButton} onClick={() => onOpenArea('revisione')}>
        <Sparkles size={13} />
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
    if (filter === 'all') return agendaState.rows;
    if (filter === 'urgent') return agendaState.rows.filter((r) => r.pill === 'coral' || r.pill === 'yellow');
    if (filter === 'ai') return agendaState.rows.filter((r) => r.pill === 'violet');
    return agendaState.rows.filter((r) => r.pill === 'green' || r.pill === 'blue' || r.pill === 'muted');
  }, [agendaState.rows, filter]);
  const activePatientCount = patientState.patients.filter((patient) => patient.list === 'attivi').length;
  const patientCountLabel =
    patientState.status === 'loading' || patientState.status === 'idle'
      ? '…'
      : patientState.status === 'error'
        ? '—'
        : String(activePatientCount);
  const patientTrendLabel =
    patientState.status === 'ready'
      ? `${patientState.patients.length} schede in carico`
      : patientState.status === 'error'
        ? 'pazienti non disponibili'
        : 'aggiornamento in corso';
  const todayVisitCount = agendaState.rows.filter((row) => row.pillLabel === 'Oggi').length;
  const visitCountLabel =
    agendaState.status === 'loading' || agendaState.status === 'idle'
      ? '…'
      : agendaState.status === 'error'
        ? '—'
        : String(todayVisitCount);
  const visitSubLabel =
    agendaState.status === 'ready'
      ? `${agendaState.rows.length} passaggi pianificati`
      : agendaState.status === 'error'
        ? 'agenda non disponibile'
        : 'aggiornamento agenda';
  const documentCountLabel = isReview ? '24' : '—';
  const documentSubLabel = isReview
    ? '7 con suggerimento AI'
    : 'apri revisione documentale';
  const decisionCountLabel = isReview ? '7' : '—';
  const decisionSubLabel = isReview
    ? '2 oltre SLA'
    : 'priorità dal paziente selezionato';
  const decisionCards: Kree8DecisionCard[] = isReview
    ? AI_QUEUE
    : [
      {
        title: 'Pazienti in carico',
        body: patientState.status === 'ready'
          ? `${patientState.patients.length} schede disponibili per triage, diario e follow-up.`
          : 'Preparazione della lista pazienti.',
        pill: patientState.status === 'error' ? 'Errore' : 'In carico',
        pillVariant: patientState.status === 'error' ? 'coral' : 'green',
        action: 'Vai ai pazienti',
        target: 'incarico',
      },
      {
        title: 'Agenda clinica',
        body: agendaState.status === 'ready'
          ? `${agendaState.rows.length} passaggi pianificati collegati alla giornata.`
          : agendaState.status === 'error'
            ? 'Agenda non disponibile: resta visibile la lista pazienti.'
            : 'Preparazione degli appuntamenti.',
        pill: agendaState.status === 'error' ? 'Errore' : 'Agenda',
        pillVariant: agendaState.status === 'error' ? 'coral' : 'blue',
        action: 'Rivedi agenda',
        target: 'turno',
      },
      {
        title: 'Revisione e codifiche',
        body: 'Usa la scheda paziente per rivedere documenti, suggerimenti AI e codifiche prima di applicare aggiornamenti clinici.',
        pill: 'AI',
        pillVariant: 'violet',
        action: 'Apri revisione',
        target: 'revisione',
      },
    ];

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Agenda locale</p>
          <h1 className={styles.areaTitle}>
            Agenda di oggi <em>{agendaState.rows.length} appuntamenti locali.</em>
          </h1>
          <p className={styles.areaSubtitle}>
            {patientState.status === 'ready'
              ? `${patientState.patients.length} pazienti in carico · agenda, documenti e priorità della giornata.`
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
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Documenti in coda</span>
          <span className={styles.statValue}>{documentCountLabel}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            {documentSubLabel}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Appuntamenti oggi</span>
          <span className={styles.statValue}>{visitCountLabel}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            {visitSubLabel}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Suggerimenti da rivedere</span>
          <span className={styles.statValue}>{decisionCountLabel}</span>
          <span className={classNames(styles.statTrend, styles.statTrendDown)}>
            <ArrowUpRight size={12} style={{ transform: 'rotate(90deg)' }} />
            {decisionSubLabel}
          </span>
        </div>
      </div>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Agenda di oggi</h2>
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
                {agendaState.status === 'ready'
                  ? 'Nessun appuntamento per il filtro selezionato.'
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
            <PillBadge variant="violet">
              {isReview ? '7 casi' : 'oggi'}
            </PillBadge>
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

/* ───────────────────────── Pazienti in carico ───────────────────────── */

function IncaricoArea({
  patients,
  patientStatus,
  selectedPatientId,
  searchFocusSignal,
  onSelectPatient,
  onOpenArea,
}: {
  patients: Kree8Patient[];
  patientStatus: Kree8PatientStatus;
  selectedPatientId?: string;
  searchFocusSignal: number;
  onSelectPatient: (patientId: string) => void;
  onOpenArea: (area: AreaId) => void;
}) {
  const [scope, setScope] = useState<InboxScope>('ambulatorio');
  const [list, setList] = useState<InboxList>('attivi');
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Pazienti</p>
          <h1 className={styles.areaTitle}>
            Pazienti in carico <em>priorità e prossimo passo</em>
          </h1>
          <p className={styles.areaSubtitle}>
            {patientStatus === 'ready'
              ? 'Seleziona un caso, apri il quadro e prepara il prossimo passaggio.'
              : patientStatus === 'error'
                ? 'Lista pazienti non disponibile: verifica sessione e servizi locali.'
                : 'Preparazione della lista pazienti.'}
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
            Rete locale
          </button>
          <button
            type="button"
            className={classNames(styles.scopeChip, scope === 'tutti' && styles.scopeChipActive)}
            onClick={() => setScope('tutti')}
          >
            <Users size={12} />
            Tutti gli ambulatori
          </button>

          <span className={styles.patientScopeActions}>
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
        <div className={styles.patientSearchRow}>
          <label className={styles.patientSearchField}>
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca per nome, codice fiscale, diagnosi o nota"
              aria-label="Cerca nella lista pazienti"
            />
          </label>
          {query ? (
            <button
              type="button"
              className={styles.patientSearchClear}
              onClick={() => {
                setQuery('');
                searchInputRef.current?.focus();
              }}
            >
              Cancella
            </button>
          ) : null}
        </div>
      </section>

      <div className={styles.inboxLayout}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              {list === 'attivi' ? 'Pazienti in carico' : 'Archivio pazienti'}
            </h2>
            <PillBadge variant="muted">{visible.length} risultati</PillBadge>
            {normalizedQuery ? <PillBadge variant="blue">ricerca attiva</PillBadge> : null}
            <span className={styles.panelActions}>
              <Link href="/patients/new" className={styles.ghostBtnSm}>
                <Plus size={12} />
                Nuova scheda
              </Link>
            </span>
          </header>

          <div style={{ marginTop: 8 }}>
            {patientStatus === 'loading' && (
              <p className={styles.rowSub} style={{ padding: '24px 0' }}>
                Caricamento pazienti…
              </p>
            )}
            {patientStatus === 'error' && (
              <p className={styles.rowSub} style={{ padding: '24px 0' }}>
                Lista pazienti non disponibile. Verifica sessione e servizi locali.
              </p>
            )}
            {visible.length === 0 && (
              <p className={styles.rowSub} style={{ padding: '24px 0' }}>
                {patientStatus === 'ready' && normalizedQuery
                  ? `Nessun risultato per “${query.trim()}”. Modifica la ricerca o cambia ambito.`
                  : patientStatus === 'ready'
                  ? 'Nessun paziente nell’ambito selezionato.'
                  : 'In attesa dei dati paziente.'}
              </p>
            )}
            {visible.map((p) => {
              const isSelected = p.id === selected?.id;
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
                  onClick={() => onSelectPatient(p.id)}
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

        {selected ? (
        <aside className={styles.caseLens} key={selected.id}>
          <span className={styles.areaCaption}>Anteprima paziente</span>
          <div className={styles.caseLensHero}>
            <span className={styles.caseLensName}>{selected.name}</span>
            <span className={styles.caseLensSub}>
              {selected.ageLabel} · aggiornato {selected.lastTouch}
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
            {selected.summary}
          </p>
          <div className={styles.caseLensActions}>
            <Link href={selected.href} className={styles.primaryBtn}>
              <UserSquare2 size={13} />
              {selected.list === 'archivio' ? 'Apri quadro archivio' : 'Apri quadro'}
            </Link>
            <Link href={selected.modulesHref} className={styles.ghostBtnSm}>
              <ArrowUpRight size={12} />
              Apri scheda
            </Link>
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('revisione')}>
              <FileText size={12} />
              Documenti
            </button>
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('handoff')}>
              <Workflow size={12} />
              Prepara SISS
            </button>
          </div>
        </aside>
        ) : (
          <aside className={styles.caseLens}>
            <span className={styles.areaCaption}>Anteprima paziente</span>
            <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.6 }}>
              {normalizedQuery
                ? 'Nessun paziente corrisponde alla ricerca corrente.'
                : 'Nessun paziente reale selezionabile in questa vista.'}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Scheda paziente ───────────────────────── */

function RealPatientArea({
  patient,
  workspace,
  onOpenArea,
}: {
  patient: Kree8Patient;
  workspace?: Kree8PatientWorkspace | null;
  onOpenArea: (area: AreaId) => void;
}) {
  const isWorkspaceLoading = workspace === undefined;
  const latestEntry = workspace?.latestEntry;
  const nextCheckup = workspace?.nextCheckup;
  const latestObservation = workspace?.latestObservation;
  const codingHints = workspace?.codingHints ?? [];

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Quadro paziente</p>
          <h1 className={styles.areaTitle}>
            {patient.name} <em>· {patient.ageLabel}</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Ultimo aggiornamento {patient.lastTouch}. Sintesi, segnali recenti
            e prossime azioni del caso.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href={`${patient.href}/entries/new`} className={styles.ghostBtnSm}>
            <Plus size={12} /> Nuova voce
          </Link>
          <Link href={`${patient.href}/edit`} className={styles.ghostBtnSm}>
            <Edit3 size={12} /> Anagrafica
          </Link>
          <Link href={patient.modulesHref} className={styles.primaryBtn}>
            <UserSquare2 size={13} /> Apri scheda
          </Link>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={styles.identityDock}>
          <div className={styles.identityChips}>
            {patient.diagnoses.map((diagnosis) => (
              <PillBadge key={diagnosis} variant="blue">{diagnosis}</PillBadge>
            ))}
            <PillBadge variant={patient.status === 'muted' ? 'muted' : patient.status === 'blue' ? 'blue' : 'green'}>
              {patient.statusLabel}
            </PillBadge>
            <PillBadge variant="muted">{patient.code}</PillBadge>
          </div>
          <span style={{ marginLeft: 'auto' }}>
            <PillBadge variant={patient.status === 'muted' ? 'muted' : 'green'}>
              <ShieldCheck size={11} />
              In carico
            </PillBadge>
          </span>
        </div>

        <div style={{ marginTop: 14 }}>
          <h2 className={styles.panelTitle}>Sintesi del caso</h2>
          <div className={styles.insightBody}>
            <p style={{ margin: 0 }}>{patient.summary}</p>
          </div>
        </div>
      </section>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Diario</span>
          <span className={styles.statValue}>{isWorkspaceLoading ? '…' : workspace?.entriesCount ?? 0}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            {isWorkspaceLoading ? 'caricamento diario' : latestEntry ? `${latestEntry.type} · ${latestEntry.date}` : 'nessuna voce recente'}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Terapie attive</span>
          <span className={styles.statValue}>{isWorkspaceLoading ? '…' : workspace?.activeTherapiesCount ?? 0}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            {isWorkspaceLoading ? 'caricamento terapie' : workspace?.therapyLabels[0] ?? 'nessun piano attivo'}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Follow-up</span>
          <span className={styles.statValue}>{isWorkspaceLoading ? '…' : workspace?.pendingCheckupsCount ?? 0}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            {isWorkspaceLoading ? 'caricamento agenda' : nextCheckup ? `${nextCheckup.title} · ${nextCheckup.date}` : 'nessun passaggio aperto'}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Documenti</span>
          <span className={styles.statValue}>{isWorkspaceLoading ? '…' : workspace?.attachmentsCount ?? 0}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>
            {isWorkspaceLoading ? 'caricamento archivio' : workspace?.documentInsightCount ? `${workspace.documentInsightCount} sintesi disponibili` : 'archivio consultabile'}
          </span>
        </div>
      </div>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Cosa fare ora</h2>
            <PillBadge variant="blue">priorità del caso</PillBadge>
          </header>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <div className={styles.compositeCard}>
              <header className={styles.panelHeader}>
                <span className={styles.evidenceTitle}>Diario clinico</span>
                <PillBadge variant="muted">{workspace?.entriesCount ?? 0} voci</PillBadge>
              </header>
              <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.55 }}>
                {isWorkspaceLoading
                  ? 'Caricamento diario clinico.'
                  : latestEntry
                  ? `${latestEntry.title} · ${latestEntry.date}`
                  : 'Apri una nuova voce o consulta la timeline completa.'}
              </p>
              <Link href={`${patient.href}/entries/new`} className={styles.ghostBtnSm} style={{ alignSelf: 'flex-start' }}>
                <Plus size={12} />
                Registra passaggio
              </Link>
            </div>

            <div className={styles.compositeCard}>
              <header className={styles.panelHeader}>
                <span className={styles.evidenceTitle}>Terapie e osservazioni</span>
                <PillBadge variant="green">{workspace?.activeTherapiesCount ?? 0} attive</PillBadge>
              </header>
              <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.55 }}>
                {isWorkspaceLoading
                  ? 'Caricamento terapie e osservazioni.'
                  : workspace?.therapyLabels.length
                  ? workspace.therapyLabels.join(' · ')
                  : 'Nessuna terapia attiva in evidenza.'}
              </p>
              <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.55 }}>
                {isWorkspaceLoading
                  ? 'Osservazioni in aggiornamento.'
                  : latestObservation
                  ? `Ultima osservazione: ${latestObservation.label} · ${latestObservation.date}`
                  : 'Nessuna osservazione recente.'}
              </p>
            </div>

            <div className={styles.compositeCard}>
              <header className={styles.panelHeader}>
                <span className={styles.evidenceTitle}>Agenda del caso</span>
                <PillBadge variant={nextCheckup?.pill ?? 'muted'}>
                  {nextCheckup?.pillLabel ?? 'libera'}
                </PillBadge>
              </header>
              <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.55 }}>
                {isWorkspaceLoading
                  ? 'Caricamento follow-up del caso.'
                  : nextCheckup
                  ? `${nextCheckup.title} · ${nextCheckup.date}`
                  : 'Nessun follow-up aperto: pianifica il prossimo controllo se necessario.'}
              </p>
              <button type="button" className={styles.ghostBtnSm} style={{ alignSelf: 'flex-start' }} onClick={() => onOpenArea('turno')}>
                <CalendarClock size={12} />
                Vai all&apos;agenda
              </button>
            </div>
          </div>
        </section>

        <section className={styles.panelInset}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Documenti e codifiche</h2>
            <PillBadge variant={codingHints.length ? 'violet' : 'green'}>
              {codingHints.length ? `${codingHints.length} da rivedere` : 'allineato'}
            </PillBadge>
          </header>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <div>
              <span className={styles.fieldKind}>AI coding</span>
              {codingHints.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {codingHints.map((hint) => (
                    <div key={hint} className={styles.evidenceItem}>
                      <span className={styles.evidenceTitle}>{hint}</span>
                      <span className={styles.evidenceSnippet}>Verifica in revisione documentale prima di applicare.</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.panelSubtitle}>Nessuna codifica sospesa in primo piano.</p>
              )}
            </div>

            <div>
              <span className={styles.fieldKind}>Archivio recente</span>
              {workspace?.recentAttachmentNames.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {workspace.recentAttachmentNames.map((name) => (
                    <div key={name} className={styles.evidenceItem}>
                      <span className={styles.evidenceTitle}>{name}</span>
                      <span className={styles.evidenceSnippet}>Apri documenti paziente per allegati, sintesi e review.</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.panelSubtitle}>Nessun documento recente agganciato.</p>
              )}
            </div>

            <div className={styles.caseLensActions}>
              <Link href={`${patient.modulesHref}#documenti`} className={styles.primaryBtn}>
                <Sparkles size={13} />
                Rivedi documenti
              </Link>
              <Link href={`${patient.modulesHref}#scale`} className={styles.ghostBtnSm}>
                <ListChecks size={12} />
                Scale cliniche
              </Link>
              <Link href={`${patient.modulesHref}#contesto`} className={styles.ghostBtnSm}>
                <Workflow size={12} />
                Contesto SISS
              </Link>
              <Link href={patient.modulesHref} className={styles.ghostBtnSm}>
                <ArrowUpRight size={12} />
                Apri scheda
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SchedaArea({
  patient,
  workspace,
  isReview,
  onOpenArea,
}: {
  patient?: Kree8Patient | null;
  workspace?: Kree8PatientWorkspace | null;
  isReview: boolean;
  onOpenArea: (area: AreaId) => void;
}) {
  const [view, setView] = useState<'ai' | 'source'>('ai');

  if (!isReview && patient) {
    return <RealPatientArea patient={patient} workspace={workspace} onOpenArea={onOpenArea} />;
  }

  if (!isReview && !patient) {
    return (
      <div className={styles.areaShell}>
        <header className={styles.areaHeader}>
          <div>
            <p className={styles.areaCaption}>Quadro paziente</p>
            <h1 className={styles.areaTitle}>
              Nessun paziente selezionato <em>· seleziona un caso in carico</em>
            </h1>
            <p className={styles.areaSubtitle}>
              Apri un paziente dalla lista in carico per vedere quadro paziente,
              azioni, documenti e follow-up del caso.
            </p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Quadro paziente · cronicità multipla</p>
          <h1 className={styles.areaTitle}>
            M. R. <em>· 64 · M · caso dimostrativo AB-2026-014</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Profilo aggiornato il 08 mag · ultimo documento 02 mag · ultima
            sincronizzazione Mac principale 5 min fa.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('diario')}>
            <Plus size={12} /> Nuova voce diario
          </button>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('revisione')}>
            <Paperclip size={12} /> Allega documento
          </button>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('turno')}>
            <CalendarClock size={12} /> Pianifica visita
          </button>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('revisione')}>
            <Sparkles size={12} /> Smart Import
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => onOpenArea('handoff')}>
            <Workflow size={13} /> Prepara SISS
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
                Riepilogo clinico (AI)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'source'}
                className={classNames(styles.segItem, view === 'source' && styles.segSelected)}
                onClick={() => setView('source')}
              >
                Documenti originali
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
              <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('diario')}>
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
            <h2 className={styles.panelTitle}>Evidenze recenti</h2>
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
            Documento in coda · estratti rivedibili prima di portarli nella scheda.
          </p>
          <div className={styles.compositeCard}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} color="var(--ink-muted)" />
              <span className={styles.evidenceTitle}>Referto cardiologico — DOC-2026-241</span>
            </header>
            <span className={styles.rowSub}>3 campi aggiornabili · 2 note da riconciliare · 1 bloccato</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <PillBadge variant="green">farmaco riconosciuto AIFA</PillBadge>
              <PillBadge variant="blue">diagnosi codificata ICD</PillBadge>
              <PillBadge variant="yellow">posologia incerta</PillBadge>
              <PillBadge variant="coral">SISS bloccato</PillBadge>
            </div>
            <button type="button" className={styles.ghostBtnSm} style={{ alignSelf: 'flex-start' }} onClick={() => onOpenArea('revisione')}>
              Apri documenti
              <ChevronRight size={13} />
            </button>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Prossimi passaggi</h2>
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
              title: 'Scale e misure',
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

/* @Codex */
function LiveDocumentReviewArea({
  patient,
  workspace,
  onOpenArea,
}: {
  patient?: Kree8Patient | null;
  workspace?: Kree8PatientWorkspace | null;
  onOpenArea: (area: AreaId) => void;
}) {
  const isWorkspaceLoading = workspace === undefined;
  const codingHints = workspace?.codingHints ?? [];
  const documentNames = workspace?.recentAttachmentNames ?? [];

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Revisione documenti</p>
          <h1 className={styles.areaTitle}>
            Coda clinica <em>· codifiche, evidenze, allegati</em>
          </h1>
          <p className={styles.areaSubtitle}>
            {patient
              ? `Contesto aperto su ${patient.name}: rivedi documenti e suggerimenti prima di aggiornare la scheda.`
              : 'Seleziona un paziente per vedere documenti, codifiche e suggerimenti collegati.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('incarico')}>
            <Inbox size={12} />
            Scegli paziente
          </button>
          {patient ? (
            <Link href={`${patient.modulesHref}#documenti`} className={styles.primaryBtn}>
              <ArrowUpRight size={13} />
              Apri documenti
            </Link>
          ) : null}
        </div>
      </header>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Documenti</span>
          <span className={styles.statValue}>{workspace === undefined ? '…' : workspace?.attachmentsCount ?? 0}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>allegati del caso</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Sintesi</span>
          <span className={styles.statValue}>{workspace === undefined ? '…' : workspace?.documentInsightCount ?? 0}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>evidenze estratte</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Codifiche</span>
          <span className={styles.statValue}>{workspace === undefined ? '…' : codingHints.length}</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>da confermare</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Repertori</span>
          <span className={styles.statValue}>3</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>AIFA, esenzioni, ICD</span>
        </div>
      </div>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Documenti del caso</h2>
            <PillBadge variant="muted">{documentNames.length} recenti</PillBadge>
          </header>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {isWorkspaceLoading ? (
              <p className={styles.panelSubtitle}>Caricamento documenti del paziente.</p>
            ) : documentNames.length ? documentNames.map((name) => (
              <div key={name} className={styles.compositeCard}>
                <header className={styles.panelHeader}>
                  <FileText size={14} color="var(--ink-muted)" />
                  <span className={styles.evidenceTitle}>{name}</span>
                  <PillBadge variant="blue">da leggere</PillBadge>
                </header>
                <p className={styles.rowSub} style={{ margin: 0 }}>
                  Apri la scheda paziente per allegati, OCR e sintesi clinica.
                </p>
              </div>
            )) : (
              <p className={styles.panelSubtitle}>Nessun documento recente agganciato al paziente selezionato.</p>
            )}
          </div>
        </section>

        <section className={styles.panelInset}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Suggerimenti AI</h2>
            <PillBadge variant={codingHints.length ? 'violet' : 'green'}>
              {codingHints.length ? 'review' : 'ok'}
            </PillBadge>
          </header>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {isWorkspaceLoading ? (
              <p className={styles.panelSubtitle}>Caricamento suggerimenti e codifiche.</p>
            ) : codingHints.length ? codingHints.map((hint) => (
              <div key={hint} className={styles.evidenceItem}>
                <Sparkles size={14} color="var(--pill-violet-fg)" />
                <span>
                  <span className={styles.evidenceTitle}>{hint}</span>
                  <span className={styles.evidenceSnippet}>Conferma con evidenza prima di scrivere in scheda.</span>
                </span>
              </div>
            )) : (
              <p className={styles.panelSubtitle}>Nessun suggerimento in primo piano per il paziente selezionato.</p>
            )}
          </div>
          <div className={styles.caseLensActions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('cataloghi')}>
              <Database size={12} />
              Repertori
            </button>
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('scheda')}>
              <UserSquare2 size={12} />
              Torna alla scheda
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* @Codex */
function isSissPatientContextHandoffResult(
  payload: unknown,
): payload is SissPatientContextHandoffResult {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as Partial<SissPatientContextHandoffResult>;
  return candidate.status === 'handoff'
    && typeof candidate.action === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.handoffUrl === 'string'
    && typeof candidate.correlationId === 'string'
    && typeof candidate.message === 'string';
}

/* @Codex */
function LiveHandoffArea({
  patient,
  onOpenArea,
}: {
  patient?: Kree8Patient | null;
  onOpenArea: (area: AreaId) => void;
}) {
  const [activeAction, setActiveAction] = useState<SissPatientContextAction | null>(null);
  const [feedback, setFeedback] = useState<HandoffFeedback | null>(null);
  const fiscalCodeReady = patient ? patient.code !== 'CF non disponibile' : false;

  const startHandoff = async (action: SissPatientContextAction) => {
    if (!patient) {
      setFeedback({
        kind: 'error',
        message: 'Seleziona un paziente prima di aprire un portale regionale.',
      });
      return;
    }
    if (!fiscalCodeReady && action !== 'menu.open') {
      setFeedback({
        kind: 'warning',
        message: 'Il modulo prescrittivo richiede un codice fiscale valido nel profilo paziente.',
      });
      return;
    }

    setActiveAction(action);
    setFeedback(null);
    const popupWindow = prepareSissPortalWindow();
    if (!popupWindow) {
      setFeedback({
        kind: 'error',
        message: 'Popup SISS bloccato dal browser. Consenti i popup e riprova.',
      });
      setActiveAction(null);
      return;
    }

    try {
      const response = await fetch('/api/siss/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: patient.id, action }),
      });
      const payload = await response.json().catch(() => null) as unknown;

      if (!response.ok) {
        popupWindow.close();
        const errorPayload = payload && typeof payload === 'object'
          ? payload as { error?: unknown; correlationId?: unknown }
          : null;
        setFeedback({
          kind: 'error',
          message: typeof errorPayload?.error === 'string'
            ? errorPayload.error
            : 'Flusso SISS non disponibile.',
          correlationId: typeof errorPayload?.correlationId === 'string'
            ? errorPayload.correlationId
            : null,
        });
        return;
      }

      if (!isSissPatientContextHandoffResult(payload)) {
        popupWindow.close();
        throw new Error('Risposta SISS non valida');
      }

      const handoffResult = await completeSissPortalHandoff({
        handoffUrl: payload.handoffUrl,
        clipboardText: payload.clipboardText ?? undefined,
        successMessage: payload.message,
        popupWindow,
      });

      if (!handoffResult.opened) {
        popupWindow.close();
      }

      setFeedback({
        kind: handoffResult.success ? 'success' : handoffResult.opened ? 'warning' : 'error',
        message: `${payload.title}: ${handoffResult.message}`,
        correlationId: payload.correlationId,
      });

      if (handoffResult.opened) {
        const now = new Date();
        void db.sissHandoffs.add({
          id: crypto.randomUUID(),
          patientId: patient.id,
          action,
          moduleLabel: payload.title,
          reason: 'Portale regionale aperto dalla scheda MediFlow.',
          startedAt: now,
          outcome: 'started',
          correlationId: payload.correlationId,
          createdAt: now,
          updatedAt: now,
        }).catch((error) => {
          console.warn('[MediFlow] Kree8 SISS handoff diary write failed:', error);
        });
      }
    } catch (error) {
      popupWindow.close();
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Errore inatteso nel flusso SISS.',
      });
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Portali regionali (SISS)</p>
          <h1 className={styles.areaTitle}>
            Preparazione SISS <em>· contesto paziente e diario</em>
          </h1>
          <p className={styles.areaSubtitle}>
            {patient
              ? `Contesto aperto su ${patient.name}: prepara consenso, azione regionale e nota di esito.`
              : 'Seleziona un paziente prima di preparare un passaggio verso i portali regionali.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('incarico')}>
            <Inbox size={12} />
            Scegli paziente
          </button>
          {patient ? (
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={activeAction === 'prescription.create' || !fiscalCodeReady}
              onClick={() => void startHandoff('prescription.create')}
            >
              <Workflow size={13} />
              {!fiscalCodeReady
                ? 'CF richiesto'
                : activeAction === 'prescription.create'
                  ? 'Apertura…'
                  : 'Apri modulo SISS'}
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.threeCol}>
        {[
          { title: 'Identità e consenso', sub: patient ? `${patient.code} · ${patient.ageLabel}` : 'paziente non selezionato', pill: fiscalCodeReady ? 'pronto' : 'attesa', variant: fiscalCodeReady ? 'green' as const : 'muted' as const },
          { title: 'Azione regionale', sub: 'prepara portale ufficiale e contesto locale', pill: 'assistita', variant: 'blue' as const },
          { title: 'Esito', sub: 'registra risultato e prossima azione in diario', pill: 'diario', variant: 'violet' as const },
        ].map((item) => (
          <section key={item.title} className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>{item.title}</h2>
              <PillBadge variant={item.variant}>{item.pill}</PillBadge>
            </header>
            <p className={styles.panelSubtitle}>{item.sub}</p>
          </section>
        ))}
      </div>

      <section className={styles.panelInset}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Azioni rapide</h2>
          <PillBadge variant="muted">portali ufficiali</PillBadge>
        </header>
        <div className={styles.caseLensActions} style={{ marginTop: 12 }}>
          <Link href="/settings#data" className={styles.ghostBtnSm}>
            <Database size={12} />
            Gestisci repertori
          </Link>
          {patient ? (
            <Link href={patient.href} className={styles.ghostBtnSm}>
              <UserSquare2 size={12} />
              Quadro paziente
            </Link>
          ) : (
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('incarico')}>
              <UserSquare2 size={12} />
              Scegli paziente
            </button>
          )}
          {patient ? (
            <Link href={`${patient.href}/entries/new`} className={styles.ghostBtnSm}>
              <Plus size={12} />
              Nota esito
            </Link>
          ) : null}
        </div>
        {feedback ? (
          <div className={styles.compositeCard} style={{ marginTop: 12 }}>
            <header className={styles.panelHeader}>
              <span className={styles.evidenceTitle}>
                {feedback.kind === 'success'
                  ? 'Portale aperto'
                  : feedback.kind === 'warning'
                    ? 'Passaggio da completare'
                    : 'Portale non avviato'}
              </span>
              <PillBadge
                variant={
                  feedback.kind === 'success'
                    ? 'green'
                    : feedback.kind === 'warning'
                      ? 'yellow'
                      : 'coral'
                }
              >
                /api/siss/context
              </PillBadge>
            </header>
            <p className={styles.rowSub} style={{ margin: 0 }}>
              {feedback.message}
              {feedback.correlationId ? ` · ${feedback.correlationId}` : ''}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* @Codex */
function LiveGovernanceArea({
  patientCount,
}: {
  patientCount: number;
}) {
  const settingsLinks: Array<{
    href: string;
    title: string;
    sub: string;
    icon: typeof KeyRound;
    pill: string;
    variant: PillVariant;
  }> = [
    {
      href: '/settings#status',
      title: 'Stato postazione',
      sub: 'stato sessione, servizi e dati locali',
      icon: Activity,
      pill: 'operativo',
      variant: 'green',
    },
    {
      href: '/settings#account',
      title: 'Account e PIN di sblocco',
      sub: 'profilo medico, ambulatorio e rotazione PIN',
      icon: KeyRound,
      pill: 'locale',
      variant: 'muted',
    },
    {
      href: '/settings#ai',
      title: 'Modelli AI locali',
      sub: 'provider, modelli attivi e controlli di sicurezza',
      icon: Sparkles,
      pill: 'controlli attivi',
      variant: 'violet',
    },
    {
      href: '/settings#backups',
      title: 'Backup cifrati',
      sub: 'schedulazione, ripristino e prove operative',
      icon: HardDrive,
      pill: 'manuale',
      variant: 'blue',
    },
    {
      href: '/settings#data',
      title: 'Repertori clinici',
      sub: 'AIFA, ICD ed esenzioni locali',
      icon: Database,
      pill: 'dati locali',
      variant: 'green',
    },
    {
      href: '/settings#operations',
      title: 'Diagnostica e servizi',
      sub: 'servizi locali, manutenzione e app nativa',
      icon: Activity,
      pill: 'Mac locale',
      variant: 'muted',
    },
    {
      href: '/settings#appearance',
      title: 'Lettura e accessibilità',
      sub: 'riduzione movimento, leggibilità e stile UI',
      icon: SettingsIcon,
      pill: 'preferenze',
      variant: 'yellow',
    },
  ];

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Sistema e impostazioni</p>
          <h1 className={styles.areaTitle}>
            Stato operativo <em>· sessione, audit, backup</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Sessione, audit e backup gestiti in locale. I dati clinici non lasciano il dispositivo.
          </p>
        </div>
      </header>

      <div className={styles.threeCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Sessione</h2>
            <PillBadge variant="green">attiva</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>{patientCount} pazienti disponibili in elenco.</p>
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Audit</h2>
            <PillBadge variant="muted">locale</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>Eventi append-only consultabili dalle impostazioni di sistema.</p>
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Backup</h2>
            <PillBadge variant="blue">Mac principale</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>Backup e ripristino restano operazioni esplicite sul Mac.</p>
        </section>
      </div>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Apri una sezione precisa</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="green">nessun controllo distruttivo qui</PillBadge>
          </span>
        </header>
        <p className={styles.panelSubtitle}>
          Ogni voce apre direttamente la sezione di impostazioni dove si cambia
          configurazione, si importano cataloghi o si avvia un controllo.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginTop: 12 }}>
          {settingsLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={styles.compositeCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={styles.modeIcon}><Icon size={15} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span className={styles.modeTitle}>{item.title}</span>
                    <br />
                    <span className={styles.modeSub}>{item.sub}</span>
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    <PillBadge variant={item.variant}>{item.pill}</PillBadge>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ───────────────────────── Diario clinico ───────────────────────── */

/* @Codex */
function DiarioArea({
  diaryState,
  onOpenArea,
}: {
  diaryState: Kree8DiaryClientState;
  onOpenArea: (area: AreaId) => void;
}) {
  const isLoading = diaryState.status === 'loading' || diaryState.status === 'idle';
  const visibleEntries = diaryState.entries;

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Diario clinico</p>
          <h1 className={styles.areaTitle}>
            Ultime voci del lavoro clinico <em>· dati locali reali</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Cronologia delle ultime 50 voci cliniche salvate in MediFlow, con
            rientro immediato nel quadro del paziente.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('incarico')}>
            <Inbox size={12} />
            Scegli paziente
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => onOpenArea('scheda')}>
            <UserSquare2 size={13} />
            Apri quadro
          </button>
          <PillBadge variant="blue">{isLoading ? '…' : `${diaryState.activeCount} attive`}</PillBadge>
          <PillBadge variant="muted">{isLoading ? '…' : `${diaryState.patientCount} pazienti`}</PillBadge>
        </div>
      </header>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Timeline recente</h2>
          <PillBadge variant="muted">{visibleEntries.length} voci</PillBadge>
          <span className={styles.panelActions}>
            <PillBadge variant="green">dati locali</PillBadge>
          </span>
        </header>

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {isLoading ? (
            <p className={styles.panelSubtitle}>Caricamento diario clinico locale.</p>
          ) : visibleEntries.length ? visibleEntries.map((entry) => (
            <article key={entry.id} className={styles.compositeCard}>
              <header className={styles.panelHeader}>
                <span className={styles.evidenceDate}>{entry.dateLabel}</span>
                <span className={styles.evidenceTitle}>{entry.title}</span>
                <span className={styles.panelActions}>
                  <PillBadge variant={entry.deleted ? 'coral' : 'blue'}>{entry.typeLabel}</PillBadge>
                </span>
              </header>
              <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.55 }}>
                {entry.preview}
              </p>
              <div className={styles.identityDock}>
                <span className={styles.patientName}>{entry.patientName}</span>
                <PillBadge variant="muted">{entry.patientCode}</PillBadge>
                {entry.attachmentCount > 0 ? (
                  <PillBadge variant="violet">
                    <Paperclip size={11} />
                    {entry.attachmentCount} allegati
                  </PillBadge>
                ) : null}
                <span className={styles.dockActions}>
                  <Link href={entry.patientHref} className={styles.ghostBtnSm}>
                    <UserSquare2 size={12} />
                    Apri quadro
                  </Link>
                  <Link href={`${entry.patientHref}/entries/new`} className={styles.ghostBtnSm}>
                    <Plus size={12} />
                    Nuova voce
                  </Link>
                </span>
              </div>
            </article>
          )) : (
            <p className={styles.panelSubtitle}>Nessuna voce clinica nel diario locale.</p>
          )}
        </div>
      </section>
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
          <p className={styles.areaCaption}>Revisione documento</p>
          <h1 className={styles.areaTitle}>
            Referto cardiologico <em>· document #DOC-2026-241</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Conferma cosa applicare alla scheda. Nessun aggiornamento automatico:
            ogni decisione resta nell&apos;audit locale.
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
            Porta nella scheda
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
            <b>{structuredWrites}</b> campi aggiornabili
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
                  ? 'campo aggiornabile'
                  : f.kind === 'note'
                    ? 'solo nota'
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

/* ───────────────────────── Cataloghi ───────────────────────── */

function CataloghiArea({ isReview }: { isReview: boolean }) {
  const [selectedCatalogId, setSelectedCatalogId] = useState(REVIEW_CATALOGS[0]?.id ?? '');
  const catalogState = useLiveQuery<Kree8CatalogClientState, Kree8CatalogClientState>(
    async () => {
      if (isReview) return REVIEW_CATALOG_STATE;
      try {
        const [drugCount, exemptionCount] = await Promise.all([
          fetchCatalogCount('/api/drugs?count=1'),
          fetchCatalogCount('/api/exemptions?count=1'),
        ]);
        return buildLiveCatalogState(drugCount, exemptionCount);
      } catch (error) {
        console.error('[MediFlow] Kree8 catalog status failed:', error);
        return {
          status: 'error',
          rows: [],
          indexedCount: 0,
        };
      }
    },
    [isReview],
    isReview ? REVIEW_CATALOG_STATE : {
      status: 'loading',
      rows: [],
      indexedCount: 0,
    },
  );

  const catalogs = catalogState?.rows ?? [];
  const selectedCatalog = catalogs.find((catalog) => catalog.id === selectedCatalogId) ?? catalogs[0];
  const availableCatalogs = catalogs.filter((catalog) => catalog.freshness === 'fresh' || catalog.freshness === 'ok').length;
  const needsImport = catalogs.some((catalog) => catalog.freshness === 'broken');
  const isLoading = catalogState?.status === 'loading' || catalogState?.status === 'idle';
  const freshnessTier: Kree8CatalogFreshness =
    catalogState?.status === 'error' ? 'broken' : needsImport ? 'stale' : 'fresh';
  const freshnessTitle =
    catalogState?.status === 'error'
      ? 'Repertori non leggibili'
      : needsImport
        ? 'Import repertori incompleto'
        : 'Repertori disponibili';
  const freshnessPct = catalogs.length
    ? Math.round((availableCatalogs / catalogs.length) * 100)
    : isLoading
      ? 0
      : 0;
  const freshnessClass = classNames(
    styles.freshness,
    freshnessTier === 'stale' && styles.freshnessStale,
    freshnessTier === 'broken' && styles.freshnessBroken,
  );

  useEffect(() => {
    if (!catalogs.length) return;
    if (!catalogs.some((catalog) => catalog.id === selectedCatalogId)) {
      setSelectedCatalogId(catalogs[0].id);
    }
  }, [catalogs, selectedCatalogId]);

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Repertori clinici · AIFA, esenzioni, ICD</p>
          <h1 className={styles.areaTitle}>
            AIFA, esenzioni e ICD <em>· {isLoading ? 'lettura locale' : `${(catalogState?.indexedCount ?? 0).toLocaleString('it-IT')} record`}</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Accesso rapido ai repertori che servono durante la cartella: farmaci AIFA,
            codici esenzione e diagnostica ICD.
            Import e cancellazioni restano nelle impostazioni complete, con azione
            esplicita dell&apos;operatore.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/settings#data" className={styles.ghostBtn}>
            <Database size={13} />
            Gestisci repertori
          </Link>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={freshnessClass}>
          <Database size={18} color="var(--ink-muted)" />
          <div className={styles.freshnessLabel}>
            <span className={styles.freshnessTitle}>{freshnessTitle}</span>
            <span className={styles.freshnessSub}>
              {isLoading
                ? 'lettura da API locali protette'
                : `${availableCatalogs} di ${catalogs.length} pacchetti disponibili · nessun sync cloud`}
            </span>
          </div>
          <span className={styles.freshnessNum}>{freshnessPct}%</span>
        </div>

        <p className={styles.panelSubtitle}>
          {catalogState?.status === 'error'
            ? 'Impossibile leggere i conteggi locali in questa sessione.'
            : selectedCatalog
              ? `Repertorio selezionato: ${selectedCatalog.name}.`
              : 'Caricamento stato repertori locali.'}
        </p>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Repertori rapidi</h2>
          <PillBadge variant="muted">AIFA · esenzioni · ICD</PillBadge>
          <span className={styles.panelActions}>
            <PillBadge variant="green">servizi locali</PillBadge>
          </span>
        </header>

        <div style={{ marginTop: 8 }}>
          {catalogs.map((c) => {
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
                <button
                  type="button"
                  className={styles.ghostBtnSm}
                  aria-label={`Mostra dettaglio repertorio ${c.name}`}
                  onClick={() => {
                    setSelectedCatalogId(c.id);
                  }}
                >
                  Dettagli
                  <ChevronRight size={13} />
                </button>
              </div>
            );
          })}
          {!catalogs.length ? (
            <p className={styles.panelSubtitle}>Caricamento repertori locali.</p>
          ) : null}
        </div>
        {selectedCatalog && (
          <div className={styles.compositeCard} style={{ marginTop: 12 }}>
            <header className={styles.panelHeader}>
              <span className={styles.evidenceTitle}>{selectedCatalog.name}</span>
              <PillBadge
                variant={{
                  fresh: 'green',
                  ok: 'blue',
                  stale: 'yellow',
                  broken: 'coral',
                  off: 'muted',
                }[selectedCatalog.freshness] as PillVariant}
              >
                selezionato
              </PillBadge>
            </header>
            <p className={styles.rowSub} style={{ margin: 0 }}>
              {selectedCatalog.sub} · aggiornamento {selectedCatalog.age}
            </p>
            {selectedCatalog.href ? (
              <div className={styles.caseLensActions} style={{ marginTop: 10 }}>
                <Link href={selectedCatalog.href} className={styles.ghostBtnSm}>
                  {selectedCatalog.actionLabel ?? 'Apri'}
                  <ArrowUpRight size={12} />
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

/* ───────────────────────── Trasmissioni SISS ───────────────────────── */

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
      'Apri il portale ufficiale del Modulo Prescrittivo Regionale con il CF pronto da incollare.',
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
    reason: 'Modellazione SISS non completa · resta sul portale ufficiale.',
  },
];

function HandoffArea() {
  const [stage, setStage] = useState<StageId>('handoff');
  const currentIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Portali regionali (SISS) · prototipo contestuale</p>
          <h1 className={styles.areaTitle}>
            Webapp regionali ufficiali <em>· nessun modulo SISS nativo</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Passaggi chiari fra identità, consenso, apertura del portale
            ufficiale e registrazione manuale dell&apos;esito. Nessuna
            integrazione SISS nativa certificata oggi.
          </p>
        </div>
      </header>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Portali disponibili</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="muted">5 webapp ufficiali</PillBadge>
            <PillBadge variant="green">CF pronto · solo copia-incolla</PillBadge>
          </span>
        </header>
        <p className={styles.panelSubtitle}>
          Apertura assistita delle webapp ufficiali. Il CF del paziente è
          preparato negli appunti per il copia-incolla.
        </p>
        <div className={styles.launcherGrid}>
          {LAUNCHERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={styles.launcherTile}
              onClick={() => setStage('handoff')}
            >
              <div className={styles.launcherTileHeader}>
                <ArrowUpRight size={14} color="var(--ink-muted)" />
                <span className={styles.evidenceTitle}>{l.label}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <PillBadge variant={l.variant}>apre portale ufficiale</PillBadge>
                </span>
              </div>
              <p className={styles.launcherTileBody}>{l.caption}</p>
              <div className={styles.launcherTileFoot}>
                <PillBadge variant="muted">CF pronto</PillBadge>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  Apri passaggio <ArrowUpRight size={11} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Passaggi SISS</h2>
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
            onStageChange={setStage}
            onAdvance={() => {
              const next = STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, currentIndex + 1)];
              setStage(next);
            }}
          />
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Funzioni non disponibili in MediFlow</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="coral">
              <AlertTriangle size={11} /> scelta dichiarata
            </PillBadge>
          </span>
        </header>
        <p className={styles.panelSubtitle}>
          Confine dichiarato: senza SSI qualificata o stack regionale certificato
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

function HandoffStageBody({
  stage,
  onAdvance,
  onStageChange,
}: {
  stage: StageId;
  onAdvance: () => void;
  onStageChange: (stage: StageId) => void;
}) {
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
          <dd>Operatore locale · medico di medicina generale</dd>
          <dt>Scope ruolo</dt>
          <dd>Ruolo MMG configurato · sessione regionale attiva</dd>
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
          <dd>Paziente selezionato dalla scheda · consenso richiesto prima dell&apos;apertura</dd>
          <dt>Scope consenso</dt>
          <dd>FSE consultazione · 90 giorni</dd>
          <dt>Audit locale</dt>
          <dd>evento <code>consent.granted</code> · timestamp 09:12</dd>
        </dl>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <button type="button" className={styles.ghostBtn} onClick={() => onStageChange('identity')}>
            Registra revoca e torna a identità
          </button>
          <button type="button" className={styles.primaryBtn} onClick={onAdvance}>
            Procedi al portale
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
          <h3 className={styles.panelTitle}>Passaggio al portale ufficiale</h3>
          <span style={{ marginLeft: 'auto' }}>
            <PillBadge variant="blue">via portale SISS</PillBadge>
          </span>
        </header>
        <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.6 }}>
          MediFlow non re-implementa il portale regionale: apre il portale
          ufficiale con scope ridotti e l&apos;esito viene registrato
          manualmente dall&apos;operatore. Nessun viewer FSE embedded, nessun
          modulo prescrittivo interno.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className={styles.primaryBtn} onClick={onAdvance}>
            Apri FSE Viewer ufficiale
            <ArrowUpRight size={13} />
          </button>
          <button type="button" className={styles.ghostBtn} onClick={onAdvance}>
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
          di ricetta, NRE o riferimento incollati dal portale. MediFlow non
          riceve oggi ricevute firmate XML né payload A2A SISS.
        </span>
      </div>
      <dl className={styles.stagePanelKv}>
        <dt>Correlation id</dt>
        <dd><code>hndoff-2026-05-15-7a3c</code></dd>
        <dt>Esito riportato</dt>
        <dd>Prescrizione emessa · NRE incollato manualmente</dd>
        <dt>Trace locale</dt>
        <dd>evento <code>esito.portale.manuale</code> · audit append-only</dd>
      </dl>
      <div style={{ display: 'inline-flex', gap: 8 }}>
        <Link href="/diary" className={styles.primaryBtn}>
          Annota esito sul diario
          <ChevronRight size={14} />
        </Link>
        <Link href="/settings#operations" className={styles.ghostBtn}>
          Esporta audit
        </Link>
      </div>
    </div>
  );
}

/* ───────────────────────── Sistema ───────────────────────── */

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
          <p className={styles.areaCaption}>Sistema · on-device</p>
          <h1 className={styles.areaTitle}>
            Impostazioni operative <em>· nessuna telemetria esterna</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Account, AI locale, modalità di rete, backup, cataloghi e
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
            <Link href="/settings#account" className={styles.ghostBtnSm}>Ruota PIN</Link>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><UserSquare2 size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Profilo MMG</span>
              <br />
              <span className={styles.modeSub}>Operatore configurato · sede locale</span>
            </span>
            <Link href="/settings#account" className={styles.ghostBtnSm}>Modifica</Link>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>AI locale · interruttori</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="violet">
                <Sparkles size={11} /> confronto controllato
              </PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Funzioni AI locali con disattivazione immediata per area. Nessun
            invio cloud nei default.
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
              sub: 'estrazione locale da rivedere · niente aggiornamenti automatici',
            },
            {
              id: 'cloudComparator' as const,
              title: 'Comparatore cloud',
              sub: 'spento di default · solo pacchetti redatti fuori uso clinico',
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
              { name: 'mlx · solo benchmark', tag: 'visibile', variant: 'blue' as const },
              { name: 'openmed · redazione dati', tag: 'osservazione', variant: 'violet' as const },
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
              <PillBadge variant="green">locale di default</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Il lavoro resta sul Mac di default. Il collegamento al Mac principale
            resta opzionale e richiede una LAN fidata.
          </p>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Mac principale</span>
              <span className={styles.toggleRowSub}>
                opt-in su LAN fidata · ambulatorio condiviso · lettura e scrittura governate
              </span>
            </div>
            <button
              type="button"
              aria-pressed={flags.homeBaseNetwork}
              aria-label={`Mac principale ${flags.homeBaseNetwork ? 'attivo' : 'disattivo'}`}
              className={classNames(styles.toggle, flags.homeBaseNetwork && styles.toggleOn)}
              onClick={() => toggle('homeBaseNetwork')}
            />
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><Cloud size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Nodo collegato</span>
              <br />
              <span className={styles.modeSub}>
                Mac principale · LAN locale · ultimo contatto 12 ms
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
            Snapshot cifrato locale + import pacchetti AIFA/ICD. La retention
            degli ultimi backup è gestita dalle impostazioni.
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
            <Link href="/settings#backups" className={styles.ghostBtnSm}>Esegui ora</Link>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><Database size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Import cataloghi</span>
              <br />
              <span className={styles.modeSub}>AIFA · ICD · esenzioni · LOINC manuale</span>
            </span>
            <Link href="/settings#data" className={styles.ghostBtnSm}>Apri import</Link>
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
            Versione applicazione corrente, stato AI locale e prossimo
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
            <Link href="/settings#operations" className={styles.ghostBtnSm}>Cerca aggiornamenti</Link>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><ShieldCheck size={16} /></span>
            <span>
              <span className={styles.modeTitle}>AI parliament</span>
              <br />
              <span className={styles.modeSub}>
                4 modelli censiti · 1 attivo · 3 in osservazione
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
    case 'cataloghi':
      return <CataloghiArea isReview={isReview} />;
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
  const livePatientRows = useLiveQuery<Patient[]>(
    async () => (isReview ? [] : db.patients.toArray()),
    [isReview],
  );

  /* @Codex */
  const liveCheckupRows = useLiveQuery<Checkup[]>(
    async () => (isReview ? [] : db.checkups.toArray()),
    [isReview],
  );

  /* @Codex */
  const liveDiaryRows = useLiveQuery<ClinicalEntry[]>(
    async () => (isReview ? [] : db.entries.orderBy('date').reverse().limit(50).toArray()),
    [isReview],
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
        db.entries.filter((entry) => entry.patientId === patientId).toArray(),
        db.therapies.filter((therapy) => therapy.patientId === patientId).toArray(),
        db.checkups.filter((checkup) => checkup.patientId === patientId).toArray(),
        db.observations.filter((observation) => observation.patientId === patientId).toArray(),
        db.attachments.filter((attachment) => attachment.patientId === patientId).toArray(),
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

    if (!livePatientRows) {
      setPatientState({ status: 'loading', patients: [] });
      setAgendaState({ status: 'loading', rows: [] });
      return;
    }

    const patients = livePatientRows.map(mapPatientForKree8);
    const checkups = liveCheckupRows ?? [];
    setPatientState({ status: 'ready', patients });
    setAgendaState({
      status: liveCheckupRows ? 'ready' : 'loading',
      rows: mapCheckupsForKree8(checkups, patients),
    });
    setSelectedPatientId((current) => {
      if (current && patients.some((patient) => patient.id === current)) return current;
      if (initialPatientId) return initialPatientId;
      return patients[0]?.id;
    });
  }, [initialPatientId, isReview, livePatientRows, liveCheckupRows]);

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
    >
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>MF</span>
          <span className={styles.brandWord}>
            MEDI<b>FLOW</b>
          </span>
          <span className={styles.brandActions}>
            <span className={styles.brandThemeToggle}>
              <ThemeToggle />
            </span>
            <Bell size={14} color="var(--ink-subtle)" />
          </span>
        </div>

        <span className={styles.railLabel}>Navigazione</span>
        {AREAS.filter((a) => PRIMARY_AREA_IDS.includes(a.id)).map((a) => {
          const Icon = a.icon;
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
            >
              <Icon size={15} />
              <span>{a.label}</span>
              {navMeta && <span className={styles.navMeta}>{navMeta}</span>}
              {selected && <ChevronRight size={14} className={styles.navChevron} />}
            </button>
          );
        })}

        <div className={styles.railFooter}>
          <div className={styles.railThemeToggle} aria-label="Tema interfaccia">
            <ThemeToggle />
          </div>
          <span className={styles.railTag}>
            <span className={styles.railDot} />
            Mac principale locale
          </span>
          <span>{isReview ? 'Review design' : 'Dati in locale'}</span>
        </div>
      </aside>

      <section className={styles.canvas}>
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
