/**
 * Sorgente unica di verita per la classificazione dei valori di osservazione
 * rispetto al range di riferimento (S6).
 *
 * Regola d'oro NON negoziabile (coerente con il commento in
 * app/patients/[id]/modules/page.tsx e con observation-manager.tsx): non si inventa
 * mai un flag fuori-range. Si classifica SOLO quando un bound numerico e realmente
 * presente sul dato e il valore e numerico. Nessun range = nessun flag = stato
 * onesto e legittimo. Questo modulo e usato da strip, ObservationManager e prompt
 * AI, cosi le tre superfici non possono divergere.
 */

export type ObservationRangeFlag = 'basso' | 'alto';

/**
 * Coerce un valore (number | string) a numero finito, o null.
 * Fail-safe: null/undefined/stringa vuota -> null (mai 0), cosi un bound assente
 * non viene mai coerciato a 0 generando un falso fuori-range. Gestisce la virgola
 * decimale italiana solo su stringhe puramente numeriche ("12,5" -> 12.5); valori
 * compositi come "120/80" o "positivo" restano null.
 */
export function toNumericValue(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = /^-?\d+,\d+$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
}

/**
 * Classifica il valore rispetto ai bound. Supporta bound unilaterali (solo alto o
 * solo basso, es. "< 200"). Ritorna null se nessun bound numerico e presente o se
 * il valore non e numerico.
 */
export function classifyObservationRange(
    value: number | string | null | undefined,
    refLow: string | null | undefined,
    refHigh: string | null | undefined,
): ObservationRangeFlag | null {
    const low = toNumericValue(refLow);
    const high = toNumericValue(refHigh);
    if (low === null && high === null) return null;
    const n = toNumericValue(value);
    if (n === null) return null;
    if (high !== null && n > high) return 'alto';
    if (low !== null && n < low) return 'basso';
    return null;
}

/** True se il valore e fuori range (uno qualsiasi dei bound presenti e superato). */
export function isObservationOutOfRange(
    value: number | string | null | undefined,
    refLow: string | null | undefined,
    refHigh: string | null | undefined,
): boolean {
    return classifyObservationRange(value, refLow, refHigh) !== null;
}

/**
 * Etichetta di riferimento null-safe per la UI: mai "null-200". Preferisce il
 * range grezzo (refText) quando i bound numerici mancano.
 * - entrambi i bound: "low-high"
 * - solo alto: "< high"
 * - solo basso: "> low"
 * - nessun bound ma refText: refText grezzo
 * - niente: stringa vuota
 */
export function formatReferenceRange(
    refLow: string | null | undefined,
    refHigh: string | null | undefined,
    refText?: string | null,
): string {
    const low = (refLow ?? '').trim();
    const high = (refHigh ?? '').trim();
    if (low && high) return `${low}-${high}`;
    if (high) return `< ${high}`;
    if (low) return `> ${low}`;
    return (refText ?? '').trim();
}
