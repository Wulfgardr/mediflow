import { NextResponse } from 'next/server';
import {
    forbiddenResponse,
    requireSession,
    unauthorizedResponse,
} from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { runBackupRestorePreflight } from '@/lib/backup-restore-preflight';
import { apiFailure, apiInternalError } from '@/lib/api-error-response';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';

export const dynamic = 'force-dynamic';

/* Checks a backup with the preflight the restore uses. This route imports no writer:
   nothing here can change the archive. */
export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    if (!isTrustedWebMutationRequest(request)) {
        return apiFailure('request_transport_invalid', 'Verifica backup non disponibile.', 403);
    }

    try {
        const { artifact, result: preflight } = await runBackupRestorePreflight(await request.json());
        if (!preflight.ok || !artifact) {
            return NextResponse.json(
                { success: false, error: preflight.error ?? 'Backup preflight failed.', preflight },
                { status: 412 },
            );
        }
        const response = NextResponse.json({
            success: true,
            format: artifact.format,
            version: artifact.version,
            createdAt: artifact.manifest.createdAt,
            collections: [...artifact.manifest.collections],
            counts: artifact.manifest.recordCounts,
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        const malformato = error instanceof SyntaxError;
        return apiInternalError('Backup verify failed', error, {
            status: malformato ? 400 : 500,
            code: malformato ? 'invalid_backup_artifact' : 'verify_failed',
            message: malformato ? 'Artefatto di backup non valido.' : 'Verifica non riuscita.',
            extra: { success: false },
        });
    }
}
