import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
/* @Codex */
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { authProfileUpdateSchema } from '@/lib/api-schemas/auth';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';

export async function PUT(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const rawBody = await request.json();
        const parsedBody = parseApiBody(authProfileUpdateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const requestedId = typeof body?.id === 'string' && body.id.trim().length > 0 ? body.id : session.userId;
        const displayName = typeof body?.displayName === 'string' ? body.displayName : null;
        const ambulatoryName = typeof body?.ambulatoryName === 'string' ? body.ambulatoryName : null;

        if (requestedId !== session.userId) {
            return forbiddenResponse();
        }

        const result = await dbServer.update(users)
            .set({
                displayName,
                ambulatoryName,
            })
            .where(eq(users.id, session.userId))
            .run();

        if (result.changes === 0) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Profile update error:", error);
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
}
