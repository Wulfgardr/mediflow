import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, ambulatories, patientsToAmbulatories } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/server-auth';
// WUL-306 (ADR 0066): historical orphan child rows (patient_id no longer resolves)
import {
    countOrphanedClinicalRows,
    purgeOrphanedClinicalRows,
    totalPatientCascadeRows,
} from '@/lib/patient-cascade';
import { safeWriteAuditEventFromRequest } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/* @Codex */
export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        const defaults = await dbServer.select().from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1);
        const targetAmb = defaults[0] ?? (await dbServer.select().from(ambulatories).limit(1))[0] ?? null;

        const allPatients = await dbServer.select({ id: patients.id }).from(patients);
        const allLinks = await dbServer.select({ pid: patientsToAmbulatories.patientId }).from(patientsToAmbulatories);
        const linkedPids = new Set(allLinks.map(l => l.pid));
        const orphanCount = allPatients.filter(p => !linkedPids.has(p.id)).length;

        // WUL-306 (ADR 0066): report child rows whose patient_id does not resolve.
        const orphanChildRowCounts = countOrphanedClinicalRows(dbServer);

        return NextResponse.json({
            success: true,
            dryRun: true,
            totalPatients: allPatients.length,
            orphanCount,
            orphanChildRowCounts,
            totalOrphanChildRows: totalPatientCascadeRows(orphanChildRowCounts),
            targetAmbulatoryId: targetAmb?.id ?? null,
            targetAmbulatoryName: targetAmb?.name ?? null,
            willCreateDefaultAmbulatory: !targetAmb
        });
    } catch (error) {
        console.error("Fix Orphan Dry-Run Error:", error);
        /* @Codex */
        return NextResponse.json({ error: 'Failed to inspect orphan patients' }, { status: 500 });
    }
}

/* @Codex */
export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        console.log("Fixing Orphans...");

        // WUL-306 (ADR 0066): orphan child rows are purged only behind an explicit flag.
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const purgeOrphanedClinicalRowsRequested = body.purgeOrphanedClinicalRows === true;

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

        // 5. WUL-306 (ADR 0066): purge child rows whose patient_id no longer resolves,
        // only behind the explicit flag and AFTER the relink step above.
        let purgedOrphanChildRows = null;
        if (purgeOrphanedClinicalRowsRequested) {
            // @Codex better-sqlite3 transactions are synchronous; promise callbacks break execution.
            const counts = dbServer.transaction((tx) => purgeOrphanedClinicalRows(tx));
            purgedOrphanChildRows = counts;
            await safeWriteAuditEventFromRequest(
                request,
                session,
                {
                    eventType: 'patient.purged',
                    subjectType: 'patient',
                    subjectRef: null,
                    redactedMetadata: {
                        reasonCode: 'fix-orphans',
                        counts: totalPatientCascadeRows(counts),
                        flags: Object.entries(counts).map(([table, count]) => `purged:${table}:${count}`),
                    },
                },
                '[MediFlow] Orphan purge audit write failed:',
            );
        }

        if (fixed === 0 && !purgeOrphanedClinicalRowsRequested) {
            return NextResponse.json({ success: true, fixed: 0, message: "No orphans found. All patients are linked." });
        }

        return NextResponse.json({
            success: true,
            fixed,
            purgedOrphanChildRows,
            message: fixed > 0
                ? `Created/Used Default Ambulatory and linked ${fixed} orphan patients to '${targetAmbName}'. Refresh the page.`
                : "No orphan patients to relink."
        });

    } catch (error) {
        console.error("Fix Orphan Error:", error);
        /* @Codex */
        return NextResponse.json({ error: 'Failed to fix orphan patients' }, { status: 500 });
    }
}
