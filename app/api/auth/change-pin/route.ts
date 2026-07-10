import { NextResponse } from 'next/server';

/* @Codex */
import { changePin } from '@/lib/security/pin-change-service';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

/* @Codex */
function failureResponse(status: number, code: string, message: string) {
    const response = NextResponse.json({ error: message, code, message }, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const currentPin = typeof body?.currentPin === 'string' ? body.currentPin : '';
        const newPin = typeof body?.newPin === 'string' ? body.newPin : '';
        const encryptedMasterKey = typeof body?.encryptedMasterKey === 'string' ? body.encryptedMasterKey : '';
        const salt = typeof body?.salt === 'string' ? body.salt : '';

        const result = await changePin({
            session,
            request,
            currentPin,
            newPin,
            encryptedMasterKey,
            salt,
        });

        if (result.kind === 'unauthorized') return unauthorizedResponse();
        if (result.kind === 'failure') {
            return failureResponse(result.status, result.code, result.message);
        }

        const response = NextResponse.json({ success: true, message: 'PIN aggiornato con successo.' });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        console.error('Change PIN error:', error);
        return failureResponse(500, 'PIN_CHANGE_FAILED', 'Errore durante il cambio PIN.');
    }
}
