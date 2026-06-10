import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { buildPatientVersionConflictPayload, parseExpectedVersion } from '@/lib/patient-concurrency';
// WUL-306 (ADR 0066): soft-delete lifecycle helpers
import { activePatients, buildPatientTombstoneValues } from '@/lib/patient-lifecycle';
/* @Codex */
import { normalizePatientUpdateInput } from '@/lib/patient-write-normalization';
/* @Codex */
import {
    auditContextFromSession,
    classifyPatientMutationEvent,
    listChangedFields,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/audit';

/* @Codex */
async function recordPatientAuditEvent(
    request: Request,
    session: Awaited<ReturnType<typeof requireSession>>,
    eventType: Parameters<typeof writeAuditEvent>[0]['eventType'],
    subjectRef: string,
    redactedMetadata: Parameters<typeof writeAuditEvent>[0]['redactedMetadata']
): Promise<void> {
    try {
        const context = auditContextFromSession(session);
        await writeAuditEvent({
            eventType,
            outcome: 'success',
            actorType: context.actorType,
            actorRef: context.actorRef,
            subjectType: 'patient',
            subjectRef,
            sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(request),
            redactedMetadata: withAuditContextMetadata(context, redactedMetadata),
        });
    } catch (error) {
        console.error('[MediFlow] Patient audit write failed:', error);
    }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const patient = await dbServer.select().from(patients).where(and(eq(patients.id, id), activePatients())).get();
        if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(patient);
    } catch {
        return NextResponse.json({ error: "Failed to fetch patient" }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;
        /* @Codex */
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        // WUL-306: a soft-deleted patient is gone for the wire contract: PUT answers 404.
        const existing = await dbServer.select({ id: patients.id, isArchived: patients.isArchived }).from(patients).where(and(eq(patients.id, id), activePatients())).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizePatientUpdateInput(body, {
            expectedVersion,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        /* @Codex */
        const updateResult = await dbServer
            .update(patients)
            .set(normalized.values)
            .where(and(eq(patients.id, id), eq(patients.version, expectedVersion), activePatients()))
            .run();

        if (updateResult.changes === 0) {
            const current = await dbServer
                .select({
                    id: patients.id,
                    version: patients.version,
                    updatedAt: patients.updatedAt,
                    isArchived: patients.isArchived
                })
                .from(patients)
                .where(and(eq(patients.id, id), activePatients()))
                .get();
            return NextResponse.json(
                buildPatientVersionConflictPayload(expectedVersion, id, current ?? null),
                { status: 409 }
            );
        }

        if (Object.prototype.hasOwnProperty.call(body, 'ambulatoryId')) {
            await dbServer.delete(patientsToAmbulatories).where(eq(patientsToAmbulatories.patientId, id));
            const normalizedAmbulatoryId = normalized.values.ambulatoryId;
            if (typeof normalizedAmbulatoryId === 'string' && normalizedAmbulatoryId.trim().length > 0) {
                await dbServer.insert(patientsToAmbulatories).values({
                    patientId: id,
                    ambulatoryId: normalizedAmbulatoryId,
                    assignedAt: new Date()
                }).onConflictDoNothing();
            }
        }

        /* @Codex */
        await recordPatientAuditEvent(
            request,
            session,
            classifyPatientMutationEvent(existing.isArchived ?? null, normalized.values.isArchived as boolean | undefined),
            id,
            {
                changedFields: listChangedFields(body, ['version']),
                resourceVersion: expectedVersion + 1,
            }
        );

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        /* @Codex */
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer.select({ id: patients.id }).from(patients).where(and(eq(patients.id, id), activePatients())).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        // WUL-306: DELETE keeps the soft-delete tombstone (ADR 0066); clinical child rows
        // stay linked for the audited admin purge. Wire contract unchanged.
        const deleteResult = await dbServer
            .update(patients)
            .set(buildPatientTombstoneValues(expectedVersion, 'web-delete'))
            .where(and(eq(patients.id, id), eq(patients.version, expectedVersion), activePatients()))
            .run();

        if (deleteResult.changes === 0) {
            const current = await dbServer
                .select({
                    id: patients.id,
                    version: patients.version,
                    updatedAt: patients.updatedAt,
                    isArchived: patients.isArchived
                })
                .from(patients)
                .where(and(eq(patients.id, id), activePatients()))
                .get();
            return NextResponse.json(
                buildPatientVersionConflictPayload(expectedVersion, id, current ?? null),
                { status: 409 }
            );
        }

        /* @Codex */
        await recordPatientAuditEvent(request, session, 'patient.deleted', id, {
            resourceVersion: expectedVersion,
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    }
}
