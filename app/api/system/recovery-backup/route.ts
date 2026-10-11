import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { openDbServer } from '@/lib/db-server';
import { createRecoverySnapshot } from '@/lib/recovery-backup-server';

export const dynamic = 'force-dynamic';

/** Only the authenticated same-origin browser receives this transient snapshot and encrypts it before download. */
export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session) || !isTrustedWebMutationRequest(request)) return forbiddenResponse();
    const denial = archiveWriteRequestDenial(request, session);
    if (denial) return denial;
    try {
        const bytes = createRecoverySnapshot(openDbServer(), session.userId);
        return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-store', 'Content-Length': String(bytes.length), 'X-Content-Type-Options': 'nosniff' } });
    } catch {
        return Response.json({ error: 'Backup completo non disponibile. Verifica passphrase, kit e integrità dell’archivio.' },
            { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
}
