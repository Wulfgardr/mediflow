export type GestureCounts = { gesti: number; clic: number; tasti: number; comandi: number };
export function assertGestureRatchet(actual: GestureCounts, ceiling: GestureCounts, label: string): void {
  for (const metric of ['gesti', 'clic', 'tasti', 'comandi'] as const) {
    if (!Number.isSafeInteger(actual[metric]) || actual[metric] < 0 || !Number.isSafeInteger(ceiling[metric]) || ceiling[metric] < 0)
      throw new Error(`${label}: conteggio ${metric} non valido`);
    if (actual[metric] > ceiling[metric]) throw new Error(`${label}: ${metric} ${actual[metric]} > base ${ceiling[metric]}`);
  }
}
