import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

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
    } catch (archiveError) {
        const replacement = archiveReplacementResponse(archiveError);
        if (replacement) return replacement;
        return NextResponse.json({ error: "Failed to set context" }, { status: 500 });
    }
}

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const cookieStore = await cookies();
    const ambulatoryId = cookieStore.get('ambulatory_id')?.value;
    return NextResponse.json({ ambulatoryId: ambulatoryId || null });
}
