/* @Codex */
import { NextResponse } from 'next/server';
import { createVisitDraft, type VisitDraftRouteBody } from '@/lib/visit-draft-service';
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

export const NETWORK_VISIT_DRAFT_CAPABILITY = 'network.compute.visit-draft';

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

export async function POST(request: Request) {
    const auth = await requireNetworkCapabilityContext(request, NETWORK_VISIT_DRAFT_CAPABILITY);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json() as VisitDraftRouteBody & Record<string, unknown>;
        if (hasOwn(body, 'patientId')) {
            return NextResponse.json({ error: 'Network visit draft does not accept patientId' }, { status: 400 });
        }

        const result = await createVisitDraft(body);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
        return NextResponse.json(result.value);
    } catch (error) {
        console.error('API POST /api/v1/network/visit-draft error:', error);
        return NextResponse.json({ error: 'Visit transcript draft failed' }, { status: 500 });
    }
}
