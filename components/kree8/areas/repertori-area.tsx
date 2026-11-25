import { formatCountLabel as formatCatalogCount } from '@/lib/format-count';
import { AifaCatalogQuickUpdate } from '@/components/settings/aifa-catalog-quick-update';
import surface from '@/components/record-surface.module.css';
import { PageHeader } from '@/components/ui/page-header';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Database,
} from 'lucide-react';

import { useLiveQueryState } from '@/lib/live-query';
import { ViewState } from '@/components/ui/view-state';
import type {
  Kree8CatalogClientState,
  Kree8CatalogFreshness,
  Kree8CatalogRow,
} from '../cockpit-shared';
import { catalogFreshnessSignal, type SemanticSignal } from '@/lib/ui-semantic-signal';
import type { WhoCatalogStatus } from '@/lib/reference-data/icd11-embedded-store';
import { getICDCatalogStatus, getICDReadiness, icdReadinessMessage } from '@/lib/icd-service';
import type { ICDReadiness } from '@/lib/icd-service';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import repertoriStyles from '../kree8-clinical-cockpit-repertori.module.css';


const SIGNAL_PILL: Record<SemanticSignal, string> = {
  neutral: surface.pillNeutral,
  success: surface.pillSuccess,
  warning: surface.pillWarning,
  critical: surface.pillCritical,
  plum: surface.pillProposal,
};

type CatalogRow = Omit<Kree8CatalogRow, 'freshness'> & { freshness: Kree8CatalogFreshness | 'unreadable' };
type CatalogState = Omit<Kree8CatalogClientState, 'rows' | 'indexedCount'> & { rows: CatalogRow[]; indexedCount: number | null };

const REVIEW_CATALOGS: Kree8CatalogRow[] = [
  {
    id: 'aifa-pt',
    name: 'AIFA · Piani Terapeutici',
    sub: 'PT regionale + condizioni speciali',
    freshness: 'fresh',
    age: '12 g fa',
  },
  {
    id: 'aic',
    name: 'AIFA · AIC farmaci',
    sub: 'pacchetto 7 di 24 disponibile',
    freshness: 'ok',
    age: '3 g fa',
  },
  {
    id: 'exemptions',
    name: 'Esenzioni · regionali',
    sub: 'piano cronicità + reddito',
    freshness: 'stale',
    age: '41 g fa',
  },
  {
    id: 'icd',
    name: 'ICD-11 WHO',
    sub: 'readiness governata · release 2026-01',
    freshness: 'fresh',
    age: '7 g fa',
  },
  {
    id: 'loinc',
    name: 'LOINC IT',
    sub: 'import manuale richiesto',
    freshness: 'broken',
    age: 'mai',
  },
  {
    id: 'rxnorm',
    name: 'RxNORM map',
    sub: 'non abilitato in questa shell',
    freshness: 'off',
    age: '–',
  },
];

const REVIEW_CATALOG_STATE: Kree8CatalogClientState = {
  status: 'ready',
  rows: REVIEW_CATALOGS,
  indexedCount: 0,
};

