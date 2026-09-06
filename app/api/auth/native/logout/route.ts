/* @Codex */
import { NextResponse } from 'next/server';
import { requirePairedNativeSession } from '@/lib/security/paired-native-session';
import { retireServerSessionForLogout } from '@/lib/security/server-session';
import { unauthorizedResponse } from '@/lib/security/server-auth';

/** Native logout never retires a Web session or mutates the fixed cookie. */
export async function POST(request: Request) {
    const session = await requirePairedNativeSession(request);
    if (!session) return unauthorizedResponse();
    const receipt = retireServerSessionForLogout(session.id);
    if (receipt.outcome !== 'completed') {
        return NextResponse.json({ error: 'Logout non confermato' }, {
            status: 409, headers: { 'Cache-Control': 'no-store' },
        });
    }
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
