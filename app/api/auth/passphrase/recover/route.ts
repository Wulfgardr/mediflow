import { NextResponse } from 'next/server';

import { validatePassphraseRecoveryPayload } from '@/lib/security/passphrase-adoption-validation';
import { recoverPassphrase } from '@/lib/security/pin-change-service';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';

function jsonResponse(body: Record<string, unknown>, status: number) {
    const response = NextResponse.json(body, { status });
    response.headers.set('Cache-Control', 'no-store');
    if (typeof body.retryAfterSeconds === 'number') response.headers.set('Retry-After', String(body.retryAfterSeconds));
    return response;
}

/** ADR 0143: a new passphrase for whoever holds the recovery key. No session is needed, and none is opened. */
export async function POST(request: Request) {
    if (!isTrustedWebMutationRequest(request)) {
        return jsonResponse({ error: 'Richiesta non ammessa.', code: 'PASSPHRASE_RECOVERY_UNTRUSTED_REQUEST' }, 403);
    }
    try {
        const payload = validatePassphraseRecoveryPayload(await request.json().catch(() => null));
        if (!payload) return jsonResponse({ error: 'Richiesta di recupero non valida.', code: 'PASSPHRASE_RECOVERY_INVALID' }, 400);

        const result = await recoverPassphrase({ request, payload });
        if (result.kind === 'denied') {
            // The shared verifier words every denial for a PIN; here it was a recovery key.
            const attempts = typeof result.body.remainingAttempts === 'number' && result.body.remainingAttempts > 0
                ? ` Tentativi rimasti: ${result.body.remainingAttempts}.` : '';
            return jsonResponse(result.status === 401
                ? { ...result.body, message: `Chiave di recupero o kit non validi.${attempts}` }
                : result.body, result.status);
        }
        if (result.kind === 'failure') return jsonResponse({ error: result.message, code: result.code, message: result.message }, result.status);
        return jsonResponse({ success: true }, 200);
    } catch (error) {
        console.error('Passphrase recovery error:', error);
        return jsonResponse({ error: 'Errore durante il recupero.', code: 'PASSPHRASE_RECOVERY_FAILED' }, 500);
    }
}
