import { dbServer } from '@/lib/db-server';
import { patientsToAmbulatories } from '@/lib/schema';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { patientIds, targetAmbulatoryId } = await request.json();

        if (!patientIds || !Array.isArray(patientIds) || !targetAmbulatoryId) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        let count = 0;
        for (const pid of patientIds) {
            // Use insert ignore or check existence
            // SQLite INSERT OR IGNORE syntax with Drizzle: .onConflictDoNothing()
            await dbServer.insert(patientsToAmbulatories)
                .values({
                    patientId: pid,
                    ambulatoryId: targetAmbulatoryId,
                })
                .onConflictDoNothing();
            count++;
        }

        return NextResponse.json({ success: true, count });
    } catch (error) {
        console.error("Assign patients error:", error);
        return NextResponse.json({ error: "Failed to assign patients" }, { status: 500 });
    }
}
