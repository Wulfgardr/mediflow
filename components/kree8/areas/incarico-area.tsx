import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import {
  Activity,
  Archive,
  ArrowUpRight,
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
  PillBadge,
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

      <section className={styles.panel}>
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
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca per nome, codice fiscale, diagnosi o nota"
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
      </section>

      <div className={patientStyles.inboxLayout}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              {list === 'attivi' ? 'Pazienti in carico' : 'Archivio pazienti'}
            </h2>
            <PillBadge variant="neutral">{visible.length} risultati</PillBadge>
            <span className={styles.panelActions}>
              <Link href="/patients/new" className={styles.ghostBtnSm}>
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
              <div ref={patientListParentRef} style={{ maxHeight: '70vh', overflow: 'auto' }}>
                <div
                  style={{
                    height: `${patientRowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {patientRowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const p = visible[virtualRow.index];
                    const isSelected = p.id === selected?.id;
                    const dotClass = p.status === 'warning'
                      ? patientStyles.patientDotWarning
                      : patientStyles.patientDotNeutral;
                    return (
                      <div
                        key={p.id}
                        ref={patientRowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className={patientStyles.patientRowWrap}
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
                          aria-pressed={isSelected}
                        >
                          <span className={classNames(patientStyles.patientDot, dotClass)} />
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <span className={patientStyles.patientName}>{p.name}</span>
                            <span className={patientStyles.patientCode}>{p.code} · {p.pathway}</span>
                          </span>
                          {/* @Codex: dentro il button conserviamo il testo naturale;
                              i ruoli annidati sarebbero presentazionali e non una lista reale. */}
                          <span className={patientStyles.patientMeta}>
                            {p.diagnoses.map((d) => (
                              <span key={d} className={patientStyles.patientDiagnosisPill}>
                                <DiagnosisPill diagnosis={d} />
                              </span>
                            ))}
                          </span>
                          <span className={classNames(styles.rowSub, patientStyles.patientLastTouch)}>
                            {p.lastTouch}
                          </span>
                          <span className={patientStyles.patientStatusCell}>
                            <PillBadge variant={p.status}>
                              {p.statusLabel}
                            </PillBadge>
                          </span>
                        </button>
                        <Link
                          href={p.modulesHref}
                          className={patientStyles.patientRowOpen}
                          aria-label={`Apri la scheda di ${p.name}`}
                          onClick={() => onSelectPatient(p.id)}
                        >
                          <ArrowUpRight size={14} />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {selected ? (
        <aside className={patientStyles.caseLens} key={selected.id}>
          <span className={styles.areaCaption}>Anteprima paziente</span>
          <div className={patientStyles.caseLensHero}>
            <span className={patientStyles.caseLensName}>{selected.name}</span>
            <span className={patientStyles.caseLensSub}>
              {selected.ageLabel} · aggiornato {selected.lastTouch}
            </span>
          </div>
          {/* @Codex */}
          <ul aria-label={`Diagnosi e stato di ${selected.name}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selected.diagnoses.map((d) => (
              <li key={d} className={patientStyles.patientDiagnosisPill}>
                <DiagnosisPill diagnosis={d} />
              </li>
            ))}
            <li>
              <PillBadge variant={selected.status}>
                {selected.statusLabel}
              </PillBadge>
            </li>
          </ul>
          <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.6 }}>
            {selected.summary}
          </p>
          <div className={patientStyles.caseLensActions}>
            <Link href={selected.modulesHref} className={styles.primaryBtn}>
              <UserSquare2 size={13} />
              Apri scheda paziente
            </Link>
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('scheda')}>
              <FileSearch size={12} />
              Quadro
            </button>
            <Link href={`${selected.href}/entries/new`} className={styles.ghostBtnSm}>
              <Plus size={12} />
              Nuova voce
            </Link>
            <Link href={`${selected.modulesHref}#documenti`} className={styles.ghostBtnSm}>
              <FileText size={12} />
              Documenti
            </Link>
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('handoff')}>
              <Workflow size={12} />
              Prepara SISS
            </button>
          </div>
        </aside>
        ) : (
          <aside className={patientStyles.caseLens}>
            <span className={styles.areaCaption}>Anteprima paziente</span>
            <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.6 }}>
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
