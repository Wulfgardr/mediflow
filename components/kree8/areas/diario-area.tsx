import { useState } from 'react';
import Link from 'next/link';
import {
  Inbox,
  Paperclip,
  Plus,
  UserSquare2,
} from 'lucide-react';

import { db, type ClinicalEntry } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { LumeFilo } from '@/components/ui/lume-filo';
import { PillBadge } from '../cockpit-shared';
import type { AreaId, Kree8DiaryClientState, Kree8DiaryEntry } from '../cockpit-shared';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import diaryStyles from './diario-area.module.css';

type DiaryEntryState = 'draft' | 'signed' | 'recorded' | 'deleted';

type DiaryEntryPresentation = {
  author?: string;
  source: string;
  state: DiaryEntryState;
  stateLabel: string;
};

function metadataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function firstText(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function entryPresentation(entry: Kree8DiaryEntry, raw?: ClinicalEntry): DiaryEntryPresentation {
  if (entry.deleted) {
    return { source: 'Diario locale', state: 'deleted', stateLabel: 'Eliminata' };
  }

  const metadata = metadataRecord(raw?.metadata);
  const workflowState = firstText(metadata, ['workflowStatus', 'status'])?.toLocaleLowerCase('it-IT');
  const state: DiaryEntryState = workflowState === 'draft' || workflowState === 'bozza'
    ? 'draft'
    : workflowState === 'signed' || workflowState === 'firmata'
      ? 'signed'
      : 'recorded';
  const settingSource = raw?.setting === 'home'
    ? 'Assistenza domiciliare'
    : raw?.setting === 'hospital'
      ? 'Ospedale'
      : raw?.setting === 'ambulatory'
        ? 'Ambulatorio'
        : undefined;

  return {
    author: firstText(metadata, ['authorName', 'author', 'signedBy']),
    source: firstText(metadata, ['sourceLabel', 'source']) ?? settingSource ?? 'Diario locale',
    state,
    stateLabel: state === 'draft' ? 'Bozza' : state === 'signed' ? 'Firmata' : 'Registrata',
  };
}

/* @Codex issue 105, riferimento 68 */
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
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const rawEntries = useLiveQuery<ClinicalEntry[], ClinicalEntry[]>(
    async () => db.entries.query({ orderBy: 'date', orderDir: 'desc', limit: 50 }).toArray(),
    [],
    [],
    ['entries'],
  ) ?? [];
  const rawEntryById = new Map(rawEntries.map((entry) => [entry.id, entry]));
  const resolvedActiveId = visibleEntries.some((entry) => entry.id === activeEntryId)
    ? activeEntryId
    : visibleEntries[0]?.id;

  return (
    <div className={styles.areaShell} data-testid="lume-diario">
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

      <section className={diaryStyles.timelineSection} aria-labelledby="diario-timeline-title">
        <header className={diaryStyles.sectionHeader}>
          <div>
            <h2 id="diario-timeline-title" className={diaryStyles.sectionTitle}>Timeline recente</h2>
            <p className={diaryStyles.sectionSubtitle}>Un solo Filo connette le voci che appartengono alla sequenza temporale.</p>
          </div>
          <span className={`${diaryStyles.count} lume-registro`}>
            {isLoading ? '…' : `${visibleEntries.length} voci · dati locali`}
          </span>
        </header>

        {isLoading ? (
          <p className={diaryStyles.emptyState}>Caricamento diario clinico.</p>
        ) : visibleEntries.length ? (
          <div className={diaryStyles.feedViewport}>
            <div
              className={diaryStyles.feed}
              role="feed"
              aria-label="Diario clinico globale"
              aria-busy="false"
              data-testid="lume-diario-feed"
            >
              <LumeFilo
                variant="spina"
                nodeCount={visibleEntries.length}
                anchorSelector="[data-lume-diary-node]"
                className={diaryStyles.filo}
              />
              {visibleEntries.map((entry, index) => {
                const presentation = entryPresentation(entry, rawEntryById.get(entry.id));
                const isActive = entry.id === resolvedActiveId;
                const titleId = `diario-entry-${index}-title`;
                const descriptionId = `diario-entry-${index}-description`;

                return (
                  <article
                    key={entry.id}
                    className={diaryStyles.entry}
                    data-active={isActive ? 'true' : 'false'}
                    data-lume-entry-state={presentation.state}
                    data-testid="lume-diario-entry"
                    aria-current={isActive ? 'true' : undefined}
                    aria-labelledby={titleId}
                    aria-describedby={descriptionId}
                    aria-posinset={index + 1}
                    aria-setsize={visibleEntries.length}
                    tabIndex={0}
                    onClick={() => setActiveEntryId(entry.id)}
                    onFocus={() => setActiveEntryId(entry.id)}
                  >
                    <svg
                      className={diaryStyles.node}
                      data-lume-diary-node
                      aria-hidden="true"
                      focusable="false"
                      viewBox="0 0 10 10"
                    >
                      <circle
                        cx="5"
                        cy="5"
                        r="4.25"
                        fill="var(--lume-surface-field)"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    <div className={diaryStyles.entryTop}>
                      <div className={diaryStyles.titleGroup}>
                        <span className={diaryStyles.stateLabel}>{presentation.stateLabel}</span>
                        <h3 id={titleId} className={diaryStyles.entryTitle}>{entry.title}</h3>
                      </div>
                      <span className={`${diaryStyles.date} lume-registro`} data-lume-entry-part="date">
                        {entry.dateLabel}
                      </span>
                    </div>

                    <p id={descriptionId} className={diaryStyles.preview}>{entry.preview}</p>

                    <div className={`${diaryStyles.provenance} lume-registro`} data-lume-entry-part="provenance">
                      <span>Fonte: {presentation.source}</span>
                      {presentation.author ? <span>Autore: {presentation.author}</span> : null}
                      <span>{entry.typeLabel}</span>
                    </div>

                    <div className={diaryStyles.entryFooter}>
                      <span className={diaryStyles.patientIdentity}>
                        <strong>{entry.patientName}</strong>
                        <span className="lume-registro">{entry.patientCode}</span>
                      </span>
                      {entry.attachmentCount > 0 ? (
                        <span className={diaryStyles.attachmentCount}>
                          <Paperclip size={11} />
                          {entry.attachmentCount} allegati
                        </span>
                      ) : null}
                      <span className={diaryStyles.entryActions}>
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
                );
              })}
            </div>
          </div>
        ) : (
          <p className={diaryStyles.emptyState}>Nessuna voce clinica nel diario locale.</p>
        )}
      </section>
    </div>
  );
}

export { DiarioArea };
