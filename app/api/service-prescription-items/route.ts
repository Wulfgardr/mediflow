/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    createHostServicePrescriptionItem,
    listServicePrescriptionItems,
} from '@/lib/service-prescription-write';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { searchParams } = new URL(request.url);
        const data = await listServicePrescriptionItems({
            patientId: searchParams.get('patientId')?.trim(),
            prescriptionId: searchParams.get('prescriptionId')?.trim(),
        });
        return NextResponse.json(data);
    } catch (error) {
        console.error('API GET /service-prescription-items error:', error);
        return NextResponse.json({ error: 'Failed to fetch service prescription items' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json() as Record<string, unknown>;
        const result = await createHostServicePrescriptionItem({ request, session }, body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /service-prescription-items error:', error);
        return NextResponse.json({ error: 'Failed to create service prescription item' }, { status: 500 });
    }
}
