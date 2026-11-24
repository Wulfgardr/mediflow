import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { openDbServer } from '@/lib/db-server';
import { createRecoverySnapshot } from '@/lib/recovery-backup-server';
import { RecoverySnapshotRefusedError, recoveryBackupRefusalResponse } from '@/lib/recovery-backup-refusal';
import { logServerError } from '@/lib/server-error-log';
import { WindowsPrivateDirectoryError } from '@/scripts/windows-private-directory.mjs';

export const dynamic = 'force-dynamic';

/** Only the authenticated same-origin browser receives this transient snapshot and encrypts it before download. */
export async function POST(request: Request) {
    try {
        const session = await requireSession();
        if (!session) return unauthorizedResponse();
        if (!isWebAdminSession(session) || !isTrustedWebMutationRequest(request)) return forbiddenResponse();
        const denial = archiveWriteRequestDenial(request, session);
        if (denial) return denial;
        const bytes = createRecoverySnapshot(openDbServer(), session.userId);
        return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-store', 'Content-Length': String(bytes.length), 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) {
        if (error instanceof WindowsPrivateDirectoryError) return Response.json({ error: error.userMessage, code: error.code },
            { status: 422, headers: { 'Cache-Control': 'no-store' } });
        if (error instanceof RecoverySnapshotRefusedError) {
            logServerError(`[MediFlow] Recovery backup refused: ${error.reason}`);
            return recoveryBackupRefusalResponse(error.reason);
        }
        logServerError('[MediFlow] Recovery backup failed', error);
        return recoveryBackupRefusalResponse('backup_failed');
    }
}
