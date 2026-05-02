/* @Codex */
import { NextResponse } from 'next/server';
import { getAppBranch, getAppRevision } from '@/lib/app-revision';
import { readUpdateAwarenessPayload } from '@/lib/update-awareness';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({
        ...readUpdateAwarenessPayload(),
        branch: getAppBranch(),
        revision: getAppRevision(),
    }, { headers: { 'Cache-Control': 'no-store, must-revalidate' } });
}
