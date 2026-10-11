import { NextResponse } from 'next/server';
import { validatePassphraseChangePayload } from '@/lib/security/passphrase-adoption-validation';
import { changePassphrase } from '@/lib/security/pin-change-service';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

function response(body: Record<string, unknown>, status: number) {
    const result = NextResponse.json(body, { status });
    result.headers.set('Cache-Control', 'no-store');
    return result;
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isTrustedWebMutationRequest(request)) return response({ error: 'Richiesta non ammessa.' }, 403);
    try {
        const payload = validatePassphraseChangePayload(await request.json().catch(() => null));
        if (!payload) return response({ error: 'Richiesta di cambio della passphrase non valida.' }, 400);
        const result = await changePassphrase({ session, request, payload });
        if (result.kind === 'unauthorized') return unauthorizedResponse();
        if (result.kind === 'denied') return response(result.body, result.status);
        if (result.kind === 'failure') return response({ error: result.message, code: result.code }, result.status);
        return response({ success: true }, 200);
    } catch (error) {
        console.error('Passphrase change failed:', error);
        return response({ error: 'Errore durante il cambio della passphrase.' }, 500);
    }
}
