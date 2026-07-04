import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/* @Codex */
import {
    auditContextFromSession,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';
/* @Codex */
import { dbServer } from '@/lib/db-server';
/* @Codex */
import {
    PIN_CHANGE_INVALID_CURRENT_PIN_CODE,
    PIN_CHANGE_INVALID_NEW_PIN_CODE,
    PIN_CHANGE_REUSE_NOT_ALLOWED_CODE,
    validatePinChangeInput,
} from '@/lib/security/pin-change';
/* @Codex */
import { users } from '@/lib/schema';
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

        if (!encryptedMasterKey || !salt) {
            return failureResponse(400, PIN_CHANGE_INVALID_NEW_PIN_CODE, 'Payload di rotazione incompleto.');
        }

        const validationError = validatePinChangeInput(currentPin, newPin);
        if (validationError) {
            const code = validationError.includes('diverso')
                ? PIN_CHANGE_REUSE_NOT_ALLOWED_CODE
                : PIN_CHANGE_INVALID_NEW_PIN_CODE;
            return failureResponse(400, code, validationError);
        }

        const user = await dbServer.select().from(users).where(eq(users.id, session.userId)).get();
        if (!user) {
            return unauthorizedResponse();
        }

        const isCurrentPinValid = await bcrypt.compare(currentPin, user.passwordHash);
        if (!isCurrentPinValid) {
            return failureResponse(401, PIN_CHANGE_INVALID_CURRENT_PIN_CODE, 'Il PIN attuale non è corretto.');
        }

        const nextPasswordHash = await bcrypt.hash(newPin, 10);
        await dbServer
            .update(users)
            .set({
                passwordHash: nextPasswordHash,
                encryptedMasterKey,
                salt,
                failedLoginAttempts: 0,
                firstFailedLoginAt: null,
                lockedUntil: null,
            })
            .where(eq(users.id, user.id))
            .run();

        try {
            const context = auditContextFromSession(session);
            await writeAuditEvent({
                eventType: 'settings.updated',
                outcome: 'success',
                actorType: context.actorType,
                actorRef: context.actorRef,
                subjectType: 'settings',
                subjectRef: 'security.pin',
                sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata(context, {
                    changedFields: ['passwordHash', 'encryptedMasterKey', 'salt'],
                    flags: ['credential-rotation'],
                    reasonCode: 'pin_change',
                }),
            });
        } catch (error) {
            console.error('Audit pin change write failed:', error);
        }

        const response = NextResponse.json({ success: true, message: 'PIN aggiornato con successo.' });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        console.error('Change PIN error:', error);
        return failureResponse(500, 'PIN_CHANGE_FAILED', 'Errore durante il cambio PIN.');
    }
}
