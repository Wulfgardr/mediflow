import { execFileSync } from 'node:child_process';

export type GestureCounts = { gesti: number; clic: number; tasti: number; comandi: number; fermateDataOra?: number };
/**
 * Il conto non può salire. I tasti premuti dentro un campo data e ora nativo
 * (`fermateDataOra`) si confrontano a parte: i segmenti interni del campo li
 * decide il sistema, e con l'orologio a dodici ore ce n'è uno in più (AM/PM).
 * Fuori da quei campi vale il confronto esatto; dentro è ammessa una sola
 * fermata oltre la base, e solo se la base attraversava già il campo.
 */
export function assertGestureRatchet(actual: GestureCounts, ceiling: GestureCounts, label: string): void {
  const stops = { actual: actual.fermateDataOra ?? 0, ceiling: ceiling.fermateDataOra ?? 0 };
  for (const value of [stops.actual, stops.ceiling])
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}: conteggio fermateDataOra non valido`);
  for (const metric of ['gesti', 'clic', 'tasti', 'comandi'] as const) {
    if (!Number.isSafeInteger(actual[metric]) || actual[metric] < 0 || !Number.isSafeInteger(ceiling[metric]) || ceiling[metric] < 0)
      throw new Error(`${label}: conteggio ${metric} non valido`);
    const inDateFields = metric === 'gesti' || metric === 'comandi';
    const measured = actual[metric] - (inDateFields ? stops.actual : 0);
    const base = ceiling[metric] - (inDateFields ? stops.ceiling : 0);
    if (measured < 0 || base < 0) throw new Error(`${label}: fermateDataOra oltre ${metric}`);
    if (measured > base) throw new Error(inDateFields && (stops.actual || stops.ceiling)
      ? `${label}: ${metric} ${measured} > base ${base} fuori dai campi data e ora`
      : `${label}: ${metric} ${actual[metric]} > base ${ceiling[metric]}`);
  }
  // Un campo data e ora che la base non attraversava è un gesto nuovo, non un segmento in più.
  const allowance = stops.ceiling > 0 ? 1 : 0;
  if (stops.actual > stops.ceiling + allowance) throw new Error(`${label}: fermateDataOra ${stops.actual} > base ${stops.ceiling} + ${allowance}`);
}

/**
 * Commit a cui si riferisce una misura: la base comune con main, oppure HEAD
 * quando la storia non c'è (i checkout della CI sono superficiali e senza
 * origin/main). Non lancia mai: un'etichetta mancante non deve far fallire la
 * misura né impedire di scriverne il rapporto.
 */
export function measuredRevision(
  git: (args: string[]) => string = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
): string {
  for (const args of [['merge-base', 'HEAD', 'origin/main'], ['rev-parse', 'HEAD']]) {
    try {
      const sha = git(args).trim();
      if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    } catch { /* storia non disponibile */ }
  }
  return 'non disponibile';
}