async function fetchCatalogCount(path: string): Promise<number> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Catalog count failed: ${response.status}`);
  const payload = await response.json() as { count?: unknown };
  return Number(payload.count || 0);
}

function catalogFreshnessFromCount(count: number): Kree8CatalogFreshness {
  return count > 0 ? 'fresh' : 'broken';
}

function buildLiveCatalogState(
  drugCount: number,
  exemptionCount: number,
  icdReadiness: ICDReadiness | null,
  icdCatalog: WhoCatalogStatus | null,
  prosthetics: { count: number; sourceCount: number } | null,
): CatalogState {
  const rows: CatalogRow[] = [
    {
      id: 'aic',
      name: 'AIFA · AIC farmaci',
      sub: drugCount > 0
        ? 'Prontuario farmaci indicizzato nel database locale.'
        : 'Nessun farmaco indicizzato: importa confezioni.csv dalle impostazioni.',
      freshness: catalogFreshnessFromCount(drugCount),
      age: formatCatalogCount(drugCount, 'farmaco', 'farmaci'),
      href: '/settings/repertori',
      actionLabel: drugCount > 0 ? 'Impostazioni' : 'Importa',
    },
    {
      id: 'exemptions',
      name: 'Codifiche esenzioni',
      sub: exemptionCount > 0
        ? 'Catalogo esenzioni disponibile per ricerca anagrafica.'
        : 'Nessuna esenzione indicizzata: importa TXT/CSV dalle impostazioni.',
      freshness: catalogFreshnessFromCount(exemptionCount),
      age: formatCatalogCount(exemptionCount, 'codice', 'codici'),
      href: '/settings/repertori',
      actionLabel: exemptionCount > 0 ? 'Impostazioni' : 'Importa',
    },
    {
      id: 'prosthetics', name: 'Protesica e ausili',
      sub: prosthetics ? 'Fonti personali e originali locali. Validità da verificare sulla fonte.' : 'Stato della protesica non leggibile. Riprova la lettura.',
      freshness: prosthetics ? catalogFreshnessFromCount(prosthetics.count) : 'unreadable',
      age: prosthetics ? `${formatCatalogCount(prosthetics.sourceCount, 'fonte', 'fonti')} · ${formatCatalogCount(prosthetics.count, 'voce', 'voci')}` : 'non verificato',
      href: '/settings/repertori', actionLabel: prosthetics ? prosthetics.count ? 'Gestisci fonti' : 'Importa' : 'Gestisci repertori',
    },
    {
      id: 'icd',
      name: 'ICD-11 WHO',
      sub: icdCatalog
        ? `Catalogo WHO incorporato: ${{ ready: 'pronto', absent: 'assente', unverified: 'non verificato' }[icdCatalog.state]}${!icdCatalog.enabled ? ', disattivato dal gestore' : ''}. Inglese. WHO, CC BY-ND 3.0 IGO.${icdReadiness && !('catalogState' in icdReadiness) ? ` Servizio locale opzionale: ${icdReadinessMessage(icdReadiness.status)}` : ''}`
        : 'Stato del catalogo WHO non verificabile.',
      freshness: !icdCatalog ? 'unreadable' : icdCatalog.state === 'ready' || icdReadiness?.status === 'available' ? 'fresh' : icdCatalog.state === 'unverified' ? 'stale' : 'off',
      age: `MMS 2026-01 · Inglese · ${icdCatalog ? { ready: 'Pronto', absent: 'Assente', unverified: 'Non verificato' }[icdCatalog.state] : 'Non verificato'}`,
      href: '/settings/repertori#who-setup',
      actionLabel: 'Gestisci catalogo',
    },
  ];

  return {
    status: 'ready',
    rows,
    indexedCount: prosthetics && icdCatalog && icdCatalog.state !== 'unverified'
      ? drugCount + exemptionCount + prosthetics.count
        + (icdCatalog.state === 'ready' ? icdCatalog.manifest?.categories ?? 0 : 0)
      : null,
  };
}

function RepertoriArea({ isReview, commandTrigger }: { isReview: boolean; commandTrigger?: ReactNode }) {
  const [selectedCatalogId, setSelectedCatalogId] = useState(REVIEW_CATALOGS[0]?.id ?? '');
  const query = useLiveQueryState<CatalogState>(
    async () => {
      if (isReview) return REVIEW_CATALOG_STATE;
      const [drugCount, exemptionCount, icdReadiness, icdCatalog, prosthetics] = await Promise.all([
        fetchCatalogCount('/api/drugs?count=1'),
        fetchCatalogCount('/api/exemptions?count=1'),
        getICDReadiness().catch(() => null),
        getICDCatalogStatus().catch(() => null),
        fetch('/api/prosthetics/catalog/status', { cache: 'no-store' }).then(async response => { if (!response.ok) throw new Error('Catalog unavailable'); return await response.json() as { count: number; sourceCount: number }; }).catch(() => null),
      ]);
      return buildLiveCatalogState(drugCount, exemptionCount, icdReadiness, icdCatalog, prosthetics);
    },
    [isReview],
    undefined,
    ['drugs', 'exemptions', 'prosthetics_catalog_entries'],
  );
  const catalogState = isReview ? REVIEW_CATALOG_STATE : query.data;
  const isLoading = !isReview && query.loading;
  const isError = !isLoading && !isReview && Boolean(query.error);
  const isReady = !isLoading && !isError && Boolean(catalogState);

  const catalogs = catalogState?.rows ?? [];
  const selectedCatalog = catalogs.find((catalog) => catalog.id === selectedCatalogId) ?? catalogs[0];
  const availableCatalogs = catalogs.filter((catalog) => catalog.freshness === 'fresh' || catalog.freshness === 'ok').length;
  const needsImport = catalogs.some((catalog) => catalog.freshness === 'broken');
  const freshnessTitle = needsImport ? 'Import repertori incompleto' : 'Repertori disponibili';
  return (
    <div className={`${surface.page} ${repertoriStyles.page}`} data-record-page>
      <PageHeader
        title="Repertori"
        meta={isLoading ? 'Lettura locale…' : isError
            ? 'Impossibile leggere i conteggi locali in questa sessione.'
            : catalogState?.indexedCount == null ? 'Totale indicizzato incompleto'
              : `${availableCatalogs} di ${formatCatalogCount(catalogs.length, 'catalogo disponibile', 'cataloghi disponibili')} · ${formatCatalogCount(catalogState.indexedCount, 'voce indicizzata', 'voci indicizzate')}`}
        actions={<>
          <Link href="/settings/repertori" className="mf-button-secondary"><Database size={14} aria-hidden="true" />Gestisci repertori</Link>
          {commandTrigger}
        </>}
      />
      <section className={surface.tray} data-record-tray="repertori" aria-labelledby="repertori-zona">
        <h2 id="repertori-zona" className={surface.zoneTitle}>{isReady ? freshnessTitle : 'Cataloghi locali'}</h2>
        {isLoading && <ViewState state="loading" title="Caricamento repertori locali." />}
        {isError && <ViewState state="error" title="Repertori non leggibili" action={{ label: 'Riprova', onClick: query.refresh }} />}
        <div className={repertoriStyles.layout} hidden={!isReady}>
          <section className={surface.island} aria-label="Repertori rapidi">
            {isReady && catalogState?.indexedCount == null && <button type="button" className={`${styles.ghostBtnSm} ${repertoriStyles.retry}`} onClick={query.refresh}>Riprova</button>}
            <div className={repertoriStyles.catalogHeader} aria-hidden="true"><span>Catalogo</span><span>Contenuto locale</span><span>Stato</span><span /></div>
            {catalogs.map((c) => {
              const labelText = { fresh: 'Disponibile', ok: 'Da verificare', stale: 'Da aggiornare', broken: 'Import richiesto', off: 'Disattivato', unreadable: 'Stato non leggibile' }[c.freshness];
              const signal = c.freshness === 'unreadable' ? 'critical' : catalogFreshnessSignal(c.freshness);
              return <div key={c.id} className={repertoriStyles.catalogRow} data-selected={c.id === selectedCatalog?.id}>
                <strong className={repertoriStyles.catalogName}>{c.name}</strong>
                <span className={repertoriStyles.catalogSub}>{c.age}</span>
                <span className={`${SIGNAL_PILL[signal]} ${repertoriStyles.status}`}>{labelText}</span>
                <button type="button" className={styles.ghostBtnSm} aria-label={`Mostra dettaglio repertorio ${c.name}`} aria-pressed={c.id === selectedCatalog?.id} onClick={() => setSelectedCatalogId(c.id)}>Dettagli<ChevronRight size={14} aria-hidden="true" /></button>
                {c.id === 'aic' && !isReview && <div className={repertoriStyles.rowExtra}><AifaCatalogQuickUpdate /></div>}
              </div>;
            })}
            {isReady && !catalogs.length && <p className={repertoriStyles.empty}>Nessun repertorio disponibile.</p>}
          </section>
          {selectedCatalog && <section className={`${surface.island} ${repertoriStyles.detail}`} aria-label={`Dettaglio ${selectedCatalog.name}`}>
            <div className={surface.islandHeader}>
              <span className={surface.islandIcon} aria-hidden="true"><BookOpen size={15} /></span>
              <h3>{selectedCatalog.name}</h3>
            </div>
            <p>{selectedCatalog.sub}</p>
            <span className={repertoriStyles.detailMeta}>Contenuto locale: {selectedCatalog.age}</span>
            {selectedCatalog.href && <Link href={selectedCatalog.href} className={styles.ghostBtnSm}>{selectedCatalog.actionLabel ?? 'Apri'}<ArrowUpRight size={14} aria-hidden="true" /></Link>}
          </section>}
        </div>
      </section>
    </div>
  );
}

export { RepertoriArea };
