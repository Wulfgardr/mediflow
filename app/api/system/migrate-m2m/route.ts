import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
import { eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';

export async function POST() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        console.log("Starting Migration to Many-to-Many...");

        // 1. Get all patients with an ambulatoryId
        const existingPatients = await dbServer.select().from(patients).where(isNotNull(patients.ambulatoryId));

        console.log(`Found ${existingPatients.length} patients to migrate.`);
        let count = 0;

        for (const p of existingPatients) {
            if (!p.ambulatoryId) continue;

            // Check if already linked
            const existingLink = await dbServer.select()
                .from(patientsToAmbulatories)
                .where(eq(patientsToAmbulatories.patientId, p.id))
                .limit(1);

            if (existingLink.length === 0) {
                await dbServer.insert(patientsToAmbulatories).values({
                    patientId: p.id,
                    ambulatoryId: p.ambulatoryId,
                });
                count++;
            }
        }

        return NextResponse.json({ success: true, migrated: count, total: existingPatients.length });
    } catch (error) {
        console.error("Migration fatal error:", error);
        return NextResponse.json({ error: "Migration failed" }, { status: 500 });
    }
}
