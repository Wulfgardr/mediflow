import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { normalizeId, normalizeIdList } from '@/lib/patient-bulk-validation';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json() as Record<string, unknown>;
        const patientIds = normalizeIdList(body.patientIds);
        const targetAmbulatoryId = normalizeId(body.targetAmbulatoryId);

        if (patientIds.length === 0 || !targetAmbulatoryId) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const target = await dbServer
            .select({ id: ambulatories.id })
            .from(ambulatories)
            .where(eq(ambulatories.id, targetAmbulatoryId))
            .get();
        if (!target) {
            return NextResponse.json({ error: 'Target ambulatory not found' }, { status: 404 });
        }

        // Fetch original patients
        const originals = await dbServer.select().from(patients).where(inArray(patients.id, patientIds));
        const originalIds = new Set(originals.map((item) => item.id));
        const missingPatientIds = patientIds.filter((id) => !originalIds.has(id));
        if (missingPatientIds.length > 0) {
            return NextResponse.json(
                { error: 'Some patients were not found', missingPatientIds },
                { status: 404 }
            );
        }

        let count = 0;
        for (const p of originals) {
            const newId = uuidv4();

            // Clone patient data
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _oldId, createdAt: _c, updatedAt: _u, ambulatoryId: _oldAmb, ...data } = p;

            // Insert Clone
            await dbServer.insert(patients).values({
                id: newId,
                ...data,
                /* @Codex */
                firstName: p.firstName,
                createdAt: new Date(),
                updatedAt: new Date(),
                ambulatoryId: targetAmbulatoryId // Set primary ownership too for compat
            });

            // Create Link
            await dbServer.insert(patientsToAmbulatories).values({
                patientId: newId,
                ambulatoryId: targetAmbulatoryId
            }).onConflictDoNothing();
            count++;
        }

        return NextResponse.json({ success: true, count });
    } catch (error) {
        console.error("Duplicate patients error:", error);
        return NextResponse.json({ error: "Failed to duplicate patients" }, { status: 500 });
    }
}
