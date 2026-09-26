import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
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
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';

/* @Codex */
function parsePatientDeletionReason(body: Record<string, unknown>, fallback: string): string | null {
    if (!Object.prototype.hasOwnProperty.call(body, 'deletionReason')) return fallback;
    if (typeof body.deletionReason !== 'string' || body.deletionReason.trim().length === 0) return null;
    return body.deletionReason;
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

        const normalized = normalizePatientUpdateInput(body, {
            expectedVersion,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        /* @Codex: actor/correlation are resolved before the synchronous commit. */
        const auditContext = auditContextFromSession(session);
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
        const parsed = await parsePatientJsonObject(() => request.json());
        if (!parsed.ok) return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
        const body = parsed.body;
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const deletionReason = parsePatientDeletionReason(body, 'web-delete');
        if (deletionReason === null) {
            return NextResponse.json({ error: 'Invalid deletionReason' }, { status: 400 });
        }

        /* @Codex: resolve host identity before the synchronous tombstone/audit commit. */
        const auditContext = auditContextFromSession(session);
        const result = deletePatientOperation({
            patientId: id, expectedVersion, deletionReason,
            audit: { actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                sourceSurface: auditContext.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${auditContext.authContext}`] },
        });
        if (result.status !== 200) return NextResponse.json(result.value, { status: result.status });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    }
}
