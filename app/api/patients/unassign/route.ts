import { dbServer } from '@/lib/db-server';
import { patientsToAmbulatories } from '@/lib/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { patientIds, ambulatoryId } = await request.json();

        if (!patientIds || !Array.isArray(patientIds) || !ambulatoryId) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        // Delete the link
        await dbServer.delete(patientsToAmbulatories)
            .where(
                and(
                    eq(patientsToAmbulatories.ambulatoryId, ambulatoryId),
                    inArray(patientsToAmbulatories.patientId, patientIds)
                )
            );

        return NextResponse.json({ success: true, count: patientIds.length });
    } catch (error) {
        console.error("Unassign patients error:", error);
        return NextResponse.json({ error: "Failed to unlink patients" }, { status: 500 });
    }
}
