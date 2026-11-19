// Codex: created 2026-02-01
import { logServerError } from '@/lib/server-error-log';
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { listAmbulatorySummaries } from '@/lib/ambulatory-read';

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        return NextResponse.json(await listAmbulatorySummaries());
    } catch (error) {
        logServerError('API GET /api/v1/ambulatories error', error);
        return NextResponse.json({ error: 'Failed to fetch ambulatories' }, { status: 500 });
    }
}
