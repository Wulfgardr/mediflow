import { InkState } from '@/components/ui/ink-state';
import { formatCountLabel } from '@/lib/format-count';
import surface from '@/components/record-surface.module.css';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  Ellipsis,
  Paperclip,
  Plus,
  UserSquare2,
} from 'lucide-react';

import { ViewState } from '@/components/ui/view-state';
import { PatientSheetMenu } from '@/components/patient-sheet-menu';
import type { AreaId, Kree8DiaryClientState, Kree8DiaryEntry } from '../cockpit-shared';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import diaryStyles from './diario-area.module.css';

const ENTRY_STATE_PILL: Record<NonNullable<Kree8DiaryEntry['presentation']>['state'], string> = {
  draft: surface.pillWarning,
  signed: surface.pillSuccess,
  recorded: surface.pillNeutral,
  unrecognized: surface.pillNeutral,
  unreadable: surface.pillCritical,
  deleted: surface.pillCritical,
};

function DiarioArea({
  diaryState,
  onOpenArea,
  onSelectPatient,
  onRetry,
  commandTrigger,
}: {
  diaryState: Kree8DiaryClientState;
  onOpenArea: (area: AreaId) => void;
  onSelectPatient: (patientId: string) => void;
  onRetry?: () => void;
  commandTrigger?: ReactNode;
}) {
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

  const months = visibleEntries.reduce<Array<{ label: string; entries: Array<{ entry: Kree8DiaryEntry; index: number }> }>>((groups, entry, index) => {
    const label = monthLabel(entry);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.entries.push({ entry, index });
    else groups.push({ label, entries: [{ entry, index }] });
    return groups;
  }, []);

  return (
    <div className={`${surface.page} ${diaryStyles.page}`} data-record-page data-testid="lume-diario">
      <header className={surface.pageHeader}>
        <div className={surface.pageHeading}>
          <h1 className={surface.pageTitle}>Diario</h1>
          <p className={surface.pageMeta}>
            {!hasSnapshot ? '…' : `${formatCountLabel(visibleEntries.length, 'voce', 'voci')} · ${formatCountLabel(diaryState.patientCount, 'paziente', 'pazienti')}`}
          </p>
        </div>
        <div className={surface.pageActions}>
          {onRetry && diaryState.canRefresh && diaryState.status !== 'error' && <button type="button" className="mf-button-secondary" disabled={isLoading} onClick={onRetry}>Aggiorna</button>}
          {commandTrigger}
        </div>
      </header>

      <div className={diaryStyles.tools}>
        <input className={surface.field} type="search" aria-label="Cerca nel diario" placeholder="Cerca paziente o contenuto" value={query} onChange={event => setQuery(event.target.value)} />
        <div className={surface.segmented} role="group" aria-label="Tipo di voce">{entryTypes.map(type => <button key={type} type="button" aria-pressed={entryType === type} onClick={() => setEntryType(type)}>{type}</button>)}</div>
      </div>
      <section className={surface.tray} data-record-tray="diario" aria-labelledby="diario-timeline-title" aria-busy={isLoading}>
        <h2 id="diario-timeline-title" className={surface.zoneTitle}>Voci recenti</h2>

        {isLoading && <ViewState state="loading" title="Caricamento diario clinico."
          detail={hasSnapshot ? 'Aggiornamento del diario in corso. Sono mostrate le ultime voci lette.' : undefined} />}
        {diaryState.status === 'error' && <ViewState state="error" title="Diario clinico non disponibile."
          detail={[hasSnapshot ? 'Impossibile aggiornare il diario. Sono mostrate le ultime voci lette.' : '',
            diaryState.patientsUnavailable ? 'Impossibile aggiornare i dati dei pazienti per il diario.' : ''].filter(Boolean).join(' ') || undefined}
          action={onRetry ? { label: 'Riprova', onClick: onRetry } : undefined} />}
        {visibleEntries.length > 0 ? (
          <div
            className={diaryStyles.feed}
            role="feed"
            aria-label="Diario clinico globale"
            aria-busy={isLoading}
            data-testid="lume-diario-feed"
          >
            {months.map(month => (
              <div key={month.label} className={`${surface.island} ${diaryStyles.month}`}>
                <div className={surface.islandHeader}>
                  <span className={surface.islandIcon} aria-hidden="true"><CalendarDays size={15} /></span>
                  <h3>{month.label} <span>{month.entries.length}</span></h3>
                </div>
                {month.entries.map(({ entry, index }) => {
                  const presentation = entry.presentation ?? { registration: undefined, source: 'Diario locale', state: entry.deleted ? 'deleted' : 'recorded', stateLabel: entry.deleted ? 'Eliminata' : 'Registrata' };
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
                      <span className={diaryStyles.date} data-lume-entry-part="date">
                        {entry.dateLabel.replace(', ', '\n')}
                      </span>
                      <div className={diaryStyles.titleGroup}>
                        <span className={ENTRY_STATE_PILL[presentation.state]}>{presentation.stateLabel}</span>
                        <h4 id={titleId} className={diaryStyles.entryTitle}>{entry.title}</h4>
                      </div>

                      <p id={descriptionId} className={diaryStyles.preview}>{entry.preview}</p>

                      <div className={diaryStyles.provenance} data-lume-entry-part="provenance">
                        <span>Fonte: {presentation.source}</span>
                        {presentation.author ? <span>Autore: {presentation.author}</span> : null}
                        <span>{entry.typeLabel}</span>
                        {presentation.registration ? <InkState state="dry">{presentation.registration}</InkState> : null}
                      </div>

                      <div className={diaryStyles.entryFooter}>
                        <span className={diaryStyles.patientIdentity}>
                          <strong>{entry.patientName}</strong>
                          <span className="lume-code">{entry.patientCode}</span>
                        </span>
                        {entry.attachmentCount > 0 ? (
                          <span className={diaryStyles.attachmentCount}>
                            <Paperclip size={12} aria-hidden="true" />
                            {formatCountLabel(entry.attachmentCount, 'allegato', 'allegati')}
                          </span>
                        ) : null}
                        <span className={diaryStyles.entryActions}>
                          <button
                            type="button"
                            className={diaryStyles.quietAction}
                            onClick={() => {
                              onSelectPatient(entry.patientId);
                              onOpenArea('scheda');
                            }}
                          >
                            <UserSquare2 size={14} aria-hidden="true" />
                            Apri quadro
                          </button>
                          <PatientSheetMenu label="Azioni" trigger={props => <button {...props} className={diaryStyles.quietAction} aria-label="Azioni"><Ellipsis size={16} aria-hidden="true" /></button>}>
                            <Link role="menuitem" href={`${entry.patientHref}/entries/new`} className={styles.ghostBtnSm}>
                              <Plus size={12} aria-hidden="true" />
                              Nuova voce
                            </Link>
                          </PatientSheetMenu>
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        ) : diaryState.status === 'ready' ? <ViewState state="empty"
          title={query.trim() || entryType !== 'Tutte' ? 'Nessuna voce clinica con questo filtro.' : 'Nessuna voce clinica nel diario locale.'} /> : null}
      </section>
    </div>
  );
}

export { DiarioArea };
