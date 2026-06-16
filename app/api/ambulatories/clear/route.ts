import { dbServer } from '@/lib/db-server';
import { ambulatories } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/server-auth';
// WUL-322 (ADR 0066 Slice 3): membership-based clear, soft-delete only
import { clearTestContainerByMembership, TEST_CONTAINER_CLEAR_REASON } from '@/lib/test-container-clear';
import { safeWriteAuditEventFromRequest } from '@/lib/audit';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        const { ambulatoryId } = await request.json();

        if (!ambulatoryId) {
            return NextResponse.json({ error: "Ambulatory ID required" }, { status: 400 });
        }

        // 1. Verify it's a TEST ambulatory
        const target = await dbServer.select().from(ambulatories).where(eq(ambulatories.id, ambulatoryId)).limit(1);

        if (!target.length) {
            return NextResponse.json({ error: "Ambulatory not found" }, { status: 404 });
        }

        if (target[0].type !== 'test') {
            return NextResponse.json({ error: "Safety Check: Cannot clear a LIVE ambulatory" }, { status: 403 });
        }

        // 2. WUL-322 (ADR 0066 Slice 3): clear by M2M membership, never by the stale
        // legacy ambulatory column on patients (WUL-300). Patients that also belong
        // to a live ambulatory only lose the test link; test-only patients get the
        // WUL-306 soft-delete tombstone (recoverable, clinical children intact).
        // better-sqlite3 transactions are synchronous; promise callbacks break execution.
        const result = dbServer.transaction((tx) => clearTestContainerByMembership(tx, ambulatoryId));

        for (const cleared of result.clearedPatients) {
            await safeWriteAuditEventFromRequest(
                request,
                session,
                {
                    eventType: 'patient.deleted',
                    subjectType: 'patient',
                    subjectRef: cleared.id,
                    redactedMetadata: {
                        reasonCode: TEST_CONTAINER_CLEAR_REASON,
                        resourceVersion: cleared.version,
                    },
                },
                '[MediFlow] Test-container clear audit write failed:',
            );
        }

        return NextResponse.json({
            success: true,
            message: "Test container cleared",
            clearedPatients: result.clearedPatients.length,
            preservedLivePatients: result.preservedLivePatientIds.length,
            removedMembershipRows: result.removedMembershipRows,
        });
    } catch (error) {
        console.error("Clear ambulatory error:", error);
        return NextResponse.json({ error: "Failed to clear ambulatory" }, { status: 500 });
    }
}
