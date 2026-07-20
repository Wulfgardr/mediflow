import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { patientUnassignSchema } from '@/lib/api-schemas/patient-bulk';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
// WUL-306 (ADR 0066): bulk reads treat soft-deleted patients as missing
import { activePatients } from '@/lib/patient-lifecycle';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const parsedBody = parseApiBody(patientUnassignSchema, await request.json());
        if (!parsedBody.ok) return parsedBody.response;
        const { patientIds, ambulatoryId } = parsedBody.data;

        const target = await dbServer
            .select({ id: ambulatories.id })
            .from(ambulatories)
            .where(eq(ambulatories.id, ambulatoryId))
            .get();
        if (!target) {
            return NextResponse.json({ error: 'Ambulatory not found' }, { status: 404 });
        }

        const existingPatients = await dbServer
            .select({ id: patients.id })
            .from(patients)
            .where(and(inArray(patients.id, patientIds), activePatients()));
        const existingIds = new Set(existingPatients.map((item) => item.id));
        const missingPatientIds = patientIds.filter((id) => !existingIds.has(id));
        if (missingPatientIds.length > 0) {
            return NextResponse.json(
                { error: 'Some patients were not found', missingPatientIds },
                { status: 404 }
            );
        }

        // Delete the link
        await dbServer.delete(patientsToAmbulatories)
            .where(
                and(
                    eq(patientsToAmbulatories.ambulatoryId, ambulatoryId),
                    inArray(patientsToAmbulatories.patientId, patientIds)
                )
            );

        return NextResponse.json({ success: true, count: patientIds.length, ambulatoryId });
    } catch (error) {
        console.error("Unassign patients error:", error);
        return NextResponse.json({ error: "Failed to unlink patients" }, { status: 500 });
    }
}
