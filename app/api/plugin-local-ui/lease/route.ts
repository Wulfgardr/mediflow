import { createHash } from 'node:crypto';
import { requireSession } from '@/lib/security/server-auth';
import { requiresLocalUiDocumentLease } from '@/lib/security/plugin-local-ui-runtime';
import { localUiLeaseRequest } from '@/lib/security/local-ui-lease-request';

export const runtime = 'nodejs';
export async function POST(request: Request) {
    const deny = () => new Response(null, { status: 404 });
    if (!requiresLocalUiDocumentLease() || Number(request.headers.get('content-length')) > 256) return deny();
    const text = await request.text();
    if (text.length > 256) return deny();
    let value: unknown;
    try { value = JSON.parse(text); } catch { return deny(); }
    const input = localUiLeaseRequest(request, value);
    if (!input) return deny();
    const session = await requireSession();
    if (!session || session.authChannel !== 'web') return deny();
    const lease = (globalThis as unknown as Record<symbol, ((id: string, expiresAt: number | null) => Promise<boolean>) | undefined>)[Symbol.for('mediflow.local-ui.lease.v1')];
    if (!lease) return deny();
    const id = `${createHash('sha256').update(session.id).digest('hex')}:${input.tab}`;
    const accepted = await lease(id, input.action === 'release' ? null : Math.min(Date.now() + 15_000, session.expiresAt));
    return new Response(null, { status: accepted ? 204 : 409, headers: { 'Cache-Control': 'no-store' } });
}
