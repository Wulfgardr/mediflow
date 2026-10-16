import { AifaCatalogQuickUpdate } from '@/components/settings/aifa-catalog-quick-update';
import ink from '@/components/ink-secondary.module.css';
import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ChevronRight,
  Database,
} from 'lucide-react';

import { useLiveQuery } from '@/lib/live-query';
import {
  PillBadge,
} from '../cockpit-shared';
import type {
  Kree8CatalogClientState,
  Kree8CatalogFreshness,
  Kree8CatalogRow,
} from '../cockpit-shared';
import type { PillVariant } from '@/lib/patient-workspace';
import { catalogFreshnessSignal } from '@/lib/ui-semantic-signal';
import { getICDReadiness, icdReadinessMessage } from '@/lib/icd-service';
import type { ICDReadiness } from '@/lib/icd-service';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import repertoriStyles from '../kree8-clinical-cockpit-repertori.module.css';


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

/* @Codex */
const REVIEW_CATALOG_STATE: Kree8CatalogClientState = {
  status: 'ready',
  rows: REVIEW_CATALOGS,
  indexedCount: 0,
};

/* @Codex */
async function fetchCatalogCount(path: string): Promise<number> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Catalog count failed: ${response.status}`);
  const payload = await response.json() as { count?: unknown };
  return Number(payload.count || 0);
}

/* @Codex */
function formatCatalogCount(count: number, singular: string, plural: string): string {
  const label = count === 1 ? singular : plural;
  return `${count.toLocaleString('it-IT')} ${label}`;
}

/* @Codex */
function catalogFreshnessFromCount(count: number): Kree8CatalogFreshness {
  return count > 0 ? 'fresh' : 'broken';
}

/* @Codex */
function buildLiveCatalogState(
  drugCount: number,
  exemptionCount: number,
  icdReadiness: ICDReadiness | null,
  prosthetics: { count: number; sourceCount: number } | null,
): Kree8CatalogClientState {
  const rows: Kree8CatalogRow[] = [
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
      freshness: prosthetics ? catalogFreshnessFromCount(prosthetics.count) : 'off',
      age: prosthetics ? `${prosthetics.sourceCount} fonti · ${formatCatalogCount(prosthetics.count, 'voce', 'voci')}` : 'non verificato',
      href: '/settings/repertori', actionLabel: prosthetics?.count ? 'Gestisci fonti' : 'Importa',
    },
    {
      id: 'icd',
      name: 'ICD-11 WHO',
      sub: icdReadiness
        ? `Readiness governata: ${icdReadinessMessage(icdReadiness.status)}`
        : 'Readiness governata non verificabile.',
      freshness: icdReadiness?.status === 'available'
        ? 'fresh'
        : icdReadiness?.status === 'configured'
          ? 'stale'
          : 'off',
      age: icdReadiness ? `release ${icdReadiness.releaseId}` : 'non verificato',
      href: '/settings/diagnostica',
      actionLabel: 'Diagnostica',
    },
  ];

  return {
    status: 'ready',
    rows,
    indexedCount: drugCount + exemptionCount + (prosthetics?.count ?? 0),
  };
}

/* ───────────────────────── Repertori ───────────────────────── */

function RepertoriArea({ isReview }: { isReview: boolean }) {
  const [selectedCatalogId, setSelectedCatalogId] = useState(REVIEW_CATALOGS[0]?.id ?? '');
  /* @Codex */
  const catalogState = useLiveQuery<Kree8CatalogClientState, Kree8CatalogClientState>(
    async () => {
      if (isReview) return REVIEW_CATALOG_STATE;
      try {
        const [drugCount, exemptionCount, icdReadiness, prosthetics] = await Promise.all([
          fetchCatalogCount('/api/drugs?count=1'),
          fetchCatalogCount('/api/exemptions?count=1'),
          getICDReadiness().catch(() => null),
          fetch('/api/prosthetics/catalog/status', { cache: 'no-store' }).then(async response => { if (!response.ok) throw new Error('Catalog unavailable'); return await response.json() as { count: number; sourceCount: number }; }).catch(() => null),
        ]);
        return buildLiveCatalogState(drugCount, exemptionCount, icdReadiness, prosthetics);
      } catch (error) {
        console.error('[MediFlow] Kree8 catalog status failed:', error);
        return {
          status: 'error',
          rows: [],
          indexedCount: 0,
        };
      }
    },
    [isReview],
    isReview ? REVIEW_CATALOG_STATE : {
      status: 'loading',
      rows: [],
      indexedCount: 0,
    },
    ['drugs', 'exemptions', 'prosthetics_catalog_entries'],
  );

  const catalogs = catalogState?.rows ?? [];
  const selectedCatalog = catalogs.find((catalog) => catalog.id === selectedCatalogId) ?? catalogs[0];
  const availableCatalogs = catalogs.filter((catalog) => catalog.freshness === 'fresh' || catalog.freshness === 'ok').length;
  const needsImport = catalogs.some((catalog) => catalog.freshness === 'broken');
  const isLoading = catalogState?.status === 'loading' || catalogState?.status === 'idle';
  const freshnessTitle =
    catalogState?.status === 'error'
      ? 'Repertori non leggibili'
      : needsImport
        ? 'Import repertori incompleto'
        : 'Repertori disponibili';
  return (
    <div className={`${styles.areaShell} ${ink.surface}`}>
      <header className={styles.areaHeader}>
        <div>
          <h1 className={styles.areaTitle}>Repertori<span aria-hidden="true">.</span></h1>
          <p className={styles.areaSubtitle}>{isLoading ? 'Lettura locale…' : `${availableCatalogs} di ${catalogs.length} cataloghi disponibili · ${(catalogState?.indexedCount ?? 0).toLocaleString('it-IT')} record indicizzati`}</p>
        </div>
        <div className={styles.headerActions}><Link href="/settings/repertori" className={styles.ghostBtn}><Database size={14} />Gestisci repertori</Link></div>
      </header>
      <section aria-label="Repertori rapidi">
        <h2 className={styles.panelTitle}>{freshnessTitle}</h2>
        {catalogState?.status === 'error' && <p role="status">Impossibile leggere i conteggi locali in questa sessione.</p>}
        <div className={repertoriStyles.catalogHeader} aria-hidden="true"><span>Catalogo</span><span>Contenuto locale</span><span>Stato</span><span /></div>
        {catalogs.map((c) => {
          const labelText = { fresh: 'Disponibile', ok: 'Da verificare', stale: 'Da aggiornare', broken: 'Import richiesto', off: 'Disattivato' }[c.freshness];
          return <div key={c.id} className={repertoriStyles.catalogRow} data-selected={c.id === selectedCatalog?.id}>
            <strong className={repertoriStyles.catalogName}>{c.name}</strong>
            <span className={repertoriStyles.catalogSub}>{c.age}</span>
            <PillBadge variant={catalogFreshnessSignal(c.freshness) as PillVariant}>{labelText}</PillBadge>
            <button type="button" className={styles.ghostBtnSm} aria-label={`Mostra dettaglio repertorio ${c.name}`} aria-pressed={c.id === selectedCatalog?.id} onClick={() => setSelectedCatalogId(c.id)}>Dettagli<ChevronRight size={13} /></button>
            {c.id === 'aic' && !isReview && <AifaCatalogQuickUpdate />}
          </div>;
        })}
        {!catalogs.length && <p className={styles.emptyState}>{isLoading ? 'Caricamento repertori locali.' : 'Nessun repertorio disponibile.'}</p>}
      </section>
      {selectedCatalog && <section className={repertoriStyles.detail} aria-label={`Dettaglio ${selectedCatalog.name}`}>
        <h2 className={styles.panelTitle}>{selectedCatalog.name}</h2>
        <p>{selectedCatalog.sub}</p>
        <span className={styles.rowSub}>Contenuto locale: {selectedCatalog.age}</span>
        {selectedCatalog.href && <Link href={selectedCatalog.href} className={styles.ghostBtnSm}>{selectedCatalog.actionLabel ?? 'Apri'}<ArrowUpRight size={13} /></Link>}
      </section>}
    </div>
  );
}

export { RepertoriArea };
