import { currentArchiveGeneration } from '@/lib/security/archive-session-generation';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { NextResponse } from 'next/server';

import { validatePassphraseRecoveryPayload } from '@/lib/security/passphrase-adoption-validation';
import { recoverPassphrase } from '@/lib/security/pin-change-service';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import {
    abortWebAuthControl,
    beginWebAuthControl,
    bootstrapWebAuthControl,
    issueWebAuthControl,
    resolveWebAuthControlSession,
    setWebAuthControlEtag,
    webAuthControlMutationFromRequest,
} from '@/lib/security/web-auth-control-transport';
import type { WebSessionProjection } from '@/lib/security/web-auth-lifecycle-owner-adapter';

function jsonResponse(body: Record<string, unknown>, status: number, etag?: string | null) {
    const response = NextResponse.json(body, { status });
    response.headers.set('Cache-Control', 'no-store');
    if (typeof body.retryAfterSeconds === 'number') response.headers.set('Retry-After', String(body.retryAfterSeconds));
    if (etag) setWebAuthControlEtag(response, etag);
    return response;
}

const unavailable = (etag?: string) => jsonResponse({ error: 'Recupero non disponibile.', code: 'PASSPHRASE_RECOVERY_UNAVAILABLE' }, 503, etag);

/**
 * ADR 0143: a new passphrase for whoever holds the recovery key. It passes through the Web
 * auth control like a login, because only an authentic session lets the owner retire the
 * sessions of the account; that session is retired in this same request and its cookie is
 * never set.
 */
export async function POST(request: Request) {
    if (!isTrustedWebMutationRequest(request)) {
        return jsonResponse({ error: 'Richiesta non ammessa.', code: 'PASSPHRASE_RECOVERY_UNTRUSTED_REQUEST' }, 403);
    }
    const mutation = webAuthControlMutationFromRequest(request);
    if (!mutation) return unavailable();
    const archiveGeneration = currentArchiveGeneration();
    let attempt: unknown | null = beginWebAuthControl('login', mutation);
    if (!attempt) return unavailable(mutation.ifMatch);
    // Whatever the outcome, the browser needs the fence the control holds now.
    const currentEtag = () => bootstrapWebAuthControl(mutation.controlId)?.etag ?? mutation.ifMatch;

    try {
        const payload = validatePassphraseRecoveryPayload(await request.json().catch(() => null));
        if (!payload) return jsonResponse({ error: 'Richiesta di recupero non valida.', code: 'PASSPHRASE_RECOVERY_INVALID' }, 400, mutation.ifMatch);

        const result = await recoverPassphrase({
            request,
            archiveGeneration,
            payload,
            openSession: (account) => {
                const pending = attempt;
                attempt = null;
                const issued = issueWebAuthControl(pending, { id: account.id, username: account.username, role: account.role || 'user' });
                const resolution = issued ? resolveWebAuthControlSession(issued.sessionId, mutation.controlId) : null;
                return resolution?.status === 'active' ? resolution.projection as WebSessionProjection : null;
            },
        });
        if (result.kind === 'denied') {
            // The shared verifier words every denial for a PIN; here it was a recovery key.
            const attempts = typeof result.body.remainingAttempts === 'number' && result.body.remainingAttempts > 0
                ? ` Tentativi rimasti: ${result.body.remainingAttempts}.` : '';
            return jsonResponse(result.status === 401
                ? { ...result.body, message: `Chiave di recupero o kit non validi.${attempts}` }
                : result.body, result.status, currentEtag());
        }
        if (result.kind === 'failure') {
            return jsonResponse({ error: result.message, code: result.code, message: result.message }, result.status, currentEtag());
        }
        return jsonResponse({ success: true }, 200, currentEtag());
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) { setWebAuthControlEtag(replacement, currentEtag()); return replacement; }
        console.error('Passphrase recovery error:', error);
        return jsonResponse({ error: 'Errore durante il recupero.', code: 'PASSPHRASE_RECOVERY_FAILED' }, 500, currentEtag());
    } finally {
        if (attempt) abortWebAuthControl(attempt);
    }
}
