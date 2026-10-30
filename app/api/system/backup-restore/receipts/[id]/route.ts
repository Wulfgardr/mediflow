import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { readRestoreReceipt } from '@/lib/backup-restore-receipt';
import { openDbServer } from '@/lib/db-server';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    const receipt = readRestoreReceipt(openDbServer(), (await context.params).id);
    return Response.json(receipt ?? { error: 'Receipt not found' }, { status: receipt ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
}
