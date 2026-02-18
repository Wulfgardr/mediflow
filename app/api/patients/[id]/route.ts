import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
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
        const body = await request.json() as Record<string, unknown>;

        const existing = await dbServer.select({ id: patients.id }).from(patients).where(eq(patients.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalizedExemptions = normalizeExemptionsForUpdate(body.exemptions);
        /* @Codex */
        const normalizedDiagnoses = normalizeDiagnosesForUpdate(body.diagnoses);
        const birthDate = body.birthDate === null || body.birthDate === ''
            ? null
            : body.birthDate !== undefined
                ? new Date(body.birthDate as string | number | Date)
                : undefined;
        if (birthDate instanceof Date && Number.isNaN(birthDate.getTime())) {
            return NextResponse.json({ error: 'Invalid birthDate' }, { status: 400 });
        }

        const updateValues: Partial<typeof patients.$inferInsert> = {
            firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
            lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
            taxCode: typeof body.taxCode === 'string' ? body.taxCode : undefined,
            address: typeof body.address === 'string' ? body.address : undefined,
            phone: typeof body.phone === 'string' ? body.phone : undefined,
            caregiver: typeof body.caregiver === 'string' ? body.caregiver : undefined,
            notes: typeof body.notes === 'string' ? body.notes : undefined,
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
            aiSummary: typeof body.aiSummary === 'string' ? body.aiSummary : undefined,
            documentInsights: typeof body.documentInsights === 'string' ? body.documentInsights : undefined,
            isAdi: typeof body.isAdi === 'boolean' ? body.isAdi : undefined,
            isArchived: typeof body.isArchived === 'boolean' ? body.isArchived : undefined,
            ambulatoryId: typeof body.ambulatoryId === 'string'
                ? body.ambulatoryId
                : body.ambulatoryId === null
                    ? null
                    : undefined,
            birthDate,
            updatedAt: new Date()
        };

        if (normalizedExemptions !== undefined) {
            updateValues.exemptions = normalizedExemptions;
        }
        /* @Codex */
        if (normalizedDiagnoses !== undefined) {
            updateValues.diagnoses = normalizedDiagnoses;
        }

        const hasUpdatableField = Object.entries(updateValues).some(
            ([key, value]) => key !== 'updatedAt' && value !== undefined
        );
        if (!hasUpdatableField) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(patients).set(updateValues).where(eq(patients.id, id));

        if (Object.prototype.hasOwnProperty.call(body, 'ambulatoryId')) {
            await dbServer.delete(patientsToAmbulatories).where(eq(patientsToAmbulatories.patientId, id));
            if (typeof body.ambulatoryId === 'string' && body.ambulatoryId.trim().length > 0) {
                await dbServer.insert(patientsToAmbulatories).values({
                    patientId: id,
                    ambulatoryId: body.ambulatoryId,
                    assignedAt: new Date()
                }).onConflictDoNothing();
            }
        }

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
        const existing = await dbServer.select({ id: patients.id }).from(patients).where(eq(patients.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        await dbServer.delete(patients).where(eq(patients.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    }
}
