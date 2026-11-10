import type { FabricVenue } from './contract';

/*
 * Secondo tentativo limitato per le generazioni sul modello locale.
 *
 * Un modello locale con l'uscita vincolata allo schema JSON puo' comunque
 * scrivere una stringa piu' lunga del limite (Ollama non applica maxLength)
 * o degenerare fino al tetto di token. Il validatore resta quello di sempre:
 * qui si decide solo se rifare la stessa richiesta UNA volta.
 *
 * - Solo `local_process`: per un provider remoto un secondo tentativo
 *   raddoppierebbe uscita di dati e quota, quindi resta una sola chiamata.
 * - Mai piu' di due chiamate al modello per richiesta.
 * - Un errore del provider (rete, annullamento, revoca della sessione) non
 *   si ritenta: chiude subito.
 * - Fra il primo e il secondo tentativo `between` rilegge consenso e
 *   attualita'; se restituisce un esito, la richiesta si ferma li'.
 */

export const LOCAL_GENERATION_MAX_ATTEMPTS = 2;

export type LocalGenerationRejection = 'truncated' | 'invalid';

export type LocalGenerationAttempt<Value> =
    | Readonly<{ status: 'accepted'; value: Value }>
    | Readonly<{ status: 'rejected'; reason: LocalGenerationRejection }>
    | Readonly<{ status: 'provider_failed' }>;

export type LocalGenerationOutcome<Value, Stop> =
    | Readonly<{ status: 'accepted'; value: Value; attempts: number; rejections: readonly LocalGenerationRejection[] }>
    | Readonly<{ status: 'rejected'; attempts: number; rejections: readonly LocalGenerationRejection[] }>
    | Readonly<{ status: 'provider_failed'; attempts: number; rejections: readonly LocalGenerationRejection[] }>
    | Readonly<{ status: 'stopped'; stop: Stop; attempts: number; rejections: readonly LocalGenerationRejection[] }>;

export function maxGenerationAttempts(venue: FabricVenue): number {
    return venue === 'local_process' ? LOCAL_GENERATION_MAX_ATTEMPTS : 1;
}

export async function runLocalGenerationAttempts<Value, Stop>(input: Readonly<{
    venue: FabricVenue;
    attempt: () => Promise<LocalGenerationAttempt<Value>>;
    between: () => Promise<Stop | null>;
}>): Promise<LocalGenerationOutcome<Value, Stop>> {
    const limit = maxGenerationAttempts(input.venue);
    const rejections: LocalGenerationRejection[] = [];
    for (let attempts = 1; ; attempts += 1) {
        const result = await input.attempt();
        if (result.status === 'accepted') {
            return Object.freeze({ status: 'accepted', value: result.value, attempts, rejections: Object.freeze([...rejections]) });
        }
        if (result.status === 'provider_failed') {
            return Object.freeze({ status: 'provider_failed', attempts, rejections: Object.freeze([...rejections]) });
        }
        rejections.push(result.reason);
        if (attempts >= limit) {
            return Object.freeze({ status: 'rejected', attempts, rejections: Object.freeze([...rejections]) });
        }
        const stop = await input.between();
        if (stop !== null) {
            return Object.freeze({ status: 'stopped', stop, attempts, rejections: Object.freeze([...rejections]) });
        }
    }
}
