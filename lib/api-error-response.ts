import { logServerError } from './server-error-log';
import { NextResponse } from 'next/server';
import { ArchiveReplacedError } from './archive-generation';

export function archiveReplacementResponse(error: unknown): NextResponse | null {
    return error instanceof ArchiveReplacedError
        ? apiFailure('ARCHIVE_REPLACED', 'I dati sono stati ripristinati. Ricarica la pagina prima di continuare.', 409)
        : null;
}

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

export function apiInternalError(
    scope: string,
    error: unknown,
    options: { status?: number; code?: string; message?: string; extra?: CampiExtra } = {},
): NextResponse {
    const replacement = archiveReplacementResponse(error);
    if (replacement) return replacement;
    logServerError(scope, error);
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
