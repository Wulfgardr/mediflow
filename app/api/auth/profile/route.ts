import { NextResponse } from 'next/server';
import { nativeSessionArchiveReplaced, pairedNativeClientBinding, requireAccountSession } from '@/lib/security/paired-native-session';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { authProfileConditionalUpdateSchema } from '@/lib/api-schemas/auth';
import { INVALID_API_PAYLOAD_ERROR } from '@/lib/api-schemas/parse';
import { apiInternalError, archiveReplacementResponse } from '@/lib/api-error-response';
import { readAccountProfile, updateProfileConditionally } from '@/lib/security/profile-update-service';
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
        if (await nativeSessionArchiveReplaced(request)) return archiveReplacedResponse();
        return conditionalFailure({ error: 'Unauthorized' }, 401);
    }

    try {
        const nativeBinding = session.authChannel === 'native'
            ? await pairedNativeClientBinding(request)
            : null;
        if (session.authChannel === 'native' && !nativeBinding) {
            return conditionalFailure({ error: 'Unauthorized' }, 401);
        }
        const result = await readAccountProfile({ session, request, nativeBinding });
        if (result.kind === 'denied') return conditionalFailure(result.denial.value, result.denial.status);
        if (result.kind === 'not-found') return conditionalFailure({ error: 'User not found' }, 404);
        return NextResponse.json(result.profile, { headers: NO_STORE });
    } catch (error) {
        return archiveReplacementResponse(error) ?? apiInternalError('GET /api/auth/profile', error);
    }
}

export async function PUT(request: Request) {
    const session = await requireAccountSession(request);
    if (!session) {
        if (await nativeSessionArchiveReplaced(request)) return archiveReplacedResponse();
        return conditionalFailure({ error: 'Unauthorized' }, 401);
    }

    let rawBody: unknown;
    try {
        rawBody = await request.json();
    } catch {
        return conditionalFailure({ error: INVALID_API_PAYLOAD_ERROR }, 400);
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

        if (result.kind === 'denied') return conditionalFailure(result.denial.value, result.denial.status);
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
