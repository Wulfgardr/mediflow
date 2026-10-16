import { assertArchiveGeneration } from '@/lib/archive-generation';
import { archiveGenerationForSession } from '@/lib/security/archive-session-generation';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import {
    auditContextFromSession,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { validateKdfRewrapPayload } from '@/lib/security/kdf-rewrap-validation';
import { persistKdfRewrap } from '@/lib/security/kdf-rewrap-service';

// Lazy KDF upgrade: persists a re-wrapped master-key blob (and its salt) without
// touching the PIN. The client calls this after a successful login when the
// stored blob is below CURRENT_KDF_VERSION. The master key never changes, so no
// clinical data is re-encrypted; only the PIN-derived wrapping is strengthened.
function failureResponse(status: number, code: string, message: string) {
    const response = NextResponse.json({ error: message, code, message }, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveGeneration = archiveGenerationForSession(session);
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    let body: unknown;
    try {
        body = await request.json();
    } catch (error) {
        if (error instanceof SyntaxError) {
            return failureResponse(400, 'KDF_REWRAP_INVALID', 'Payload di re-wrap non valido.');
        }
        throw error;
    }

    try {
        const payload = validateKdfRewrapPayload(body);
        if (!payload) {
            return failureResponse(400, 'KDF_REWRAP_INVALID', 'Payload di re-wrap non valido.');
        }
        const user = await dbServer.select().from(users).where(eq(users.id, session.userId)).get();
        if (!user) {
            return unauthorizedResponse();
        }

        const changed = dbServer.transaction((tx) => {
            assertArchiveGeneration(tx, archiveGeneration);
            return persistKdfRewrap(tx, user.id, payload);
        });
        if (!changed) {
            return failureResponse(409, 'KDF_REWRAP_NOT_APPLICABLE', 'Questo account si sblocca con una passphrase: il re-wrap del PIN non si applica.');
        }

        try {
            const context = auditContextFromSession(session);
            await writeAuditEvent({
                eventType: 'settings.updated',
                outcome: 'success',
                actorType: context.actorType,
                actorRef: context.actorRef,
                subjectType: 'settings',
                subjectRef: 'security.kdf',
                sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata(context, {
                    changedFields: ['encryptedMasterKey', 'salt'],
                    flags: ['kdf-upgrade'],
                    reasonCode: 'kdf_rewrap',
                }),
            });
        } catch (error) {
            console.error('Audit KDF rewrap write failed:', error);
        }

        const response = NextResponse.json({ success: true });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('KDF rewrap error:', error);
        return failureResponse(500, 'KDF_REWRAP_FAILED', 'Errore durante il re-wrap della chiave.');
    }
}
