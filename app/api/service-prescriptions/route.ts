import { readPrescriptionJsonObject } from '@/lib/prescription-json-body';
/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    createHostServicePrescription,
    listServicePrescriptions,
} from '@/lib/service-prescription-write';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const patientId = new URL(request.url).searchParams.get('patientId');
        return NextResponse.json(await listServicePrescriptions(patientId));
    } catch (error) {
        console.error('API GET /service-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to fetch service prescriptions' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const parsedBody = await readPrescriptionJsonObject(request);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.body;
        const result = await createHostServicePrescription({ request, session }, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /service-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to create service prescription' }, { status: 500 });
    }
}
