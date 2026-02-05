import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { patientIds, targetAmbulatoryId, sourceAmbulatoryId } = await request.json();

        if (!patientIds || !Array.isArray(patientIds) || patientIds.length === 0) {
            return NextResponse.json({ error: "Invalid patient IDs" }, { status: 400 });
        }

        if (!targetAmbulatoryId) {
            return NextResponse.json({ error: "Target ambulatory ID required" }, { status: 400 });
        }

        // Verify target ambulatory exists? (Optional, but good practice. Assuming UI handles validity mostly)
        // For now, raw update for speed/simplicity as per plan

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

        return NextResponse.json({ success: true, count: patientIds.length });
    } catch (error) {
        console.error("Move patients error:", error);
        return NextResponse.json({ error: "Failed to move patients" }, { status: 500 });
    }
}
