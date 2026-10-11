import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
/* @Codex */
import { apiFailure } from '@/lib/api-error-response';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export const dynamic = 'force-dynamic';

/** Auth-first terminal compatibility boundary for the retired caller-owned execution route. */
export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    return apiFailure('legacy_route_retired', 'La route ATHENA legacy non è più disponibile.', 410);
}
