/* @Codex */
import { isWhoCheckCode, parseWhoCodeCheckResult, type WhoCodeCheckResult } from './reference-data/icd11-who-code-check-contract';

export class WhoCodeCheckError extends Error {
    constructor(readonly code: 'invalid' | 'unauthorized' | 'release' | 'unavailable' | 'response' | 'timeout') {
        super(code); this.name = 'WhoCodeCheckError';
    }
}
export async function checkWhoCode(code: string, release = '2026-01', signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<WhoCodeCheckResult> {
    if (!isWhoCheckCode(code)) throw new WhoCodeCheckError('invalid');
    if (release !== '2026-01') throw new WhoCodeCheckError('release');
    let response: Response;
    try {
        response = await fetchImpl(`/api/icd/code-check?code=${encodeURIComponent(code)}&release=${release}`,
            { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    } catch { throw new WhoCodeCheckError('unavailable'); }
    if (!response.ok) throw new WhoCodeCheckError(response.status === 401 ? 'unauthorized' : response.status === 409 ? 'release'
        : response.status === 504 ? 'timeout' : response.status === 502 ? 'response' : 'unavailable');
    let value: unknown;
    try {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > 16_384) throw new Error('Oversized response');
        value = JSON.parse(text);
    } catch { throw new WhoCodeCheckError('response'); }
    const result = parseWhoCodeCheckResult(value, code);
    if (!result) throw new WhoCodeCheckError('response');
    return result;
}
export function whoCodeCheckErrorMessage(error: unknown): string {
    if (!(error instanceof WhoCodeCheckError)) return 'Verifica WHO non disponibile. Riprova dopo aver controllato il servizio.';
    switch (error.code) {
        case 'invalid': return 'Inserisci un codice ICD-11 completo, in maiuscolo.';
        case 'unauthorized': return 'Sessione scaduta. Accedi di nuovo per verificare il codice.';
        case 'release': return 'Questa fonte usa una release diversa. Il servizio verifica solo MMS 2026-01.';
        case 'response': return 'La risposta WHO non corrisponde al codice richiesto o non è leggibile.';
        case 'timeout': return 'WHO non ha risposto in tempo. Puoi riprovare.';
        default: return 'Verifica WHO non disponibile. Controlla il servizio nei Repertori.';
    }
}
