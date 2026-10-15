import { createHash } from 'node:crypto';
import { requireSession } from '@/lib/security/server-auth';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { acquireExemptionImportAuthority } from '@/lib/exemption-import-authority';
import { WhoCatalogError } from '@/lib/reference-data/icd11-embedded-parser';
import { createWhoCatalogHttpRoute } from '@/lib/reference-data/icd11-embedded-http';
import { getWhoCatalogStore, getWhoCatalogStatus, whoCatalogEnabled } from '@/lib/reference-data/icd11-embedded-production';

export const runtime = 'nodejs';
async function handle(request: Request) {
    const session = await requireSession();
    if (!session) return Response.json({ error: 'Sessione non valida' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    if (session.authChannel !== 'web') return Response.json({ error: 'Operazione disponibile dalla sessione web locale' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    const denial = request.method === 'POST' ? archiveWriteRequestDenial(request, session) : null;
    if (denial) return denial;
    return createWhoCatalogHttpRoute({
        acquire: async () => {
            let authority: ReturnType<typeof acquireExemptionImportAuthority>;
            try { authority = acquireExemptionImportAuthority(session); } catch { throw new WhoCatalogError('Sessione non più valida', 401); }
            const expiry = new AbortController();
            const timer = setTimeout(() => expiry.abort(), Math.max(0, session.expiresAt - Date.now()));
            return { ...authority, signal: AbortSignal.any([authority.signal, expiry.signal]),
                dispose: () => { clearTimeout(timer); authority.dispose(); }, assertCurrent: () => {
                try { authority.assertCurrent(); } catch { throw new WhoCatalogError('Sessione non più valida', 401); }
            }, actor: createHash('sha256').update(session.userId).digest('hex') };
        },
        store: getWhoCatalogStore, status: getWhoCatalogStatus, enabled: whoCatalogEnabled,
    })(request);
}
export const GET = handle;
export const POST = handle;
