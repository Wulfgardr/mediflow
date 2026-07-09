import { NextResponse } from 'next/server';
import { clearAmbulatory } from '@/lib/ambulatory-write';
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();
    try {
        const body = await request.json() as Record<string, unknown>;
        const ambulatoryId = typeof body.ambulatoryId === 'string' ? body.ambulatoryId.trim() : '';
        if (!ambulatoryId) return NextResponse.json({ error: 'Ambulatory ID required' }, { status: 400 });
        const result = await clearAmbulatory({ request, session }, ambulatoryId, body.version);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('Clear ambulatory error:', error);
        return NextResponse.json({ error: 'Failed to clear ambulatory' }, { status: 500 });
    }
}
