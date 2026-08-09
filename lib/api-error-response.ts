/* WUL-347. Forma d'errore condivisa fra le route legacy e la v1.

   Il problema che risolve non e' l'estetica del contratto: alcune route
   rimandavano al client il `message` grezzo dell'eccezione, che su questo
   prodotto puo' contenere percorsi del filesystem, dettagli SQLite e internals
   di PM2. La UI decifra PHI, quindi ogni dettaglio interno che esce e' superficie
   in piu' per chi sta gia' guardando.

   La regola e' asimmetrica ed e' il punto di questo modulo: il dettaglio va
   **loggato** sul server e **non** restituito. Cio' che torna al client e' un
   messaggio stabile piu' un codice su cui si puo' fare match.

   Non usare questi helper per i messaggi di dominio destinati all'operatore
   (per esempio il rifiuto di un import AIFA malformato): quelli sono contenuto,
   non fuga. Per loro esiste apiFailure(), che pretende un codice esplicito. */

import { NextResponse } from 'next/server';

export type ApiErrorBody = {
    error: string;
    code: string;
};

/* Alcune route hanno gia' un contratto d'errore piu' largo (per esempio
   `success: false` o un blocco `preflight`). L'helper deve accomodarlo invece di
   imporre una forma nuova, altrimenti non viene adottato e il leak resta dov'e'.
   Cio' che non e' negoziabile e' l'altra meta': il dettaglio non esce. */
type CampiExtra = Record<string, unknown>;

const GENERIC_INTERNAL_MESSAGE = 'Errore interno del server.';

/* Errore inatteso: il dettaglio resta nei log del server. `scope` serve a
   ritrovarlo, ed e' l'unica cosa che il chiamante deve ricordarsi di passare. */
export function apiInternalError(
    scope: string,
    error: unknown,
    options: { status?: number; code?: string; message?: string; extra?: CampiExtra } = {},
): NextResponse {
    console.error(`[MediFlow] ${scope}:`, error);
    const body: ApiErrorBody & CampiExtra = {
        ...(options.extra ?? {}),
        error: options.message ?? GENERIC_INTERNAL_MESSAGE,
        code: options.code ?? 'internal_error',
    };
    const response = NextResponse.json(body, { status: options.status ?? 500 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

/* Errore atteso e descrivibile: il messaggio e' contenuto scelto da chi scrive
   la route, non il testo di un'eccezione. Il codice e' obbligatorio proprio per
   rendere scomodo passare di qui per pigrizia. */
export function apiFailure(
    code: string,
    message: string,
    status: number,
): NextResponse<ApiErrorBody> {
    const response = NextResponse.json<ApiErrorBody>({ error: message, code }, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
