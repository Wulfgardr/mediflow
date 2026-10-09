import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, ambulatories, patientsToAmbulatories } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
// WUL-306 (ADR 0066): historical orphan child rows (patient_id no longer resolves)
import {
    countOrphanedClinicalRows,
    purgeOrphanedClinicalRows,
    totalPatientCascadeRows,
} from '@/lib/patient-cascade';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';

const REPAIR_JSON_MAX_BYTES = 65_536;

export const dynamic = 'force-dynamic';

/* @Codex */
export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

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
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const parsed = await readBoundedJsonBody(request, REPAIR_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity }, 'empty-object')
            .catch(() => ({ ok: false as const, status: 400 as const }));
        if (!parsed.ok) return NextResponse.json({ error: parsed.status === 413 ? 'JSON payload too large' : 'Invalid JSON body' }, { status: parsed.status });
        if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const body = parsed.value as Record<string, unknown>;
        if (Object.hasOwn(body, 'purgeOrphanedClinicalRows') && typeof body.purgeOrphanedClinicalRows !== 'boolean') {
            return NextResponse.json({ error: 'purgeOrphanedClinicalRows must be a boolean' }, { status: 400 });
        }
        const purgeRequested = body.purgeOrphanedClinicalRows === true;
        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const actor = { actorType: auditContext.actorType, actorRef: auditContext.actorRef,
            sourceSurface: auditContext.sourceSurface, requestId };

        const result = dbServer.transaction((tx) => {
            const target = tx.select().from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1).get()
                ?? tx.select().from(ambulatories).limit(1).get();
            const targetAmbId = target?.id ?? uuidv4();
            const targetAmbName = target?.name ?? 'Sede Principale';
            const allPatients = tx.select({ id: patients.id }).from(patients).all();
            const allLinks = tx.select({ pid: patientsToAmbulatories.patientId }).from(patientsToAmbulatories).all();
            const linkedPids = new Set(allLinks.map(link => link.pid));
            const orphanPids = allPatients.filter(patient => !linkedPids.has(patient.id)).map(patient => patient.id);

            if (!target) {
                const inserted = tx.insert(ambulatories).values({
                    id: targetAmbId, name: 'Sede Principale', address: 'Sede Centrale',
                    isDefault: true, type: 'live', createdAt: new Date(),
                }).run();
                if (inserted.changes !== 1) throw new Error('Repair default did not insert exactly one row');
                writeAuditEventInTransaction(tx, { ...actor,
                    eventType: 'ambulatory.created', outcome: 'success',
                    subjectType: 'ambulatory', subjectRef: targetAmbId,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        resourceVersion: 1, flags: ['fix-orphans:default-created'],
                    }),
                });
            }

            let fixed = 0;
            for (const pid of orphanPids) {
                const inserted = tx.insert(patientsToAmbulatories)
                    .values({ patientId: pid, ambulatoryId: targetAmbId }).onConflictDoNothing().run();
                if (inserted.changes !== 1) throw new Error('Orphan relink did not insert exactly one row');
                fixed += 1;
                writeAuditEventInTransaction(tx, { ...actor,
                    eventType: 'patient.updated', outcome: 'success', subjectType: 'patient', subjectRef: pid,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        changedFields: ['ambulatoryMemberships'], flags: ['membership:relinked'],
                    }),
                });
            }

            let purgedOrphanChildRows = null;
            if (purgeRequested) {
                const pending = countOrphanedClinicalRows(tx);
                // An empty replay must neither claim a purge nor revoke locator authority.
                purgedOrphanChildRows = totalPatientCascadeRows(pending) > 0 ? purgeOrphanedClinicalRows(tx) : pending;
                if (totalPatientCascadeRows(purgedOrphanChildRows) > 0) {
                    writeAuditEventInTransaction(tx, { ...actor,
                        eventType: 'patient.purged', outcome: 'success', subjectType: 'patient', subjectRef: null,
                        redactedMetadata: withAuditContextMetadata(auditContext, {
                            reasonCode: 'fix-orphans', counts: totalPatientCascadeRows(purgedOrphanChildRows),
                            flags: Object.entries(purgedOrphanChildRows).map(([table, count]) => `purged:${table}:${count}`),
                        }),
                    });
                }
            }

            if (fixed === 0 && !purgeRequested) {
                return { success: true, fixed: 0, message: 'No orphans found. All patients are linked.' };
            }
            return {
                success: true, fixed, purgedOrphanChildRows,
                message: fixed > 0
                    ? `Created/Used Default Ambulatory and linked ${fixed} orphan patients to '${targetAmbName}'. Refresh the page.`
                    : 'No orphan patients to relink.',
            };
        }, { behavior: 'immediate' });
        return NextResponse.json(result);

    } catch (error) {
        console.error("Fix Orphan Error:", error);
        /* @Codex */
        return NextResponse.json({ error: 'Failed to fix orphan patients' }, { status: 500 });
    }
}
