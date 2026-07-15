import Link from 'next/link';
import {
  ArrowUpRight,
  Database,
  FileText,
  Inbox,
  Sparkles,
  UserSquare2,
} from 'lucide-react';

import {
  PillBadge,
  classNames,
} from '../cockpit-shared';
import type { AreaId } from '../cockpit-shared';
import type { Kree8Patient, Kree8PatientWorkspace } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit.module.css';


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
            Documenti del paziente <em>· codifiche, evidenze, allegati</em>
          </h1>
          <p className={styles.areaSubtitle}>
            {patient
              ? `Contesto aperto su ${patient.name}.`
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
          <span className={styles.statValue}>locali</span>
          <span className={classNames(styles.statTrend, styles.statTrendMuted)}>AIFA, esenzioni, ICD</span>
        </div>
      </div>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Documenti del caso</h2>
            <PillBadge variant="neutral">{documentNames.length} recenti</PillBadge>
          </header>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {isWorkspaceLoading ? (
              <p className={styles.panelSubtitle}>Caricamento documenti del paziente.</p>
            ) : documentNames.length ? documentNames.map((name) => (
              <div key={name} className={styles.compositeCard}>
                <header className={styles.panelHeader}>
                  <FileText size={14} color="var(--ink-muted)" />
                  <span className={styles.evidenceTitle}>{name}</span>
                  <PillBadge variant="warning">da leggere</PillBadge>
                </header>
              </div>
            )) : (
              <p className={styles.panelSubtitle}>Nessun documento recente agganciato al paziente selezionato.</p>
            )}
          </div>
        </section>

        <section className={styles.panelInset}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Suggerimenti AI</h2>
            <PillBadge variant={codingHints.length ? 'warning' : 'success'}>
              {codingHints.length ? 'review' : 'ok'}
            </PillBadge>
          </header>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {isWorkspaceLoading ? (
              <p className={styles.panelSubtitle}>Caricamento suggerimenti e codifiche.</p>
            ) : codingHints.length ? codingHints.map((hint) => (
              <div key={hint} className={styles.evidenceItem}>
                <Sparkles size={14} color="var(--lume-ink-muted)" />
                <span>
                  <span className={styles.evidenceTitle}>{hint}</span>
                </span>
              </div>
            )) : (
              <p className={styles.panelSubtitle}>Nessun suggerimento in primo piano per il paziente selezionato.</p>
            )}
          </div>
          <div className={styles.caseLensActions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('repertori')}>
              <Database size={12} />
              Repertori
            </button>
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('scheda')}>
              <UserSquare2 size={12} />
              Torna al quadro
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export { LiveDocumentReviewArea };
