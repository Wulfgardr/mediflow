import type { ReactNode } from 'react';
import Link from 'next/link';

import { classNames } from '../cockpit-shared';
import patientStyles from '../kree8-clinical-cockpit-patient-inbox.module.css';

/* @Codex #98, #68 */
type QuadroSignal = 'warning' | 'critical';

type QuadroMetric = { label: string; value: string | number; note: string; signal?: QuadroSignal; loading?: boolean };
type QuadroDiagnosis = { code: string; description: string };
type QuadroTherapy = { name: string; dose: string };
type QuadroRow = { title: string; value?: string; note?: string; signal?: QuadroSignal };
type QuadroAction = { label: string; icon: ReactNode; href?: string; onClick?: () => void };

type PatientQuadroProps = {
  headingId: string;
  caption: string;
  name: string;
  atoms: string[];
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
          <p
            className={classNames(patientStyles.quadroAtoms, 'lume-registro')}
            data-testid="lume-quadro-atoms"
          >
            {atoms.map((atom, index) => (
              <span key={`${atom}-${index}`} className={patientStyles.quadroAtomGroup}>
                {index > 0 ? <span className={patientStyles.quadroDot} aria-hidden="true">·</span> : null}
                <span className={patientStyles.quadroAtom} data-testid="lume-quadro-atom">
                  {atom}
                </span>
              </span>
            ))}
          </p>
        </div>
        <QuadroActionControl action={primaryAction} prominence="primary" />
      </header>

      <div className={patientStyles.quadroMetrics} data-testid="lume-quadro-metrics">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className={patientStyles.quadroMetric}
            data-lume-surface="field"
            aria-busy={metric.loading || undefined}
          >
            <p className={patientStyles.quadroMetricLabel} data-testid="lume-quadro-metric-label">
              {metric.label}
            </p>
            {/* @Codex WUL-UIUX: il caricamento è una linea in attesa, non un
                valore finto «in attesa» che sembra un dato. */}
            {metric.loading ? (
              <div aria-hidden="true">
                <div className="mf-skeleton h-5 w-16 mt-2" />
                <div className="mf-skeleton h-3 w-28 mt-2" />
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        ))}
      </div>

      <div className={patientStyles.quadroSectionGrid}>
        <div className={patientStyles.quadroSection} data-testid="lume-quadro-section">
          <p className={patientStyles.quadroSectionLabel}>Diagnosi e sintesi</p>
          <ul className={patientStyles.quadroDiagnoses} aria-label="Diagnosi">
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

export { PatientQuadro };
export type { QuadroAction, QuadroDiagnosis, QuadroMetric, QuadroRow, QuadroTherapy };
