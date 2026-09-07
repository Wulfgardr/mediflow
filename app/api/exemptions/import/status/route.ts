/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { dbServer } from '@/lib/db-server';
import { readExemptionImportStatus } from '@/lib/exemption-catalog-import';
import { exemptionImportErrorResponse } from '@/lib/exemption-import-http';

export const runtime = 'nodejs';
export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    try {
        return Response.json(readExemptionImportStatus(dbServer.$client), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return exemptionImportErrorResponse(error); }
}
