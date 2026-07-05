import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const { ambulatoryId } = body;

        const cookieStore = await cookies();

        if (ambulatoryId) {
            cookieStore.set('ambulatory_id', ambulatoryId, {
                path: '/',
                httpOnly: false, // Must be false for client-side JS to read via document.cookie
                sameSite: 'lax',
                maxAge: 60 * 60 * 24 * 365 // 1 year
            });
        } else {
            cookieStore.delete('ambulatory_id');
        }

        return NextResponse.json({ success: true, ambulatoryId });
    } catch {
        return NextResponse.json({ error: "Failed to set context" }, { status: 500 });
    }
}

export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const cookieStore = await cookies();
    const ambulatoryId = cookieStore.get('ambulatory_id')?.value;
    return NextResponse.json({ ambulatoryId: ambulatoryId || null });
}
