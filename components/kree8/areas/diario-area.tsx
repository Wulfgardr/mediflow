import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import {
  Inbox,
  Paperclip,
  Plus,
  UserSquare2,
} from 'lucide-react';

import { PillBadge } from '../cockpit-shared';
import type { AreaId, Kree8DiaryClientState } from '../cockpit-shared';
import styles from '../kree8-clinical-cockpit-foundation.module.css';


/* ───────────────────────── Diario clinico ───────────────────────── */

/* @Codex */
function DiarioArea({
  diaryState,
  onOpenArea,
  onSelectPatient,
}: {
  diaryState: Kree8DiaryClientState;
  onOpenArea: (area: AreaId) => void;
  onSelectPatient: (patientId: string) => void;
}) {
  const isLoading = diaryState.status === 'loading' || diaryState.status === 'idle';
  const visibleEntries = diaryState.entries;

  const diaryListParentRef = useRef<HTMLDivElement>(null);
  const diaryRowVirtualizer = useVirtualizer({
    count: visibleEntries.length,
    getScrollElement: () => diaryListParentRef.current,
    estimateSize: () => 140,
    overscan: 6,
  });

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Diario clinico</p>
          <h1 className={styles.areaTitle}>
            Ultime voci del lavoro clinico <em>· cronologia locale, tutti i pazienti</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Cronologia delle ultime 50 voci cliniche di tutti i pazienti.
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
          <PillBadge variant="neutral">{isLoading ? '…' : `${diaryState.activeCount} attive`}</PillBadge>
          <PillBadge variant="neutral">{isLoading ? '…' : `${diaryState.patientCount} pazienti`}</PillBadge>
        </div>
      </header>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Timeline recente</h2>
          <PillBadge variant="neutral">{visibleEntries.length} voci</PillBadge>
          <span className={styles.panelActions}>
            <PillBadge variant="neutral">dati locali</PillBadge>
          </span>
        </header>

        <div style={{ marginTop: 12 }}>
          {isLoading ? (
            <p className={styles.panelSubtitle}>Caricamento diario clinico.</p>
          ) : visibleEntries.length ? (
            <div ref={diaryListParentRef} style={{ maxHeight: '70vh', overflow: 'auto' }}>
              <div
                style={{
                  height: `${diaryRowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {diaryRowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = visibleEntries[virtualRow.index];
                  return (
                    <div
                      key={entry.id}
                      ref={diaryRowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        paddingBottom: 10,
                      }}
                    >
                      <article className={styles.compositeCard}>
                        <header className={styles.panelHeader}>
                          <span className={styles.evidenceDate}>{entry.dateLabel}</span>
                          <span className={styles.evidenceTitle}>{entry.title}</span>
                          <span className={styles.panelActions}>
                            <PillBadge variant={entry.deleted ? 'critical' : 'plum'}>{entry.typeLabel}</PillBadge>
                            {/* @Codex WUL-UIUX: lo stato eliminato non puo essere solo colore (WCAG 1.4.1). */}
                            {entry.deleted ? <PillBadge variant="critical">Eliminata</PillBadge> : null}
                          </span>
                        </header>
                        <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.55 }}>
                          {entry.preview}
                        </p>
                        <div className={styles.identityDock}>
                          <span className={styles.patientName}>{entry.patientName}</span>
                          <PillBadge variant="neutral">{entry.patientCode}</PillBadge>
                          {entry.attachmentCount > 0 ? (
                            <PillBadge variant="plum">
                              <Paperclip size={11} />
                              {entry.attachmentCount} allegati
                            </PillBadge>
                          ) : null}
                          <span className={styles.dockActions}>
                            <button
                              type="button"
                              className={styles.ghostBtnSm}
                              onClick={() => {
                                onSelectPatient(entry.patientId);
                                onOpenArea('scheda');
                              }}
                            >
                              <UserSquare2 size={12} />
                              Apri quadro
                            </button>
                            <Link href={`${entry.patientHref}/entries/new`} className={styles.ghostBtnSm}>
                              <Plus size={12} />
                              Nuova voce
                            </Link>
                          </span>
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className={styles.panelSubtitle}>Nessuna voce clinica nel diario locale.</p>
          )}
        </div>
      </section>
    </div>
  );
}

export { DiarioArea };
