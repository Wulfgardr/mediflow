/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { dbServer } from '@/lib/db-server';
import { commitExemptionImport } from '@/lib/exemption-catalog-import';
import { readExemptionImportRequest, exemptionImportErrorResponse } from '@/lib/exemption-import-http';

export const runtime = 'nodejs';
export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    try {
        const input = await readExemptionImportRequest(request, true);
        return Response.json(commitExemptionImport(dbServer.$client, input, session.userId), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return exemptionImportErrorResponse(error); }
}
