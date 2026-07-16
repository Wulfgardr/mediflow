import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import {
  Activity,
  Archive,
  Cloud,
  FileSearch,
  FileText,
  MapPin,
  Plus,
  Search,
  UserSquare2,
  Users,
  Workflow,
} from 'lucide-react';

import {
  DiagnosisPill,
  classNames,
  normalizeClinicalSearch,
  patientMatchesSearch,
} from '../cockpit-shared';
import type {
  AreaId,
  InboxScope,
  Kree8PatientStatus,
} from '../cockpit-shared';
import type { InboxList, Kree8Patient } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import patientStyles from '../kree8-clinical-cockpit-patient-inbox.module.css';


/* ───────────────────────── Pazienti in carico ───────────────────────── */

/* @Codex */
const PATIENT_SIGNAL_CLASSES: Record<Kree8Patient['status'], string> = {
  neutral: patientStyles.patientSignalNeutral,
  warning: patientStyles.patientSignalWarning,
  critical: patientStyles.patientSignalCritical,
  success: patientStyles.patientSignalSuccess,
  plum: patientStyles.patientSignalPlum,
};

function IncaricoArea({
  patients,
  patientStatus,
  selectedPatientId,
  searchFocusSignal,
  onSelectPatient,
  onOpenArea,
  isReview,
}: {
  patients: Kree8Patient[];
  patientStatus: Kree8PatientStatus;
  selectedPatientId?: string;
  searchFocusSignal: number;
  onSelectPatient: (patientId: string) => void;
  onOpenArea: (area: AreaId) => void;
  isReview: boolean;
}) {
  const [scope, setScope] = useState<InboxScope>('ambulatorio');
  const [list, setList] = useState<InboxList>('attivi');
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = useMemo(() => normalizeClinicalSearch(query), [query]);

  useEffect(() => {
    if (searchFocusSignal <= 0) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchFocusSignal]);

  const scopedPatients = useMemo(
    () =>
      patients.filter((p) => {
        if (list === 'attivi' && p.list !== 'attivi') return false;
        if (list === 'archivio' && p.list !== 'archivio') return false;
        if (scope === 'tutti') return true;
        if (scope === 'ambulatorio') return p.scope === 'ambulatorio';
        return p.scope === 'network';
      }),
    [patients, scope, list],
  );
  const visible = useMemo(
    () => scopedPatients.filter((patient) => patientMatchesSearch(patient, normalizedQuery)),
    [normalizedQuery, scopedPatients],
  );

  const selected = visible.find((p) => p.id === selectedPatientId) ?? visible[0] ?? null;

  const patientListParentRef = useRef<HTMLDivElement>(null);
  const patientRowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => patientListParentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Ambulatorio e rete locale</p>
          <h1 className={styles.areaTitle}>
            Pazienti in carico <em>· stato, diagnosi e ultimo aggiornamento</em>
          </h1>
          <p className={styles.areaSubtitle}>
            {patientStatus === 'ready'
              ? 'Casi dell’ambulatorio e della rete locale, tra attivi e archivio.'
              : patientStatus === 'error'
                ? 'Lista pazienti non disponibile: verifica sessione e servizi locali.'
                : 'Preparazione della lista pazienti.'}
          </p>
        </div>
      </header>

      <div className={patientStyles.inboxLayout}>
        <section
          className={patientStyles.worklistPanel}
          aria-label={list === 'attivi' ? 'Pazienti in carico' : 'Archivio pazienti'}
          data-testid="lume-worklist"
        >
          <div className={patientStyles.inboxScope}>
            <button
              type="button"
              className={classNames(patientStyles.scopeChip, scope === 'ambulatorio' && patientStyles.scopeChipActive)}
              onClick={() => setScope('ambulatorio')}
            >
              <MapPin size={12} />
              Ambulatorio locale
            </button>
            {/* @Codex WUL-UIUX: in live tutti i pazienti hanno scope 'ambulatorio':
                i filtri Rete locale / Tutti sarebbero affordance morte. Restano nel
                ramo review finche lo scope di rete non e mappato sui dati reali. */}
            {isReview ? (
              <>
                <button
                  type="button"
                  className={classNames(patientStyles.scopeChip, scope === 'network' && patientStyles.scopeChipActive)}
                  onClick={() => setScope('network')}
                >
                  <Cloud size={12} />
                  Rete locale
                </button>
                <button
                  type="button"
                  className={classNames(patientStyles.scopeChip, scope === 'tutti' && patientStyles.scopeChipActive)}
                  onClick={() => setScope('tutti')}
                >
                  <Users size={12} />
                  Tutti gli ambulatori
                </button>
              </>
            ) : null}

            <span className={patientStyles.patientScopeActions}>
              <button
                type="button"
                className={classNames(patientStyles.scopeChip, list === 'attivi' && patientStyles.scopeChipActive)}
                onClick={() => setList('attivi')}
              >
                <Activity size={12} />
                Attivi
              </button>
              <button
                type="button"
                className={classNames(patientStyles.scopeChip, list === 'archivio' && patientStyles.scopeChipActive)}
                onClick={() => setList('archivio')}
              >
                <Archive size={12} />
                Archivio
              </button>
            </span>
          </div>

          <div className={patientStyles.patientSearchRow}>
            <label className={patientStyles.patientSearchField}>
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cerca per nome, codice fiscale o diagnosi"
                aria-label="Cerca nella lista pazienti"
              />
            </label>
            {query ? (
              <button
                type="button"
                className={patientStyles.patientSearchClear}
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
              >
                Cancella
              </button>
            ) : null}
          </div>

          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              {list === 'attivi' ? 'Pazienti in carico' : 'Archivio pazienti'}
            </h2>
            <span className={classNames(patientStyles.resultCount, 'lume-registro')}>
              {visible.length} risultati
            </span>
            <span className={styles.panelActions}>
              <Link href="/patients/new" className={styles.ghostBtnSm} data-lume-action="quiet">
                <Plus size={12} />
                Nuova scheda
              </Link>
            </span>
          </header>

          <div style={{ marginTop: 8 }}>
            {patientStatus === 'loading' && (
              <p className={styles.emptyState}>
                Caricamento pazienti…
              </p>
            )}
            {patientStatus === 'error' && (
              <p className={styles.emptyState}>
                Lista pazienti non disponibile. Verifica sessione e servizi locali.
              </p>
            )}
            {visible.length === 0 && (
              <p className={styles.emptyState}>
                {patientStatus === 'ready' && normalizedQuery
                  ? `Nessun risultato per “${query.trim()}”. Modifica la ricerca o cambia ambito.`
                  : patientStatus === 'ready'
                  ? 'Nessun paziente nell’ambito selezionato.'
                  : 'In attesa dei dati paziente.'}
              </p>
            )}
            {visible.length > 0 && (
              <div
                ref={patientListParentRef}
                className={patientStyles.patientListViewport}
                role="list"
                aria-label="Elenco pazienti in carico"
                data-testid="lume-patient-list"
              >
                <div
                  className={patientStyles.patientList}
                  style={{
                    height: `${patientRowVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {patientRowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const p = visible[virtualRow.index];
                    const isSelected = p.id === selected?.id;
                    return (
                      <div
                        key={p.id}
                        ref={patientRowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className={patientStyles.patientRowWrap}
                        role="listitem"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <button
                          type="button"
                          className={classNames(
                            patientStyles.patientRow,
                            isSelected && patientStyles.patientRowSelected,
                          )}
                          onClick={() => onSelectPatient(p.id)}
                          aria-selected={isSelected}
                          data-testid="lume-patient-row"
                        >
                          <span className={patientStyles.patientRowContent} data-lume-row-part="content">
                            <span className={patientStyles.patientName}>{p.name}</span>
                            <span className={patientStyles.patientSubline}>
                              <span
                                className={classNames(patientStyles.patientCode, 'lume-registro')}
                                data-testid="lume-patient-code"
                              >
                                {p.code}
                              </span>
                              <span className={patientStyles.patientSeparator} aria-hidden="true">·</span>
                              <span className={patientStyles.patientDiagnosisText}>{p.diagnoses.join(' · ')}</span>
                              <span className={patientStyles.patientSeparator} aria-hidden="true">·</span>
                              <span className={patientStyles.patientStatusText}>{p.statusLabel}</span>
                            </span>
                          </span>
                          <span className={patientStyles.patientSide}>
                            <span
                              className={classNames(patientStyles.patientSignal, PATIENT_SIGNAL_CLASSES[p.status])}
                              aria-label={`Stato: ${p.statusLabel}`}
                              title={p.statusLabel}
                              data-lume-row-part="signal"
                            />
                            <span
                              className={classNames(patientStyles.patientWhen, 'lume-registro')}
                              data-testid="lume-patient-when"
                              data-lume-row-part="when"
                            >
                              {p.lastTouch}
                            </span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {selected ? (
          <aside
            className={patientStyles.caseLens}
            key={selected.id}
            aria-label={`Lente paziente: ${selected.name}`}
            data-testid="lume-patient-lens"
          >
            <header className={patientStyles.caseLensHeader}>
              <span className={styles.areaCaption}>Anteprima paziente</span>
              <h2 className={patientStyles.caseLensName}>{selected.name}</h2>
              <p className={classNames(patientStyles.caseLensAtoms, 'lume-registro')} data-testid="lume-patient-atoms">
                <span>{selected.ageLabel}</span>
                <span aria-hidden="true">·</span>
                <span>aggiornato {selected.lastTouch}</span>
                <span aria-hidden="true">·</span>
                <span>{selected.pathway}</span>
              </p>
            </header>
            {/* @Codex: codice e descrizione restano contenuto naturale delle voci. */}
            <ul
              className={patientStyles.caseLensDiagnoses}
              aria-label={`Diagnosi codificate di ${selected.name}`}
              data-lume-diagnosis-list="true"
            >
              {selected.diagnoses.map((d) => (
                <li key={d} className={patientStyles.patientDiagnosisPill}>
                  <DiagnosisPill diagnosis={d} />
                </li>
              ))}
            </ul>
            <p className={patientStyles.caseLensStatus}>
              <span
                className={classNames(patientStyles.patientSignal, PATIENT_SIGNAL_CLASSES[selected.status])}
                aria-hidden="true"
              />
              {selected.statusLabel}
            </p>
            <p className={patientStyles.caseLensSummary}>
              {selected.summary}
            </p>
            <div className={patientStyles.caseLensActions}>
              <Link href={selected.modulesHref} className={styles.primaryBtn} data-lume-action="primary">
                <UserSquare2 size={13} />
                Apri scheda paziente
              </Link>
              <button type="button" className={styles.ghostBtnSm} data-lume-action="quiet" onClick={() => onOpenArea('scheda')}>
                <FileSearch size={12} />
                Quadro
              </button>
              <Link href={`${selected.href}/entries/new`} className={styles.ghostBtnSm} data-lume-action="quiet">
                <Plus size={12} />
                Nuova voce
              </Link>
              <Link href={`${selected.modulesHref}#documenti`} className={styles.ghostBtnSm} data-lume-action="quiet">
                <FileText size={12} />
                Documenti
              </Link>
              <button type="button" className={styles.ghostBtnSm} data-lume-action="quiet" onClick={() => onOpenArea('handoff')}>
                <Workflow size={12} />
                Prepara SISS
              </button>
            </div>
          </aside>
        ) : (
          <aside className={patientStyles.caseLens} aria-label="Lente paziente" data-testid="lume-patient-lens">
            <span className={styles.areaCaption}>Anteprima paziente</span>
            <p className={patientStyles.caseLensEmpty} data-testid="lume-patient-lens-empty">
              {normalizedQuery
                ? 'Nessun paziente corrisponde alla ricerca corrente.'
                : 'Nessun paziente selezionabile in questa vista.'}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

export { IncaricoArea };
