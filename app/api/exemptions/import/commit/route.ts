/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { dbServer } from '@/lib/db-server';
import { commitExemptionImport } from '@/lib/exemption-catalog-import';
import { readExemptionImportRequest, exemptionImportErrorResponse } from '@/lib/exemption-import-http';
import { acquireExemptionImportAuthority } from '@/lib/exemption-import-authority';

export const runtime = 'nodejs';
export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    let authority: ReturnType<typeof acquireExemptionImportAuthority> | undefined;
    try {
        authority = acquireExemptionImportAuthority(session);
        authority.assertCurrent();
        const input = await readExemptionImportRequest(request, true, authority.signal);
        authority.assertCurrent();
        const result = commitExemptionImport(dbServer.$client, input, session.userId, authority.assertCurrent);
        authority.assertCurrent();
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        if (authority?.signal.aborted) return unauthorizedResponse();
        return exemptionImportErrorResponse(error);
    } finally { authority?.dispose(); }
}
