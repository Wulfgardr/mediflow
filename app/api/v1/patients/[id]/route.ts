// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import type { PatientDetail } from '@/lib/api/v1/types';
/* @Codex */
import { parseExpectedVersion } from '@/lib/patient-concurrency';
// WUL-306 (ADR 0066): soft-delete lifecycle helpers
import { activePatients } from '@/lib/patient-lifecycle';
/* @Codex */
import { normalizePatientUpdateInput } from '@/lib/patient-write-normalization';
/* @Codex */
import { parsePatientJsonObject } from '@/lib/patient-json-object';
/* @Codex */
import { updatePatientOperation } from '@/lib/patient-update-operation';
/* @Codex */
import { deletePatientOperation } from '@/lib/patient-delete-operation';
/* @Codex */
import { auditContextFromRequest, requestIdFromRequest } from '@/lib/security/audit';

/* @Codex */
function parsePatientDeletionReason(body: Record<string, unknown>, fallback: string): string | null {
    if (!Object.prototype.hasOwnProperty.call(body, 'deletionReason')) return fallback;
    if (typeof body.deletionReason !== 'string' || body.deletionReason.trim().length === 0) return null;
    return body.deletionReason;
}

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const patient = await dbServer.select().from(patients).where(and(eq(patients.id, id), activePatients())).get();

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
            /* @Codex */
            archiveReason: patient.archiveReason ?? null,
            /* @Codex */
            archiveNote: patient.archiveNote ?? null,
            notes: patient.notes ?? null,
            /* @Codex */
            aiSummary: patient.aiSummary ?? null,
            /* @Codex */
            aiSummaryGeneratedAt: toIsoString(patient.aiSummaryGeneratedAt),
            /* @Codex */
            aiSummaryContextHash: patient.aiSummaryContextHash ?? null,
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
        const parsed = await parsePatientJsonObject(() => request.json());
        if (!parsed.ok) return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
        const body = parsed.body;
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

        const normalized = normalizePatientUpdateInput(body as Record<string, unknown>, {
            expectedVersion,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        /* @Codex: resolve the API actor before the required synchronous commit. */
        const auditContext = auditContextFromRequest(request, await requireLocalApiActorSession(request));
        const commit = updatePatientOperation({
            patientId: id, expectedVersion, values: normalized.values,
            setPrimaryAmbulatory: Object.prototype.hasOwnProperty.call(body, 'ambulatoryId'),
            audit: {
                actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                sourceSurface: auditContext.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${auditContext.authContext}`],
            },
        });
        if (commit.status !== 200) return NextResponse.json(commit.value, { status: commit.status });

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
        const parsed = await parsePatientJsonObject(() => request.json());
        if (!parsed.ok) return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
        const body = parsed.body;
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const deletionReason = parsePatientDeletionReason(body, 'api-v1-delete');
        if (deletionReason === null) {
            return NextResponse.json({ error: 'Invalid deletionReason' }, { status: 400 });
        }

        /* @Codex: resolve the API actor before the synchronous tombstone/audit commit. */
        const auditContext = auditContextFromRequest(request, await requireLocalApiActorSession(request));
        const result = deletePatientOperation({
            patientId: id, expectedVersion, deletionReason,
            audit: { actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                sourceSurface: auditContext.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${auditContext.authContext}`] },
        });
        if (result.status !== 200) return NextResponse.json(result.value, { status: result.status });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete patient' }, { status: 500 });
    }
}
