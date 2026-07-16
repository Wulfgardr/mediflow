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

import {
  DiagnosisPill,
  PillBadge,
  classNames,
} from '../cockpit-shared';
import type { AreaId } from '../cockpit-shared';
import type { Kree8Patient, Kree8PatientWorkspace } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import documentStyles from '../kree8-clinical-cockpit-document-review.module.css';
import patientStyles from '../kree8-clinical-cockpit-patient-inbox.module.css';


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
            Ultimo aggiornamento {patient.lastTouch}.
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
            <UserSquare2 size={13} /> Apri scheda paziente
          </Link>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={styles.identityDock}>
          {/* @Codex: diagnosi e stato formano una lista nominata; i nomi delle
              voci provengono dal contenuto visibile, non da aria-label. */}
          <ul className={styles.identityChips} aria-label="Diagnosi e stato del paziente">
            {patient.diagnoses.map((diagnosis) => (
              <li key={diagnosis} className={patientStyles.patientDiagnosisPill}>
                <DiagnosisPill diagnosis={diagnosis} />
              </li>
            ))}
            <li>
              <PillBadge variant={patient.status}>
                {patient.statusLabel}
              </PillBadge>
            </li>
            <li><PillBadge variant="neutral">{patient.code}</PillBadge></li>
          </ul>
        </div>

        <div style={{ marginTop: 14 }}>
          <h2 className={styles.panelTitle}>Sintesi del caso</h2>
          <div className={patientStyles.insightBody}>
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
            {isWorkspaceLoading ? 'caricamento archivio' : workspace?.documentInsightCount ? `${workspace.documentInsightCount} sintesi disponibili` : 'nessuna sintesi disponibile'}
          </span>
        </div>
      </div>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Cosa fare ora</h2>
          </header>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <div className={styles.compositeCard}>
              <header className={styles.panelHeader}>
                <span className={styles.evidenceTitle}>Diario clinico</span>
                <PillBadge variant="neutral">{workspace?.entriesCount ?? 0} voci</PillBadge>
              </header>
              <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.55 }}>
                {isWorkspaceLoading
                  ? 'Caricamento diario clinico.'
                  : latestEntry
                  ? `${latestEntry.title} · ${latestEntry.date}`
                  : 'Nessuna voce registrata.'}
              </p>
              <Link href={`${patient.href}/entries/new`} className={styles.ghostBtnSm} style={{ alignSelf: 'flex-start' }}>
                <Plus size={12} />
                Registra passaggio
              </Link>
            </div>

            <div className={styles.compositeCard}>
              <header className={styles.panelHeader}>
                <span className={styles.evidenceTitle}>Terapie e osservazioni</span>
                <PillBadge variant="neutral">{workspace?.activeTherapiesCount ?? 0} attive</PillBadge>
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
                <PillBadge variant={nextCheckup?.pill ?? 'neutral'}>
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
            <PillBadge variant={codingHints.length ? 'warning' : 'success'}>
              {codingHints.length ? `${codingHints.length} da rivedere` : 'allineato'}
            </PillBadge>
          </header>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <div>
              <span className={documentStyles.fieldKind}>AI coding</span>
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
              <span className={documentStyles.fieldKind}>Archivio recente</span>
              {workspace?.recentAttachmentNames.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {workspace.recentAttachmentNames.map((name) => (
                    <div key={name} className={styles.evidenceItem}>
                      <span className={styles.evidenceTitle}>{name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.panelSubtitle}>Nessun documento recente agganciato.</p>
              )}
            </div>

            <div className={patientStyles.caseLensActions}>
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
                Apri scheda paziente
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export { RealPatientArea };
