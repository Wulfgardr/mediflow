import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { isCurrentServerSession } from '@/lib/security/current-session-authority';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { openDbServer } from '@/lib/db-server';
import { createRecoverySnapshotStream, recoveryBackupCapacity } from '@/lib/recovery-backup-server';
import { RECOVERY_SNAPSHOT_BYTES_HEADER } from '@/lib/recovery-backup-stream';
import { RecoverySnapshotRefusedError, recoveryBackupRefusalResponse } from '@/lib/recovery-backup-refusal';
import { logServerError } from '@/lib/server-error-log';
import { WindowsPrivateDirectoryError } from '@/scripts/windows-private-directory.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    try {
        return Response.json({ warning: recoveryBackupCapacity(openDbServer()) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        logServerError('[MediFlow] Recovery capacity check failed', error);
        return recoveryBackupRefusalResponse('backup_failed');
    }
}

/** Only the authenticated same-origin browser receives this transient snapshot and encrypts it before download. */
export async function POST(request: Request) {
    try {
        const session = await requireSession();
        if (!session) return unauthorizedResponse();
        if (!isWebAdminSession(session) || !isTrustedWebMutationRequest(request)) return forbiddenResponse();
        const denial = archiveWriteRequestDenial(request, session);
        if (denial) return denial;
        const expires = AbortSignal.timeout(Math.max(0, session.expiresAt - Date.now()));
        const { body, size } = createRecoverySnapshotStream(openDbServer(), session.userId, {
            signal: AbortSignal.any([request.signal, expires]),
            assertCurrent: () => {
                if (!isCurrentServerSession(session)) throw new RecoverySnapshotRefusedError('session_expired');
            },
        });
        return new Response(body, { headers: { 'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-store', [RECOVERY_SNAPSHOT_BYTES_HEADER]: String(size), 'X-Content-Type-Options': 'nosniff' } });
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
