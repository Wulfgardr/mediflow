import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, ambulatories, patientsToAmbulatories } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        console.log("Fixing Orphans...");

        // 1. Get Target Ambulatory (Default or First)
        let targetAmbId: string | null = null;
        let targetAmbName = "";

        const defaults = await dbServer.select().from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1);
        if (defaults.length > 0) {
            targetAmbId = defaults[0].id;
            targetAmbName = defaults[0].name;
        } else {
            const all = await dbServer.select().from(ambulatories).limit(1);
            if (all.length > 0) {
                targetAmbId = all[0].id;
                targetAmbName = all[0].name;
            }
        }

        // 2. Create Default if Missing (Emergency Restore)
        if (!targetAmbId) {
            console.log("No ambulatories found. Creating Default Ambulatory 'Sede Principale'...");
            const newId = uuidv4();
            await dbServer.insert(ambulatories).values({
                id: newId,
                name: "Sede Principale",
                address: "Sede Centrale",
                isDefault: true,
                type: 'live',
                createdAt: new Date()
            });
            targetAmbId = newId;
            targetAmbName = "Sede Principale";
        }

        // 3. Find Orphans
        const allPatients = await dbServer.select({ id: patients.id }).from(patients);
        const allLinks = await dbServer.select({ pid: patientsToAmbulatories.patientId }).from(patientsToAmbulatories);

        const linkedPids = new Set(allLinks.map(l => l.pid));
        const orphanPids = allPatients.filter(p => !linkedPids.has(p.id)).map(p => p.id);

        console.log(`Found ${orphanPids.length} orphans from ${allPatients.length} total patients.`);

        if (orphanPids.length === 0) {
            return NextResponse.json({ success: true, fixed: 0, message: "No orphans found. All patients are linked." });
        }

        // 4. Link Orphans
        let fixed = 0;
        for (const pid of orphanPids) {
            await dbServer.insert(patientsToAmbulatories)
                .values({
                    patientId: pid,
                    ambulatoryId: targetAmbId,
                })
                .onConflictDoNothing();
            fixed++;
        }

        return NextResponse.json({
            success: true,
            fixed,
            message: `Created/Used Default Ambulatory and linked ${fixed} orphan patients to '${targetAmbName}'. Refresh the page.`
        });

    } catch (error) {
        console.error("Fix Orphan Error:", error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ error: String(error), details: (error as any)?.message }, { status: 500 });
    }
}
