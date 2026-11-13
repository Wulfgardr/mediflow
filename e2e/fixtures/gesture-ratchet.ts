import { execFileSync } from 'node:child_process';

export type GestureCounts = { gesti: number; clic: number; tasti: number; comandi: number };
export function assertGestureRatchet(actual: GestureCounts, ceiling: GestureCounts, label: string): void {
  for (const metric of ['gesti', 'clic', 'tasti', 'comandi'] as const) {
    if (!Number.isSafeInteger(actual[metric]) || actual[metric] < 0 || !Number.isSafeInteger(ceiling[metric]) || ceiling[metric] < 0)
      throw new Error(`${label}: conteggio ${metric} non valido`);
    if (actual[metric] > ceiling[metric]) throw new Error(`${label}: ${metric} ${actual[metric]} > base ${ceiling[metric]}`);
  }
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
