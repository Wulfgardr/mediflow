import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarClock,
  Edit3,
  ListChecks,
  Plus,
  Sparkles,
  UserSquare2,
  Workflow,
} from 'lucide-react';

import { classNames } from '../cockpit-shared';
import type { AreaId } from '../cockpit-shared';
import type { Kree8Patient, Kree8PatientWorkspace } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import patientStyles from '../kree8-clinical-cockpit-patient-inbox.module.css';

/* @Codex #98, #68 */
type QuadroSignal = 'warning' | 'critical';

type QuadroMetric = { label: string; value: string | number; note: string; signal?: QuadroSignal };
type QuadroDiagnosis = { code: string; description: string };
type QuadroTherapy = { name: string; dose: string };
type QuadroRow = { title: string; value?: string; note?: string; signal?: QuadroSignal };
type QuadroAction = { label: string; icon: ReactNode; href?: string; onClick?: () => void };

type PatientQuadroProps = {
  headingId: string;
  caption: string;
  name: string;
  atoms: Array<{ value: string; register?: boolean }>;
  status: string;
  diagnoses: QuadroDiagnosis[];
  summary: string;
  metrics: QuadroMetric[];
  therapies: QuadroTherapy[];
  therapiesEmpty: string;
  nextRows: QuadroRow[];
  nextEmpty: string;
  documentRows: QuadroRow[];
  documentsEmpty: string;
  primaryAction: QuadroAction;
  quietActions: QuadroAction[];
};

const SIGNAL_VALUE_CLASSES: Record<QuadroSignal, string> = { warning: patientStyles.quadroMetricWarning, critical: patientStyles.quadroMetricCritical };
const SIGNAL_DOT_CLASSES: Record<QuadroSignal, string> = { warning: patientStyles.quadroSignalWarning, critical: patientStyles.quadroSignalCritical };

function splitDiagnosis(diagnosis: string): QuadroDiagnosis {
  const separatorIndex = diagnosis.indexOf(' · ');
  if (separatorIndex < 0) {
    return { code: 'non codificata', description: diagnosis };
  }
  return { code: diagnosis.slice(0, separatorIndex), description: diagnosis.slice(separatorIndex + 3) };
}

function splitTherapy(therapy: string): QuadroTherapy {
  const [name, ...doseParts] = therapy.split(' · ');
  return { name, dose: doseParts.join(' · ') || 'Dose non registrata' };
}

