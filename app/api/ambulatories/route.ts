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
        console.error('API GET /ambulatories error:', error);
        return NextResponse.json({ error: 'Failed to fetch ambulatories' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    try {
        const result = createAmbulatory(await request.json() as Record<string, unknown>);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /ambulatories error:', error);
        return NextResponse.json({ error: 'Failed to create ambulatory' }, { status: 500 });
    }
}
