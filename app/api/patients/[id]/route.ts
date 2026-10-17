import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { parseExpectedVersion } from '@/lib/patient-concurrency';
import { readPatientJsonObject } from '@/lib/patient-json-object';
import { readPatientProfile, updatePatientProfile } from '@/lib/patient-profile-service';
import { deletePatientOperation } from '@/lib/patient-delete-operation';
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';

function parsePatientDeletionReason(body: Record<string, unknown>, fallback: string): string | null {
    if (!Object.prototype.hasOwnProperty.call(body, 'deletionReason')) return fallback;
    if (typeof body.deletionReason !== 'string' || body.deletionReason.trim().length === 0) return null;
    return body.deletionReason;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const patient = await readPatientProfile({ patientId: id, projection: 'web' });
        if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(patient);
    } catch (archiveError) {
        const replacement = archiveReplacementResponse(archiveError);
        if (replacement) return replacement;
        return NextResponse.json({ error: "Failed to fetch patient" }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const { id } = await params;
        const parsed = await readPatientJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...('code' in parsed ? { code: parsed.code } : {}) }, { status: parsed.status });
        const body = parsed.body;
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const commit = await updatePatientProfile({
            patientId: id, expectedVersion,
            audit: () => {
                const auditContext = auditContextFromSession(session);
                return {
                    archiveGeneration: auditContext.archiveGeneration, actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    sourceSurface: auditContext.sourceSurface, requestId: requestIdFromRequest(request),
                    flags: [`auth:${auditContext.authContext}`],
                };
            },
        }, body);
        if (commit.status !== 200) return NextResponse.json(commit.value, { status: commit.status });

        return NextResponse.json({ success: true });
    } catch (archiveError) {
        const replacement = archiveReplacementResponse(archiveError);
        if (replacement) return replacement;
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const { id } = await params;
        const parsed = await readPatientJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...('code' in parsed ? { code: parsed.code } : {}) }, { status: parsed.status });
        const body = parsed.body;
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const deletionReason = parsePatientDeletionReason(body, 'web-delete');
        if (deletionReason === null) {
            return NextResponse.json({ error: 'Invalid deletionReason' }, { status: 400 });
        }

        /* resolve host identity before the synchronous tombstone/audit commit. */
        const auditContext = auditContextFromSession(session);
        const result = deletePatientOperation({
            patientId: id, expectedVersion, deletionReason,
            audit: { archiveGeneration: auditContext.archiveGeneration, actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                sourceSurface: auditContext.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${auditContext.authContext}`] },
        });
        if (result.status !== 200) return NextResponse.json(result.value, { status: result.status });

        return NextResponse.json({ success: true });
    } catch (archiveError) {
        const replacement = archiveReplacementResponse(archiveError);
        if (replacement) return replacement;
        return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    }
}
