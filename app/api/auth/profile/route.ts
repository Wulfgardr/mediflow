import { NextResponse } from 'next/server';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/security/server-auth';
import { nativeSessionArchiveReplaced, pairedNativeClientBinding, requireAccountSession } from '@/lib/security/paired-native-session';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import {
    authProfileConditionalUpdateSchema,
    authProfileUpdateSchema,
} from '@/lib/api-schemas/auth';
import { INVALID_API_PAYLOAD_ERROR, parseApiBody } from '@/lib/api-schemas/parse';
import { apiInternalError, archiveReplacementResponse } from '@/lib/api-error-response';
import { readAccountProfile, updateProfile, updateProfileConditionally } from '@/lib/security/profile-update-service';
import { ArchiveReplacedError } from '@/lib/archive-generation';
import { sessionMatchesArchive } from '@/lib/security/archive-session-generation';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function conditionalFailure(body: Record<string, unknown>, status: number) {
    return NextResponse.json(body, { status, headers: NO_STORE });
}

function archiveReplacedResponse() {
    return archiveReplacementResponse(new ArchiveReplacedError())!;
}

export async function GET(request: Request) {
    const session = await requireAccountSession(request);
    if (!session) {
        if (await nativeSessionArchiveReplaced()) return archiveReplacedResponse();
        return conditionalFailure({ error: 'Unauthorized' }, 401);
    }

    try {
        const result = await readAccountProfile(session);
        if (result.kind === 'not-found') return conditionalFailure({ error: 'User not found' }, 404);
        return NextResponse.json(result.profile, { headers: NO_STORE });
    } catch (error) {
        return archiveReplacementResponse(error) ?? apiInternalError('GET /api/auth/profile', error);
    }
}

export async function PUT(request: Request) {
    const session = await requireAccountSession(request);
    if (!session) {
        if (await nativeSessionArchiveReplaced()) return archiveReplacedResponse();
        return unauthorizedResponse();
    }

    let rawBody: unknown;
    try {
        rawBody = await request.json();
    } catch (error) {
        console.error("Profile update error:", error);
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    // ADR 0155: only the presence of this key chooses the conditional branch.
    const conditional = typeof rawBody === 'object' && rawBody !== null
        && Object.prototype.hasOwnProperty.call(rawBody, 'expectedVersion');

    if (!conditional) {
        try {
            const parsedBody = parseApiBody(authProfileUpdateSchema, rawBody);
            if (!parsedBody.ok) return parsedBody.response;
            const body = parsedBody.data;
            const requestedId = typeof body?.id === 'string' && body.id.trim().length > 0 ? body.id : session.userId;
            const displayName = typeof body?.displayName === 'string' ? body.displayName : null;
            const ambulatoryName = typeof body?.ambulatoryName === 'string' ? body.ambulatoryName : null;

            if (requestedId !== session.userId) {
                return forbiddenResponse();
            }

            const result = await updateProfile({
                session,
                request,
                displayName,
                ambulatoryName,
            });

            if (result.kind === 'not-found') {
                return NextResponse.json({ error: 'User not found' }, { status: 404 });
            }

            return NextResponse.json({ success: true });
        } catch (error) {
            console.error("Profile update error:", error);
            return NextResponse.json({ error: "Update failed" }, { status: 500 });
        }
    }

    const parsedBody = authProfileConditionalUpdateSchema.safeParse(rawBody);
    if (!parsedBody.success) {
        return conditionalFailure({ error: INVALID_API_PAYLOAD_ERROR }, 400);
    }

    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    if (session.authChannel === 'native' && !sessionMatchesArchive(session)) return archiveReplacedResponse();

    try {
        const nativeBinding = session.authChannel === 'native'
            ? await pairedNativeClientBinding(request)
            : null;
        if (session.authChannel === 'native' && !nativeBinding) {
            return conditionalFailure({ error: 'Unauthorized' }, 401);
        }

        const result = await updateProfileConditionally({
            session,
            request,
            expectedVersion: parsedBody.data.expectedVersion,
            displayName: parsedBody.data.displayName,
            ambulatoryName: parsedBody.data.ambulatoryName,
            nativeBinding,
        });

        if (result.kind === 'unauthorized') return conditionalFailure({ error: 'Unauthorized' }, 401);
        if (result.kind === 'not-found') return conditionalFailure({ error: 'User not found' }, 404);
        if (result.kind === 'version-conflict') {
            return conditionalFailure({
                ...result.profile,
                code: 'PROFILE_VERSION_CONFLICT',
                error: 'Il profilo è cambiato su un altro client. Rileggi e riprova.',
            }, 409);
        }

        return conditionalFailure({ changed: result.changed, ...result.profile }, 200);
    } catch (error) {
        return archiveReplacementResponse(error) ?? apiInternalError('PUT /api/auth/profile', error);
    }
}
