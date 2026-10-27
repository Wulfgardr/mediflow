import { formatCountLabel } from '@/lib/format-count';
import ink from '@/components/ink-secondary.module.css';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import {
  Inbox,
  Ellipsis,
  Paperclip,
  Plus,
  UserSquare2,
} from 'lucide-react';

import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import { PillBadge } from '../cockpit-shared';
import { ViewState } from '@/components/ui/view-state';
import { PatientSheetMenu } from '@/components/patient-sheet-menu';
import type { AreaId, Kree8DiaryClientState, Kree8DiaryEntry } from '../cockpit-shared';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import diaryStyles from './diario-area.module.css';

/* issue 105, riferimento 68 */
function DiarioArea({
  diaryState,
  onOpenArea,
  onSelectPatient,
  onRetry,
}: {
  diaryState: Kree8DiaryClientState;
  onOpenArea: (area: AreaId) => void;
  onSelectPatient: (patientId: string) => void;
  onRetry?: () => void;
}) {
  const { proposal } = useRuntimeTwinDesign();
  const isLoading = diaryState.status === 'loading' || diaryState.status === 'idle';
  const hasSnapshot = diaryState.hasSnapshot ?? diaryState.status === 'ready';
  const [query, setQuery] = useState('');
  const [entryType, setEntryType] = useState('Tutte');
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const entryTypes = ['Tutte', ...new Set(diaryState.entries.map(entry => entry.typeLabel))];
  const visibleEntries = diaryState.entries.filter(entry =>
    (entryType === 'Tutte' || entry.typeLabel === entryType)
    && `${entry.patientName} ${entry.title} ${entry.preview}`.toLocaleLowerCase('it-IT').includes(query.trim().toLocaleLowerCase('it-IT')),
  );
  const monthLabel = (entry: Kree8DiaryEntry) => entry.monthLabel ?? 'Voci recenti';
  const resolvedActiveId = visibleEntries.some((entry) => entry.id === activeEntryId)
    ? activeEntryId
    : visibleEntries[0]?.id;

  return (
    <div className={`${styles.areaShell} ${ink.surface}`} data-testid="lume-diario">
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Diario clinico</p>
          <h1 className={styles.areaTitle}>
            Diario<span aria-hidden="true">.</span>
          </h1>
          <p className={styles.areaSubtitle}>
            Cronologia delle ultime 50 voci cliniche di tutti i pazienti.
          </p>
        </div>
        {!proposal && <div className={styles.headerActions}>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('incarico')}>
            <Inbox size={12} />
            Scegli paziente
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => onOpenArea('scheda')}>
            <UserSquare2 size={13} />
            Apri quadro
          </button>
          <PillBadge variant="neutral">{isLoading ? '…' : formatCountLabel(diaryState.activeCount, 'attiva', 'attive')}</PillBadge>
          <PillBadge variant="neutral">{isLoading ? '…' : formatCountLabel(diaryState.patientCount, 'paziente', 'pazienti')}</PillBadge>
        </div>}
      </header>

      <div className={diaryStyles.tools}>
        <input type="search" aria-label="Cerca nel diario" placeholder="Cerca paziente o contenuto" value={query} onChange={event => setQuery(event.target.value)} />
        <div className={diaryStyles.types} aria-label="Tipo di voce">{entryTypes.map(type => <button key={type} type="button" aria-pressed={entryType === type} onClick={() => setEntryType(type)}>{type}</button>)}</div>
      </div>
      <section className={diaryStyles.timelineSection} aria-labelledby="diario-timeline-title" aria-busy={isLoading}>
        <header className={diaryStyles.sectionHeader}>
          <div>
            <h2 id="diario-timeline-title" className={diaryStyles.sectionTitle}>Voci recenti</h2>
            {!proposal && <p className={diaryStyles.sectionSubtitle}>Un solo Filo connette le voci che appartengono alla sequenza temporale.</p>}
          </div>
          <span className={proposal ? diaryStyles.count : `${diaryStyles.count} lume-registro`}>
            {!hasSnapshot ? '…' : proposal
              ? `${formatCountLabel(visibleEntries.length, 'voce', 'voci')} · ${formatCountLabel(diaryState.patientCount, 'paziente', 'pazienti')}`
              : `${formatCountLabel(visibleEntries.length, 'voce', 'voci')} · dati locali`}
          </span>
          {onRetry && diaryState.canRefresh && diaryState.status !== 'error' && <button type="button" className="mf-button-text" disabled={isLoading} onClick={onRetry}>Aggiorna</button>}
        </header>

        {isLoading && <ViewState state="loading" title="Caricamento diario clinico."
          detail={hasSnapshot ? 'Aggiornamento del diario in corso. Sono mostrate le ultime voci lette.' : undefined} />}
        {diaryState.status === 'error' && <ViewState state="error" title="Diario clinico non disponibile."
          detail={[hasSnapshot ? 'Impossibile aggiornare il diario. Sono mostrate le ultime voci lette.' : '',
            diaryState.patientsUnavailable ? 'Impossibile aggiornare i dati dei pazienti per il diario.' : ''].filter(Boolean).join(' ') || undefined}
          action={onRetry ? { label: 'Riprova', onClick: onRetry } : undefined} />}
        {visibleEntries.length > 0 ? (
          <div className={diaryStyles.feedViewport}>
            <div
              className={diaryStyles.feed}
              role="feed"
              aria-label="Diario clinico globale"
              aria-busy={isLoading}
              data-testid="lume-diario-feed"
            >
              {visibleEntries.map((entry, index) => {
                const presentation = entry.presentation ?? { source: 'Diario locale', state: entry.deleted ? 'deleted' : 'recorded', stateLabel: entry.deleted ? 'Eliminata' : 'Registrata' };
                const isActive = entry.id === resolvedActiveId;
                const titleId = `diario-entry-${index}-title`;
                const descriptionId = `diario-entry-${index}-description`;

                return (
                  <Fragment key={entry.id}>
                  {(index === 0 || monthLabel(visibleEntries[index - 1]) !== monthLabel(entry)) && <h3 className={diaryStyles.month}>{monthLabel(entry)}</h3>}
                  <article
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
                    <div className={diaryStyles.entryTop}>
                      <div className={diaryStyles.titleGroup}>
                        <span className={diaryStyles.stateLabel}>{presentation.stateLabel}</span>
                        <h3 id={titleId} className={diaryStyles.entryTitle}>{entry.title}</h3>
                      </div>
                      <span className={proposal ? diaryStyles.date : `${diaryStyles.date} lume-registro`} data-lume-entry-part="date">
                        {entry.dateLabel.replace(', ', '\n')}
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
                        <span className="lume-code">{entry.patientCode}</span>
                      </span>
                      {entry.attachmentCount > 0 ? (
                        <span className={diaryStyles.attachmentCount}>
                          <Paperclip size={11} />
                          {formatCountLabel(entry.attachmentCount, 'allegato', 'allegati')}
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
                        <PatientSheetMenu label="Azioni" trigger={props => <button {...props} className={styles.ghostBtnSm} aria-label="Azioni"><Ellipsis size={16} aria-hidden="true" /></button>}>
                          <Link role="menuitem" href={`${entry.patientHref}/entries/new`} className={styles.ghostBtnSm}>
                            <Plus size={12} aria-hidden="true" />
                            Nuova voce
                          </Link>
                        </PatientSheetMenu>
                      </span>
                    </div>
                  </article>
                  </Fragment>
                );
              })}
            </div>
          </div>
        ) : diaryState.status === 'ready' ? <ViewState state="empty"
          title={query.trim() || entryType !== 'Tutte' ? 'Nessuna voce clinica con questo filtro.' : 'Nessuna voce clinica nel diario locale.'} /> : null}
      </section>
    </div>
  );
}

export { DiarioArea };
