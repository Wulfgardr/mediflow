/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { dbServer } from '@/lib/db-server';
import { readExemptionImportStatus } from '@/lib/exemption-catalog-import';
import { exemptionImportErrorResponse } from '@/lib/exemption-import-http';
import { acquireExemptionImportAuthority } from '@/lib/exemption-import-authority';

export const runtime = 'nodejs';
export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    let authority: ReturnType<typeof acquireExemptionImportAuthority> | undefined;
    try {
        authority = acquireExemptionImportAuthority(session);
        authority.assertCurrent();
        const result = readExemptionImportStatus(dbServer.$client);
        authority.assertCurrent();
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        if (authority?.signal.aborted) return unauthorizedResponse();
        return exemptionImportErrorResponse(error);
    } finally { authority?.dispose(); }
}
