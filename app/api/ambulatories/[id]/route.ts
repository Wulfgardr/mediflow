import { logServerError } from '@/lib/server-error-log';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { readAmbulatoryJsonObject } from '@/lib/ambulatory-json-body';
import { NextResponse } from 'next/server';
import { updateAmbulatory } from '@/lib/ambulatory-write';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    try {
        const { id } = await context.params;
        const parsed = await readAmbulatoryJsonObject(request);
        if (!parsed.ok) return parsed.response;
        /* retain the admitted host session through the atomic writer. */
        const result = updateAmbulatory({ request, session }, id, parsed.body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        logServerError('API PUT /ambulatories/[id] error', error);
        return NextResponse.json({ error: 'Failed to update ambulatory' }, { status: 500 });
    }
}
