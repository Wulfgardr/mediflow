import { logServerError } from '@/lib/server-error-log';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { readPrescriptionJsonObject } from '@/lib/prescription-json-body';
import { NextResponse } from 'next/server';
import { createHostServicePrescriptionSet } from '@/lib/service-prescription-write';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const parsedBody = await readPrescriptionJsonObject(request);
        if (!parsedBody.ok) return parsedBody.response;
        const result = await createHostServicePrescriptionSet({ request, session }, parsedBody.body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        logServerError('API POST /service-prescription-sets error', error);
        return NextResponse.json({ error: 'Failed to create service prescriptions' }, { status: 500 });
    }
}
