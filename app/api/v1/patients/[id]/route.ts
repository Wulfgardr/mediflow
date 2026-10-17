import { archiveReplacementResponse } from '@/lib/api-error-response';
// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import { parseExpectedVersion } from '@/lib/patient-concurrency';
import { readPatientJsonObject } from '@/lib/patient-json-object';
import { readPatientProfile, updatePatientProfile } from '@/lib/patient-profile-service';
import { deletePatientOperation } from '@/lib/patient-delete-operation';
import { auditContextFromRequest, requestIdFromRequest } from '@/lib/security/audit';

function parsePatientDeletionReason(body: Record<string, unknown>, fallback: string): string | null {
    if (!Object.prototype.hasOwnProperty.call(body, 'deletionReason')) return fallback;
    if (typeof body.deletionReason !== 'string' || body.deletionReason.trim().length === 0) return null;
    return body.deletionReason;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const patient = await readPatientProfile({ patientId: id, projection: 'api-v1' });

        if (!patient) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return NextResponse.json(patient);
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API GET /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to fetch patient' }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const archiveActorSession = await requireLocalApiActorSession(request);
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
                const auditContext = auditContextFromRequest(request, archiveActorSession);
                return {
                    archiveGeneration: auditContext.archiveGeneration, actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    sourceSurface: auditContext.sourceSurface, requestId: requestIdFromRequest(request),
                    flags: [`auth:${auditContext.authContext}`],
                };
            },
        }, body);
        if (commit.status !== 200) return NextResponse.json(commit.value, { status: commit.status });

        return NextResponse.json({ success: true });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API PUT /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const archiveActorSession = await requireLocalApiActorSession(request);
        const { id } = await params;
        const parsed = await readPatientJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...('code' in parsed ? { code: parsed.code } : {}) }, { status: parsed.status });
        const body = parsed.body;
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const deletionReason = parsePatientDeletionReason(body, 'api-v1-delete');
        if (deletionReason === null) {
            return NextResponse.json({ error: 'Invalid deletionReason' }, { status: 400 });
        }

        /* resolve the API actor before the synchronous tombstone/audit commit. */
        const auditContext = auditContextFromRequest(request, archiveActorSession);
        const result = deletePatientOperation({
            patientId: id, expectedVersion, deletionReason,
            audit: { archiveGeneration: auditContext.archiveGeneration, actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                sourceSurface: auditContext.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${auditContext.authContext}`] },
        });
        if (result.status !== 200) return NextResponse.json(result.value, { status: result.status });

        return NextResponse.json({ success: true });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('API DELETE /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete patient' }, { status: 500 });
    }
}
