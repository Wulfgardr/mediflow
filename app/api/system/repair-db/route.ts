import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { currentArchiveGeneration } from '@/lib/security/archive-session-generation';
import { archiveMaintenanceAvailable, requestArchiveRepair } from '@/lib/security/archive-maintenance-owner';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    const denial = archiveWriteRequestDenial(request, session);
    if (denial) return denial;
    if (!archiveMaintenanceAvailable()) return NextResponse.json({ success: false,
        code: 'ARCHIVE_MAINTENANCE_OWNER_REQUIRED',
        error: 'Avvia la build di produzione con npm run maintenance:web prima di riparare l’archivio.' }, { status: 503 });
    let requestId: string;
    try { requestId = await requestArchiveRepair(currentArchiveGeneration()); }
    catch { return NextResponse.json({ success: false, error: 'Manutenzione non accettata dal supervisore.' }, { status: 503 }); }
    return NextResponse.json({ success: false, status: 'accepted', requestId },
        { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
