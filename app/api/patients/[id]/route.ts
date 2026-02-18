import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { eq } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

/* @Codex */
function normalizeExemptionsForUpdate(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    return null;
}

/* @Codex */
function normalizeDiagnosesForUpdate(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const patient = await dbServer.select().from(patients).where(eq(patients.id, id)).get();
        if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(patient);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch patient" }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json();
        const normalizedExemptions = normalizeExemptionsForUpdate(body.exemptions);
        /* @Codex */
        const normalizedDiagnoses = normalizeDiagnosesForUpdate(body.diagnoses);
        await dbServer.update(patients)
            .set({
                ...body,
                /* @Codex */
                exemptions: normalizedExemptions,
                /* @Codex */
                diagnoses: normalizedDiagnoses,
                /* @Codex */
                monitoringProfile: typeof body.monitoringProfile === 'string'
                    ? body.monitoringProfile
                    : body.monitoringProfile === null
                        ? null
                        : undefined,
                /* @Codex */
                statusReason: typeof body.statusReason === 'string'
                    ? body.statusReason
                    : body.statusReason === null
                        ? null
                        : undefined,
                updatedAt: new Date(),
                birthDate: body.birthDate ? new Date(body.birthDate) : undefined
            })
            .where(eq(patients.id, id));

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        await dbServer.delete(patients).where(eq(patients.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    }
}
