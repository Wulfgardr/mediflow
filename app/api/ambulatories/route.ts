import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { readAmbulatoryJsonObject } from '@/lib/ambulatory-json-body';
import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { createAmbulatory } from '@/lib/ambulatory-write';
import { dbServer } from '@/lib/db-server';
import { ambulatories } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    try {
        return NextResponse.json(await dbServer.select().from(ambulatories).orderBy(desc(ambulatories.createdAt)));
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API GET /ambulatories error:', error);
        return NextResponse.json({ error: 'Failed to fetch ambulatories' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    try {
        const parsed = await readAmbulatoryJsonObject(request);
        if (!parsed.ok) return parsed.response;
        /* @Codex: writer derives its required audit actor from this admitted session. */
        const result = createAmbulatory({ request, session }, parsed.body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API POST /ambulatories error:', error);
        return NextResponse.json({ error: 'Failed to create ambulatory' }, { status: 500 });
    }
}