function QuadroActionControl({
  action,
  prominence,
}: { action: QuadroAction; prominence: 'primary' | 'quiet' }) {
  const className = prominence === 'primary'
    ? patientStyles.quadroPrimaryAction
    : patientStyles.quadroQuietAction;
  const content = <>{action.icon}<span>{action.label}</span></>;

  if (action.href) {
    return (
      <Link href={action.href} className={className} data-lume-action={prominence}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-lume-action={prominence}
      onClick={action.onClick}
    >
      {content}
    </button>
  );
}

function QuadroRows({ rows, empty }: { rows: QuadroRow[]; empty: string }) {
  if (rows.length === 0) {
    return <p className={patientStyles.quadroEmpty}>{empty}</p>;
  }

  return (
    <div className={patientStyles.quadroRows}>
      {rows.map((row) => (
        <div key={`${row.title}-${row.value ?? ''}`} className={patientStyles.quadroRow}>
          <span
            className={classNames(
              patientStyles.quadroSignal,
              row.signal && SIGNAL_DOT_CLASSES[row.signal],
            )}
            aria-hidden="true"
          />
          <span className={patientStyles.quadroRowBody}>
            <span className={patientStyles.quadroRowTitle}>{row.title}</span>
            {row.note ? <span className={patientStyles.quadroRowNote}>{row.note}</span> : null}
          </span>
          {row.value ? (
            <span className={classNames(patientStyles.quadroRowValue, 'lume-registro')}>
              {row.value}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PatientQuadro({
  headingId,
  caption,
  name,
  atoms,
  status,
  diagnoses,
  summary,
  metrics,
  therapies,
  therapiesEmpty,
  nextRows,
  nextEmpty,
  documentRows,
  documentsEmpty,
  primaryAction,
  quietActions,
}: PatientQuadroProps) {
  return (
    <section
      className={patientStyles.quadroFocal}
      aria-labelledby={headingId}
      data-testid="lume-quadro"
    >
      <header className={patientStyles.quadroHeader}>
        <div className={patientStyles.quadroHeading}>
          <p className={patientStyles.quadroCaption}>{caption}</p>
          <h1 id={headingId} className={patientStyles.quadroName}>{name}</h1>
          <p className={patientStyles.quadroAtoms} data-testid="lume-quadro-atoms">
            {atoms.map((atom, index) => (
              <span key={`${atom.value}-${index}`} className={patientStyles.quadroAtomGroup}>
                {index > 0 ? <span className={patientStyles.quadroDot} aria-hidden="true">·</span> : null}
                <span className={atom.register ? 'lume-registro' : undefined}>{atom.value}</span>
              </span>
            ))}
          </p>
        </div>
        <QuadroActionControl action={primaryAction} prominence="primary" />
      </header>

      <div className={patientStyles.quadroMetrics} data-testid="lume-quadro-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className={patientStyles.quadroMetric} data-lume-surface="field">
            <p className={patientStyles.quadroMetricLabel} data-testid="lume-quadro-metric-label">
              {metric.label}
            </p>
            <p
              className={classNames(
                patientStyles.quadroMetricValue,
                'lume-registro',
                metric.signal && SIGNAL_VALUE_CLASSES[metric.signal],
              )}
              data-testid="lume-quadro-metric-value"
              data-lume-signal={metric.signal}
              data-lume-clinical-state={metric.signal}
            >
              {metric.value}
            </p>
            <p className={patientStyles.quadroMetricNote}>{metric.note}</p>
          </div>
        ))}
      </div>

      <div className={patientStyles.quadroSectionGrid}>
        <div className={patientStyles.quadroSection} data-testid="lume-quadro-section">
          <p className={patientStyles.quadroSectionLabel}>Diagnosi e sintesi</p>
          <ul className={patientStyles.quadroDiagnoses} aria-label="Diagnosi e stato del paziente">
            {diagnoses.map((diagnosis) => (
              <li
                key={`${diagnosis.code}-${diagnosis.description}`}
                className={classNames(patientStyles.patientDiagnosisPill, patientStyles.quadroDiagnosis)}
              >
                <span className={classNames(patientStyles.quadroDiagnosisCode, 'lume-registro')}>
                  {diagnosis.code}
                </span>
                <span>{diagnosis.description}</span>
              </li>
            ))}
          </ul>
          <p className={patientStyles.quadroStatus}>
            <span>Stato</span>
            <strong>{status}</strong>
          </p>
          <p className={patientStyles.quadroSummary}>{summary}</p>
        </div>

        <div className={patientStyles.quadroSection} data-testid="lume-quadro-section">
          <p className={patientStyles.quadroSectionLabel}>Terapie attive</p>
          {therapies.length ? (
            <div className={patientStyles.quadroTherapies}>
              {therapies.map((therapy) => (
                <div key={`${therapy.name}-${therapy.dose}`} className={patientStyles.quadroTherapy}>
                  <span className={patientStyles.quadroTherapyName}>{therapy.name}</span>
                  <span className={classNames(patientStyles.quadroTherapyDose, 'lume-registro')}>
                    {therapy.dose}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={patientStyles.quadroEmpty}>{therapiesEmpty}</p>
          )}
        </div>
      </div>

      <div className={patientStyles.quadroSectionGrid}>
        <div className={patientStyles.quadroSection} data-testid="lume-quadro-section">
          <p className={patientStyles.quadroSectionLabel}>Cosa fare ora</p>
          <QuadroRows rows={nextRows} empty={nextEmpty} />
        </div>
        <div className={patientStyles.quadroSection} data-testid="lume-quadro-section">
          <p className={patientStyles.quadroSectionLabel}>Documenti e codifiche</p>
          <QuadroRows rows={documentRows} empty={documentsEmpty} />
        </div>
      </div>

      <div className={classNames(patientStyles.caseLensActions, patientStyles.quadroActions)}>
        {quietActions.map((action) => (
          <QuadroActionControl key={action.label} action={action} prominence="quiet" />
        ))}
      </div>
    </section>
  );
}

function RealPatientArea({
  patient,
  workspace,
  onOpenArea,
}: { patient: Kree8Patient; workspace?: Kree8PatientWorkspace | null; onOpenArea: (area: AreaId) => void }) {
  const isWorkspaceLoading = workspace === undefined;
  const latestEntry = workspace?.latestEntry;
  const nextCheckup = workspace?.nextCheckup;
  const latestObservation = workspace?.latestObservation;
  const codingHints = workspace?.codingHints ?? [];
  const therapies = workspace?.therapyLabels.map(splitTherapy) ?? [];

  const metrics: QuadroMetric[] = [
    {
      label: 'Diario',
      value: isWorkspaceLoading ? 'in attesa' : workspace?.entriesCount ?? 0,
      note: isWorkspaceLoading ? 'Caricamento del diario locale in corso.' : latestEntry ? `${latestEntry.type} · ${latestEntry.date}` : 'Nessuna voce recente.',
    },
    {
      label: 'Terapie attive',
      value: isWorkspaceLoading ? 'in attesa' : workspace?.activeTherapiesCount ?? 0,
      note: isWorkspaceLoading ? 'Caricamento del piano terapeutico in corso.' : therapies[0]?.name ?? 'Nessun piano attivo.',
    },
    {
      label: 'Follow-up',
      value: isWorkspaceLoading ? 'in attesa' : workspace?.pendingCheckupsCount ?? 0,
      note: isWorkspaceLoading ? 'Caricamento dell’agenda locale in corso.' : nextCheckup ? `${nextCheckup.title} · ${nextCheckup.date}` : 'Nessun passaggio aperto.',
    },
    {
      label: 'Documenti',
      value: isWorkspaceLoading ? 'in attesa' : workspace?.attachmentsCount ?? 0,
      note: isWorkspaceLoading ? 'Caricamento dell’archivio locale in corso.' : workspace?.documentInsightCount ? `${workspace.documentInsightCount} sintesi disponibili.` : 'Nessuna sintesi disponibile.',
    },
  ];

  const nextRows: QuadroRow[] = [
    ...(latestEntry ? [{ title: latestEntry.title, value: latestEntry.date, note: latestEntry.type }] : []),
    ...(nextCheckup ? [{
      title: nextCheckup.title,
      value: nextCheckup.date,
      note: nextCheckup.pillLabel,
      signal: nextCheckup.pill === 'critical' || nextCheckup.pill === 'warning' ? nextCheckup.pill : undefined,
    } as QuadroRow] : []),
    ...(latestObservation ? [{ title: latestObservation.label, value: latestObservation.date, note: 'Ultima osservazione registrata' }] : []),
  ];

  const documentRows: QuadroRow[] = [
    ...codingHints.map((hint) => ({ title: hint, note: 'Da rivedere prima di applicare.' })),
    ...(workspace?.recentAttachmentNames ?? []).map((name) => ({ title: name, note: 'Documento recente agganciato.' })),
  ];

  return (
    <div className={styles.areaShell}>
      <PatientQuadro
        headingId="lume-quadro-real-title"
        caption="Quadro paziente"
        name={patient.name}
        atoms={[
          { value: patient.code, register: true },
          { value: patient.ageLabel, register: true },
          { value: patient.pathway },
          { value: `aggiornato ${patient.lastTouch}`, register: true },
        ]}
        status={patient.statusLabel}
        diagnoses={patient.diagnoses.map(splitDiagnosis)}
        summary={patient.summary}
        metrics={metrics}
        therapies={therapies}
        therapiesEmpty={isWorkspaceLoading ? 'Caricamento delle terapie locali in corso.' : 'Nessuna terapia attiva registrata.'}
        nextRows={nextRows}
        nextEmpty={isWorkspaceLoading ? 'Caricamento dei prossimi passaggi in corso.' : 'Nessun passaggio clinico aperto.'}
        documentRows={documentRows}
        documentsEmpty={isWorkspaceLoading ? 'Caricamento di documenti e codifiche in corso.' : 'Nessun documento o codice sospeso.'}
        primaryAction={{
          label: 'Apri scheda paziente',
          icon: <UserSquare2 size={13} />,
          href: patient.modulesHref,
        }}
        quietActions={[
          { label: 'Nuova voce', icon: <Plus size={12} />, href: `${patient.href}/entries/new` },
          { label: 'Anagrafica', icon: <Edit3 size={12} />, href: `${patient.href}/edit` },
          { label: 'Agenda', icon: <CalendarClock size={12} />, onClick: () => onOpenArea('turno') },
          { label: 'Rivedi documenti', icon: <Sparkles size={13} />, href: `${patient.modulesHref}#documenti` },
          { label: 'Scale cliniche', icon: <ListChecks size={12} />, href: `${patient.modulesHref}#scale` },
          { label: 'Contesto SISS', icon: <Workflow size={12} />, href: `${patient.modulesHref}#contesto` },
          { label: 'Apri moduli', icon: <ArrowUpRight size={12} />, href: patient.modulesHref },
        ]}
      />
    </div>
  );
}

export { PatientQuadro, RealPatientArea };
export type { QuadroAction, QuadroDiagnosis, QuadroMetric, QuadroRow, QuadroTherapy };
