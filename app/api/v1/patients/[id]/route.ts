// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { PatientDetail } from '@/lib/api/v1/types';
/* @Codex */
import { buildPatientVersionConflictPayload, parseExpectedVersion } from '@/lib/patient-concurrency';
/* @Codex */
import { normalizePatientUpdateInput } from '@/lib/patient-write-normalization';
/* @Codex */
import {
    auditContextFromRequest,
    classifyPatientMutationEvent,
    listChangedFields,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* @Codex */
async function recordPatientAuditEvent(
    request: Request,
    eventType: Parameters<typeof writeAuditEvent>[0]['eventType'],
    subjectRef: string,
    redactedMetadata: Parameters<typeof writeAuditEvent>[0]['redactedMetadata']
): Promise<void> {
    try {
        const session = await requireLocalApiActorSession(request);
        const context = auditContextFromRequest(request, session);
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
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const patient = await dbServer.select().from(patients).where(eq(patients.id, id)).get();

        if (!patient) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: PatientDetail = {
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            birthDate: toIsoString(patient.birthDate),
            taxCode: patient.taxCode,
            address: patient.address ?? null,
            phone: patient.phone ?? null,
            caregiver: patient.caregiver ?? null,
            /* @Codex */
            exemptions: patient.exemptions ?? null,
            /* @Codex */
            diagnoses: patient.diagnoses ?? null,
            /* @Codex */
            monitoringProfile: patient.monitoringProfile ?? null,
            /* @Codex */
            statusReason: patient.statusReason ?? null,
            notes: patient.notes ?? null,
            /* @Codex */
            aiSummary: patient.aiSummary ?? null,
            /* @Codex */
            documentInsights: patient.documentInsights ?? null,
            isAdi: patient.isAdi ?? null,
            isArchived: patient.isArchived ?? null,
            /* @Codex */
            version: patient.version,
            ambulatoryId: patient.ambulatoryId ?? null,
            createdAt: toIsoString(patient.createdAt),
            updatedAt: toIsoString(patient.updatedAt)
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to fetch patient' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;
        /* @Codex */
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer.select({ id: patients.id, isArchived: patients.isArchived }).from(patients).where(eq(patients.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizePatientUpdateInput(body as Record<string, unknown>, {
            expectedVersion,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        /* @Codex */
        const updateResult = await dbServer
            .update(patients)
            .set(normalized.values)
            .where(and(eq(patients.id, id), eq(patients.version, expectedVersion)))
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
                .where(eq(patients.id, id))
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
            classifyPatientMutationEvent(existing.isArchived ?? null, normalized.values.isArchived as boolean | undefined),
            id,
            {
                changedFields: listChangedFields(body, ['version']),
                resourceVersion: expectedVersion + 1,
            }
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 });
    }
}

/* @Codex */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        /* @Codex */
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer.select({ id: patients.id }).from(patients).where(eq(patients.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        /* @Codex */
        const deleteResult = await dbServer
            .delete(patients)
            .where(and(eq(patients.id, id), eq(patients.version, expectedVersion)))
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
                .where(eq(patients.id, id))
                .get();
            return NextResponse.json(
                buildPatientVersionConflictPayload(expectedVersion, id, current ?? null),
                { status: 409 }
            );
        }

        /* @Codex */
        await recordPatientAuditEvent(request, 'patient.deleted', id, {
            resourceVersion: expectedVersion,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete patient' }, { status: 500 });
    }
}
