import { archiveGenerationForSession } from '@/lib/security/archive-session-generation';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { NextResponse } from 'next/server';

import { validatePassphraseAdoptionPayload } from '@/lib/security/passphrase-adoption-validation';
import { PASSPHRASE_ADOPTION_INVALID_CODE } from '@/lib/security/pin-change';
import { adoptPassphrase } from '@/lib/security/pin-change-service';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

function failureResponse(status: number, code: string, message: string) {
    const response = NextResponse.json({ error: message, code, message }, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

/** ADR 0143: the account moves from its PIN to a passphrase. A Web session only: native clients do not derive it yet. */
export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    // It cannot be undone and the cookie alone authorizes it: only this origin's own page may ask.
    if (!isTrustedWebMutationRequest(request)) {
        return failureResponse(403, 'PASSPHRASE_ADOPTION_UNTRUSTED_REQUEST', 'Richiesta non ammessa.');
    }

    const archiveGeneration = archiveGenerationForSession(session);
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const payload = validatePassphraseAdoptionPayload(await request.json().catch(() => null));
        if (!payload) return failureResponse(400, PASSPHRASE_ADOPTION_INVALID_CODE, 'Richiesta di passaggio alla passphrase non valida.');

        const result = await adoptPassphrase({ session, request, archiveGeneration, payload });
        if (result.kind === 'unauthorized') return unauthorizedResponse();
        if (result.kind === 'failure') return failureResponse(result.status, result.code, result.message);

        // False when a copy made before the passphrase, or the log of the archive, could not be cleared: the person must be told.
        const response = NextResponse.json({ success: true, earlierCopiesCleared: result.earlierCopiesCleared === true });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('Passphrase adoption error:', error);
        return failureResponse(500, 'PASSPHRASE_ADOPTION_FAILED', 'Errore durante il passaggio alla passphrase.');
    }
}
