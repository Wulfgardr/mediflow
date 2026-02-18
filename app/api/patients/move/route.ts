import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
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
        const sourceAmbulatoryId = normalizeId(body.sourceAmbulatoryId);

        if (patientIds.length === 0) {
            return NextResponse.json({ error: "Invalid patient IDs" }, { status: 400 });
        }

        if (!targetAmbulatoryId) {
            return NextResponse.json({ error: "Target ambulatory ID required" }, { status: 400 });
        }

        const target = await dbServer
            .select({ id: ambulatories.id })
            .from(ambulatories)
            .where(eq(ambulatories.id, targetAmbulatoryId))
            .get();
        if (!target) {
            return NextResponse.json({ error: 'Target ambulatory not found' }, { status: 404 });
        }

        const existingPatients = await dbServer
            .select({ id: patients.id })
            .from(patients)
            .where(inArray(patients.id, patientIds));
        const existingIds = new Set(existingPatients.map((item) => item.id));
        const missingPatientIds = patientIds.filter((id) => !existingIds.has(id));
        if (missingPatientIds.length > 0) {
            return NextResponse.json(
                { error: 'Some patients were not found', missingPatientIds },
                { status: 404 }
            );
        }

        /* @Codex */
        if (sourceAmbulatoryId) {
            await dbServer.delete(patientsToAmbulatories)
                .where(and(
                    eq(patientsToAmbulatories.ambulatoryId, sourceAmbulatoryId),
                    inArray(patientsToAmbulatories.patientId, patientIds)
                ));
        }

        /* @Codex */
        await dbServer.insert(patientsToAmbulatories)
            .values(patientIds.map((patientId: string) => ({
                patientId,
                ambulatoryId: targetAmbulatoryId
            })))
            .onConflictDoNothing();

        await dbServer.update(patients)
            .set({ ambulatoryId: targetAmbulatoryId, updatedAt: new Date() })
            .where(inArray(patients.id, patientIds));

        return NextResponse.json({
            success: true,
            count: patientIds.length,
            targetAmbulatoryId,
            sourceAmbulatoryId: sourceAmbulatoryId ?? null
        });
    } catch (error) {
        console.error("Move patients error:", error);
        return NextResponse.json({ error: "Failed to move patients" }, { status: 500 });
    }
}
