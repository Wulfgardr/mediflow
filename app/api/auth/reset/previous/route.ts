import { NextResponse } from 'next/server';
import { openDbServer } from '@/lib/db-server';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { discardPreviousArchive } from '@/lib/security/account-reset-journal';

export const dynamic = 'force-dynamic';

/** Explicit confirmation: removes the copy of the archive that a finished reset kept. */
export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    const denial = archiveWriteRequestDenial(request, session);
    if (denial) return denial;
    const body = await request.json().catch(() => null) as { id?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : '';
    let receipt;
    try { receipt = discardPreviousArchive(openDbServer(), id); }
    catch { receipt = null; }
    return receipt
        ? NextResponse.json({ receipt }, { headers: { 'Cache-Control': 'no-store' } })
        : NextResponse.json({ error: 'Copia non eliminata: non corrisponde alla ricevuta o il reset non è concluso.' },
            { status: 409, headers: { 'Cache-Control': 'no-store' } });
}
