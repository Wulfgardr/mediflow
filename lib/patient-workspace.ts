/* @Codex */
/* WUL-UIUX Fase 7: pipeline dati del Quadro paziente estratta dal cockpit
   Kree8 (components/kree8/kree8-clinical-cockpit.tsx) in una lib condivisa,
   cosi la Scheda potra importare la stessa pipeline e mostrare numeri identici
   al Quadro. Questo modulo non deve importare nulla dal mondo kree8: solo tipi
   propri e '@/lib/db'. */

import type {
  Attachment,
  Checkup,
  ClinicalEntry,
  Observation,
  Patient,
  Therapy,
} from '@/lib/db';

export type InboxList = 'attivi' | 'archivio';

export type Kree8PatientSource = Partial<Patient> & {
  id: string;
  statusReason?: string | null;
};

export type Kree8Patient = {
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

export type PillVariant = 'blue' | 'yellow' | 'green' | 'coral' | 'muted' | 'violet' | 'ink';

/* @Codex */
export type Kree8PatientWorkspace = {
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

export type Kree8AgendaRow = {
  time: string;
  title: string;
  sub: string;
  pill: 'green' | 'blue' | 'yellow' | 'coral' | 'muted' | 'violet';
  pillLabel: string;
};

export type Kree8CheckupSource = {
  id: string;
  patientId: string;
  date: string | Date;
  title: string;
  notes?: string | null;
  status?: string | null;
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

export function parseDiagnosisLabels(value: unknown): string[] {
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

export function formatCheckupTime(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function isSameCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function classifyCheckupPill(checkup: Kree8CheckupSource): Pick<Kree8AgendaRow, 'pill' | 'pillLabel'> {
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

export function mapCheckupsForKree8(
  checkups: Kree8CheckupSource[],
  patients: Kree8Patient[],
): Kree8AgendaRow[] {
  const patientById = new Map(patients.map((patient) => [patient.id, patient]));

  /* @Codex WUL-UIUX: "Agenda di oggi" deve mostrare oggi e i prossimi passaggi,
     non i checkup piu vecchi dell'archivio. Escludiamo annullati e conclusi e le
     date anteriori a inizio giornata; l'ordine ascendente e lo slice arrivano dopo
     il filtro. Il conteggio "di oggi" si calcola sull'intero set filtrato. */
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return checkups
    .filter((checkup) => {
      if (checkup.status === 'cancelled' || checkup.status === 'completed') return false;
      const date = new Date(checkup.date);
      if (Number.isNaN(date.getTime())) return false;
      return date.getTime() >= startOfToday.getTime();
    })
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
          : 'Paziente non presente nell’elenco pazienti',
        ...pill,
      };
    });
}

/* @Codex WUL-UIUX: appuntamenti di oggi (non annullati/conclusi) sull'intero set. */
export function countTodayCheckups(checkups: Kree8CheckupSource[]): number {
  const now = new Date();
  return checkups.filter((checkup) => {
    if (checkup.status === 'cancelled' || checkup.status === 'completed') return false;
    const date = new Date(checkup.date);
    return !Number.isNaN(date.getTime()) && isSameCalendarDay(date, now);
  }).length;
}

/* @Codex WUL-UIUX: passaggi pianificati (oggi + futuri, non annullati/conclusi)
   sull'intero set, stesso filtro di mapCheckupsForKree8 ma senza lo slice(0,6),
   cosi la testata dichiara il carico reale della giornata e non solo le righe viste. */
export function countPlannedCheckups(checkups: Kree8CheckupSource[]): number {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return checkups.filter((checkup) => {
    if (checkup.status === 'cancelled' || checkup.status === 'completed') return false;
    const date = new Date(checkup.date);
    return !Number.isNaN(date.getTime()) && date.getTime() >= startOfToday.getTime();
  }).length;
}

/* @Codex */
export function formatWorkspaceDate(value: string | Date | null | undefined): string {
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
export function clinicalEntryTypeLabel(type: ClinicalEntry['type'] | undefined): string {
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
export function summarizeObservation(observation: Observation): string {
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
export function buildPatientWorkspace({
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
