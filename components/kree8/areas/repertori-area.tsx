import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ChevronRight,
  Database,
  Stethoscope,
} from 'lucide-react';

import { useLiveQuery } from '@/lib/live-query';
import {
  PillBadge,
  classNames,
} from '../cockpit-shared';
import type {
  Kree8CatalogClientState,
  Kree8CatalogFreshness,
  Kree8CatalogRow,
} from '../cockpit-shared';
import type { PillVariant } from '@/lib/patient-workspace';
import { catalogFreshnessSignal } from '@/lib/ui-semantic-signal';
import styles from '../kree8-clinical-cockpit.module.css';


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
    name: 'ICD-11 IT',
    sub: 'release ministeriale 2026',
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
function buildLiveCatalogState(drugCount: number, exemptionCount: number): Kree8CatalogClientState {
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
      id: 'icd',
      name: 'ICD-11 locale',
      sub: 'Servizio locale gestito dal launcher; nessun servizio remoto richiesto.',
      freshness: 'ok',
      age: 'porta 8888',
      href: '/settings/diagnostica',
      actionLabel: 'Diagnostica',
    },
  ];

  return {
    status: 'ready',
    rows,
    indexedCount: drugCount + exemptionCount,
  };
}

/* ───────────────────────── Repertori ───────────────────────── */

function RepertoriArea({ isReview }: { isReview: boolean }) {
  const [selectedCatalogId, setSelectedCatalogId] = useState(REVIEW_CATALOGS[0]?.id ?? '');
  const catalogState = useLiveQuery<Kree8CatalogClientState, Kree8CatalogClientState>(
    async () => {
      if (isReview) return REVIEW_CATALOG_STATE;
      try {
        const [drugCount, exemptionCount] = await Promise.all([
          fetchCatalogCount('/api/drugs?count=1'),
          fetchCatalogCount('/api/exemptions?count=1'),
        ]);
        return buildLiveCatalogState(drugCount, exemptionCount);
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
  );

  const catalogs = catalogState?.rows ?? [];
  const selectedCatalog = catalogs.find((catalog) => catalog.id === selectedCatalogId) ?? catalogs[0];
  const availableCatalogs = catalogs.filter((catalog) => catalog.freshness === 'fresh' || catalog.freshness === 'ok').length;
  const needsImport = catalogs.some((catalog) => catalog.freshness === 'broken');
  const isLoading = catalogState?.status === 'loading' || catalogState?.status === 'idle';
  const freshnessTier: Kree8CatalogFreshness =
    catalogState?.status === 'error' ? 'broken' : needsImport ? 'stale' : 'fresh';
  const freshnessTitle =
    catalogState?.status === 'error'
      ? 'Repertori non leggibili'
      : needsImport
        ? 'Import repertori incompleto'
        : 'Repertori disponibili';
  const freshnessPct = catalogs.length
    ? Math.round((availableCatalogs / catalogs.length) * 100)
    : isLoading
      ? 0
      : 0;
  const freshnessClass = classNames(
    styles.freshness,
    // @Codex: freshness usa lo stesso vocabolario delle pillole: fresh, stale e broken
    // mantengono rispettivamente success, warning e critical anche sulla rail.
    freshnessTier === 'fresh' && styles.freshnessOk,
    freshnessTier === 'stale' && styles.freshnessStale,
    freshnessTier === 'broken' && styles.freshnessBroken,
  );

  useEffect(() => {
    if (!catalogs.length) return;
    if (!catalogs.some((catalog) => catalog.id === selectedCatalogId)) {
      setSelectedCatalogId(catalogs[0].id);
    }
  }, [catalogs, selectedCatalogId]);

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Repertori clinici</p>
          <h1 className={styles.areaTitle}>
            AIFA, esenzioni e ICD <em>· {isLoading ? 'lettura locale' : `${(catalogState?.indexedCount ?? 0).toLocaleString('it-IT')} record`}</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Consultazione rapida dei repertori durante la compilazione della cartella.
            Import e cancellazioni restano nelle impostazioni complete, con azione
            esplicita dell&apos;operatore.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/settings/repertori" className={styles.ghostBtn}>
            <Database size={13} />
            Gestisci repertori
          </Link>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={freshnessClass}>
          <Database size={18} color="var(--ink-muted)" />
          <div className={styles.freshnessLabel}>
            <span className={styles.freshnessTitle}>{freshnessTitle}</span>
            <span className={styles.freshnessSub}>
              {isLoading
                ? 'lettura in corso'
                : `${availableCatalogs} di ${catalogs.length} pacchetti disponibili`}
            </span>
          </div>
          <span className={styles.freshnessNum}>{freshnessPct}%</span>
        </div>

        {catalogState?.status === 'error' ? (
          <p className={styles.panelSubtitle}>Impossibile leggere i conteggi locali in questa sessione.</p>
        ) : !selectedCatalog ? (
          <p className={styles.panelSubtitle}>Caricamento stato repertori locali.</p>
        ) : null}
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Repertori rapidi</h2>
        </header>

        <div style={{ marginTop: 8 }}>
          {catalogs.map((c) => {
            const variant: PillVariant = catalogFreshnessSignal(c.freshness);
            const labelText = {
              fresh: 'fresco',
              ok: 'da verificare',
              stale: 'invecchiato',
              broken: 'import manuale richiesto',
              off: 'disattivato',
            }[c.freshness];

            return (
              <div key={c.id} className={styles.catalogRow}>
                <span className={styles.catalogIcon}>
                  <Stethoscope size={13} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className={styles.catalogName}>{c.name}</span>
                  <span className={styles.catalogSub}>{c.sub}</span>
                </div>
                <span className={styles.rowSub} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {c.age}
                </span>
                <PillBadge variant={variant}>{labelText}</PillBadge>
                <button
                  type="button"
                  className={styles.ghostBtnSm}
                  aria-label={`Mostra dettaglio repertorio ${c.name}`}
                  onClick={() => {
                    setSelectedCatalogId(c.id);
                  }}
                >
                  Dettagli
                  <ChevronRight size={13} />
                </button>
              </div>
            );
          })}
          {!catalogs.length ? (
            <p className={styles.panelSubtitle}>Caricamento repertori locali.</p>
          ) : null}
        </div>
        {selectedCatalog && (
          <div className={styles.compositeCard} style={{ marginTop: 12 }}>
            <header className={styles.panelHeader}>
              <span className={styles.evidenceTitle}>{selectedCatalog.name}</span>
              <PillBadge
                variant={catalogFreshnessSignal(selectedCatalog.freshness)}
              >
                {{
                  fresh: 'fresco',
                  ok: 'da verificare',
                  stale: 'invecchiato',
                  broken: 'import manuale richiesto',
                  off: 'disattivato',
                }[selectedCatalog.freshness]}
              </PillBadge>
            </header>
            <p className={styles.rowSub} style={{ margin: 0 }}>
              {selectedCatalog.sub} · aggiornamento {selectedCatalog.age}
            </p>
            {selectedCatalog.href ? (
              <div className={styles.caseLensActions} style={{ marginTop: 10 }}>
                <Link href={selectedCatalog.href} className={styles.ghostBtnSm}>
                  {selectedCatalog.actionLabel ?? 'Apri'}
                  <ArrowUpRight size={12} />
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

export { RepertoriArea };
