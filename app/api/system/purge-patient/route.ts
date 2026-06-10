// WUL-306 (ADR 0066): audited admin purge of a soft-deleted patient (GDPR Art. 17 tool).
// Modeled on fix-orphans: GET dry-run with per-table counts, POST execute, admin only.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/server-auth';
import {
    countPatientCascadeRows,
    purgePatientCascade,
    totalPatientCascadeRows,
    type PatientCascadeCounts,
} from '@/lib/patient-cascade';
import { safeWriteAuditEventFromRequest } from '@/lib/audit';

export const dynamic = 'force-dynamic';

function cascadeCountFlags(prefix: string, counts: PatientCascadeCounts): string[] {
    return Object.entries(counts).map(([table, count]) => `${prefix}:${table}:${count}`);
}

// Purge deliberately bypasses the activePatients() read filter: it must see tombstones.
function selectPatientLifecycleRow(patientId: string) {
    return dbServer
        .select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt })
        .from(patients)
        .where(eq(patients.id, patientId))
        .get();
}

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        const { searchParams } = new URL(request.url);
        const patientId = searchParams.get('patientId')?.trim() ?? '';
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        const patient = await selectPatientLifecycleRow(patientId);
        if (!patient) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const childRowCounts = countPatientCascadeRows(dbServer, patientId);
        return NextResponse.json({
            success: true,
            dryRun: true,
            patientId,
            patientState: patient.deletedAt ? 'soft-deleted' : 'active',
            childRowCounts,
            totalChildRows: totalPatientCascadeRows(childRowCounts),
        });
    } catch (error) {
        console.error('[MediFlow] Purge patient dry-run failed:', error);
        return NextResponse.json({ error: 'Purge dry-run failed' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        const patient = await selectPatientLifecycleRow(patientId);
        if (!patient) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        // Double confirmation: erasure only follows an explicit operational soft-delete.
        if (!patient.deletedAt) {
            return NextResponse.json(
                { error: 'Patient is still active: soft-delete it before purging' },
                { status: 409 }
            );
        }

        // @Codex better-sqlite3 transactions are synchronous; promise callbacks break execution.
        const childRowCounts = dbServer.transaction((tx) => {
            const counts = purgePatientCascade(tx, patientId);
            tx.delete(patients).where(eq(patients.id, patientId)).run();
            return counts;
        });

        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'patient.purged',
                subjectType: 'patient',
                subjectRef: patientId,
                redactedMetadata: {
                    counts: totalPatientCascadeRows(childRowCounts),
                    flags: cascadeCountFlags('purged', childRowCounts),
                },
            },
            '[MediFlow] Patient purge audit write failed:',
        );

        return NextResponse.json({
            success: true,
            patientId,
            childRowCounts,
            totalChildRows: totalPatientCascadeRows(childRowCounts),
        });
    } catch (error) {
        console.error('[MediFlow] Purge patient failed:', error);
        return NextResponse.json({ error: 'Purge failed' }, { status: 500 });
    }
}
