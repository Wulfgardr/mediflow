import Link from 'next/link';
import {
  ArrowUpRight,
  Database,
  FileText,
  Inbox,
  Sparkles,
  UserSquare2,
} from 'lucide-react';

import type { AreaId } from '../cockpit-shared';
import type { Kree8Patient, Kree8PatientWorkspace } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit-document-review.module.css';

/* @Codex Issue 109, riferimento 68 */
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
  const documentInsightCount = workspace?.documentInsightCount ?? 0;
  const hasEvidence = documentNames.length > 0 || codingHints.length > 0 || documentInsightCount > 0;
  const reason = isWorkspaceLoading
    ? 'Il contesto locale è ancora in caricamento.'
    : hasEvidence
      ? `${documentNames.length} documenti recenti · ${documentInsightCount} sintesi locali · ${codingHints.length} richiami da verificare.`
      : 'Non risultano evidenze recenti o codifiche aperte per questo caso.';

  return (
    <div className={styles.area} data-testid="lume-review-area">
      <header className={styles.header}>
        <div>
          <p className={styles.caption}>Revisione documentale</p>
          <h1 className={styles.title}>Evidenza, decisione e prossimo passo</h1>
          <p className={styles.subtitle}>
            {patient
              ? `Un solo flusso di revisione per ${patient.name}, con provenienza e responsabilità leggibili.`
              : 'Seleziona un paziente per aprire il suo flusso di revisione documentale.'}
          </p>
        </div>
      </header>

      <section
        className={styles.caseFlow}
        aria-labelledby="lume-review-case-title"
        data-lume-case="review"
        data-testid="lume-review-case"
      >
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Evidenza</p>
          <h2 id="lume-review-case-title" className={styles.sectionHeading}>
            {patient?.name ?? 'Caso non selezionato'}
          </h2>
          <p className={styles.register} data-lume-register="true">
            Provenienza: archivio locale · Stato: {isWorkspaceLoading ? 'caricamento' : 'da rivedere'} · Sintesi: {documentInsightCount}
          </p>
          <div className={styles.rows} aria-label="Evidenze documentali">
            {isWorkspaceLoading ? (
              <p className={styles.empty}>Caricamento delle evidenze locali.</p>
            ) : (
              <>
                {documentNames.map((name) => (
                  <div key={name} className={styles.row}>
                    <div className={styles.rowMain}>
                      <FileText size={14} aria-hidden="true" />
                      <span className={styles.rowTitle}>{name}</span>
                    </div>
                    <span className={styles.status}>Da leggere</span>
                  </div>
                ))}
                {documentInsightCount > 0 ? (
                  <div className={styles.row}>
                    <div className={styles.rowMain}>
                      <Sparkles size={14} aria-hidden="true" />
                      <span className={styles.rowTitle}>
                        {documentInsightCount} sintesi documentali persistite
                      </span>
                    </div>
                    <span className={styles.status}>Da verificare</span>
                  </div>
                ) : null}
                {documentNames.length === 0 && documentInsightCount === 0 ? (
                  <p className={styles.empty}>Nessuna evidenza documentale agganciata al caso.</p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>Decisione</p>
          <h3 className={styles.sectionHeading}>
            {codingHints.length ? 'Richiami di codifica da verificare' : 'Nessun richiamo di codifica aperto'}
          </h3>
          <p className={styles.sectionCopy}>{reason}</p>
          {codingHints.length ? (
            <div className={styles.rows} aria-label="Richiami di codifica da verificare">
              {codingHints.map((hint) => (
                <div key={hint} className={styles.row}>
                  <div className={styles.rowMain}>
                    <Sparkles size={14} aria-hidden="true" />
                    <span className={styles.rowTitle}>{hint}</span>
                  </div>
                  <span className={styles.status}>Promemoria</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>Prossimo passo</p>
          <dl className={styles.decisionGrid}>
            <div>
              <dt className={styles.decisionTerm}>Proprietario</dt>
              <dd className={styles.decisionValue}>Medico responsabile del caso</dd>
            </div>
            <div>
              <dt className={styles.decisionTerm}>Motivo</dt>
              <dd className={styles.decisionValue}>{reason}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <button type="button" className={styles.quietAction} onClick={() => onOpenArea('repertori')}>
              <Database size={12} aria-hidden="true" />
              Repertori
            </button>
            {patient ? (
              <button type="button" className={styles.quietAction} onClick={() => onOpenArea('scheda')}>
                <UserSquare2 size={12} aria-hidden="true" />
                Torna al quadro
              </button>
            ) : null}
            {patient ? (
              <Link
                href={`${patient.modulesHref}#documenti`}
                className={styles.primaryAction}
                data-lume-primary="true"
              >
                <ArrowUpRight size={13} aria-hidden="true" />
                Apri documenti
              </Link>
            ) : (
              <button
                type="button"
                className={styles.primaryAction}
                data-lume-primary="true"
                onClick={() => onOpenArea('incarico')}
              >
                <Inbox size={13} aria-hidden="true" />
                Scegli paziente
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export { LiveDocumentReviewArea };
