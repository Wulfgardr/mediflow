// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { listAmbulatorySummaries } from '@/lib/ambulatory-read';

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        return NextResponse.json(await listAmbulatorySummaries());
    } catch (error) {
        console.error('API GET /api/v1/ambulatories error:', error);
        return NextResponse.json({ error: 'Failed to fetch ambulatories' }, { status: 500 });
    }
}
