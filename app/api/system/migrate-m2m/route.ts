import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';

import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const MIGRATION_JSON_MAX_BYTES = 65_536;
const identifier = z.string().refine(value => value.trim().length > 0);
const version = z.number().int().positive();
const snapshotSchema = z.strictObject({ candidates: z.array(z.strictObject({
    patientId: identifier, patientVersion: version,
    primaryAmbulatoryId: identifier, ambulatoryVersion: version,
})) }).superRefine((value, ctx) => {
    if (new Set(value.candidates.map(row => row.patientId)).size !== value.candidates.length) {
        ctx.addIssue({ code: 'custom', message: 'Duplicate patient identifier' });
    }
});
type MigrationSnapshot = z.infer<typeof snapshotSchema>;
const ordered = (rows: MigrationSnapshot['candidates']) => [...rows].sort((a, b) =>
    a.patientId < b.patientId ? -1 : a.patientId > b.patientId ? 1 : 0);

// All reads share the caller's transaction, including the preview's read snapshot.
function inspectMigration(tx: Pick<typeof dbServer, 'select'>) {
    const existingPatients = tx.select({ id: patients.id, version: patients.version, ambulatoryId: patients.ambulatoryId })
        .from(patients).where(isNotNull(patients.ambulatoryId)).all();
    const linked = new Set(tx.select({ id: patientsToAmbulatories.patientId }).from(patientsToAmbulatories).all().map(row => row.id));
    const targets = new Map(tx.select({ id: ambulatories.id, version: ambulatories.version }).from(ambulatories).all()
        .map(row => [row.id, row.version]));
    const candidates: MigrationSnapshot['candidates'] = [];
    for (const patient of existingPatients) {
        if (!patient.ambulatoryId || linked.has(patient.id)) continue;
        const targetVersion = targets.get(patient.ambulatoryId);
        if (!Number.isSafeInteger(patient.version) || patient.version <= 0 || patient.version >= Number.MAX_SAFE_INTEGER
            || targetVersion === undefined || !Number.isSafeInteger(targetVersion) || targetVersion <= 0) {
            return { ok: false as const, status: 409, value: { error: 'Migration candidate is not eligible' } };
        }
        candidates.push({ patientId: patient.id, patientVersion: patient.version,
            primaryAmbulatoryId: patient.ambulatoryId, ambulatoryVersion: targetVersion });
    }
    const snapshot = { candidates: ordered(candidates) };
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MIGRATION_JSON_MAX_BYTES) {
        return { ok: false as const, status: 413, value: { error: 'Migration snapshot exceeds the 65536-byte execution limit; no partial migration is available' } };
    }
    return { ok: true as const, snapshot, total: existingPatients.length };
}

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    try {
        const preview = dbServer.transaction(tx => inspectMigration(tx));
        if (!preview.ok) return NextResponse.json(preview.value, { status: preview.status });
        return NextResponse.json({ success: true, dryRun: true, snapshot: preview.snapshot, total: preview.total });
    } catch (error) {
        console.error('Migration preview failed:', error);
        return NextResponse.json({ error: 'Migration preview failed' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const body = await readBoundedJsonBody(request, MIGRATION_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity }).catch(() => ({ ok: false as const, status: 400 as const }));
        if (!body.ok) return NextResponse.json({ error: body.status === 413 ? 'JSON payload too large' : 'Invalid JSON body' }, { status: body.status });
        const parsed = snapshotSchema.safeParse(body.value);
        if (!parsed.success) return NextResponse.json({ error: 'Invalid migration snapshot' }, { status: 400 });
        const expected = { candidates: ordered(parsed.data.candidates) };
        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx) => {
            const current = inspectMigration(tx);
            if (!current.ok) return current;
            if (JSON.stringify(current.snapshot) !== JSON.stringify(expected)) {
                return { ok: false as const, status: 409, value: { error: 'Migration snapshot changed; inspect again' } };
            }
            let count = 0;
            for (const patient of current.snapshot.candidates) {
                const inserted = tx.insert(patientsToAmbulatories).values({
                    patientId: patient.patientId, ambulatoryId: patient.primaryAmbulatoryId,
                }).run();
                if (inserted.changes !== 1) throw new Error('Migration membership did not insert exactly one row');
                const nextVersion = patient.patientVersion + 1;
                const updated = tx.update(patients).set({ version: nextVersion, updatedAt: new Date() })
                    .where(and(eq(patients.id, patient.patientId), eq(patients.version, patient.patientVersion))).run();
                if (updated.changes !== 1) throw new Error('Migration patient version did not update exactly one row');
                writeAuditEventInTransaction(tx, {
                    eventType: 'patient.updated', outcome: 'success',
                    actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    subjectType: 'patient', subjectRef: patient.patientId,
                    sourceSurface: auditContext.sourceSurface, requestId,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        changedFields: ['ambulatoryMemberships'], resourceVersion: nextVersion,
                        flags: ['membership:migrated'],
                    }),
                });
                count += 1;
            }
            return { ok: true as const, value: { success: true, migrated: count, total: current.total } };
        }, { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.ok ? 200 : result.status });
    } catch (error) {
        console.error("Migration fatal error:", error);
        return NextResponse.json({ error: "Migration failed" }, { status: 500 });
    }
}
