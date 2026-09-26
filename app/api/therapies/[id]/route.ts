/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { parseTherapyStatus } from '@/lib/status-normalization';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';
/* @Codex */
import { therapyUpdateSchema } from '@/lib/api-schemas/clinical-writes';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
import { normalizeTherapyUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
import { updateTherapyOperation } from '@/lib/therapy-write-operation';
import { parseTherapyDeleteInput, readTherapyJsonObject, safeTherapyExpectedVersion, therapyChangedFields, validateTherapyInput } from '@/lib/therapy-write-input';

function parseDate(value: unknown): Date | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const parsed = await readTherapyJsonObject(request, 'web', 'update');
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const rawBody = parsed.body;
        const expectedVersion = safeTherapyExpectedVersion(rawBody.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const shape = validateTherapyInput(rawBody, 'web', 'update');
        if (shape) return NextResponse.json({ error: shape.error }, { status: shape.status });
        const parsedBody = parseApiBody(therapyUpdateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const updateData: {
            drugName?: string;
            /* @Codex */
            aic?: string | null;
            /* @Codex */
            atc?: string | null;
            /* @Codex */
            activePrinciple?: string | null;
            dosage?: string;
            /* @Codex */
            motivation?: string | null;
            /* @Codex */
            diagnosisCode?: string | null;
            /* @Codex */
            diagnosisName?: string | null;
            status?: string;
            startDate?: Date;
            endDate?: Date | null;
        } = {};

        if (typeof body === 'object') {
            if (typeof body.drugName === 'string') updateData.drugName = body.drugName;
            /* @Codex */
            if (body.aic === null || body.aic === '') {
                updateData.aic = null;
            } else if (typeof body.aic === 'string') {
                updateData.aic = body.aic;
            }
            /* @Codex */
            if (body.atc === null || body.atc === '') {
                updateData.atc = null;
            } else if (typeof body.atc === 'string') {
                updateData.atc = body.atc;
            }
            /* @Codex */
            if (body.activePrinciple === null || body.activePrinciple === '') {
                updateData.activePrinciple = null;
            } else if (typeof body.activePrinciple === 'string') {
                updateData.activePrinciple = body.activePrinciple;
            }
            if (typeof body.dosage === 'string') updateData.dosage = body.dosage;
            /* @Codex */
            if (body.motivation === null || body.motivation === '') {
                updateData.motivation = null;
            } else if (typeof body.motivation === 'string') {
                updateData.motivation = body.motivation;
            }
            /* @Codex */
            if (body.diagnosisCode === null || body.diagnosisCode === '') {
                updateData.diagnosisCode = null;
            } else if (typeof body.diagnosisCode === 'string') {
                updateData.diagnosisCode = body.diagnosisCode;
            }
            /* @Codex */
            if (body.diagnosisName === null || body.diagnosisName === '') {
                updateData.diagnosisName = null;
            } else if (typeof body.diagnosisName === 'string') {
                updateData.diagnosisName = body.diagnosisName;
            }
            if (typeof body.status === 'string') {
                const parsedStatus = parseTherapyStatus(body.status);
                if (!parsedStatus) {
                    return NextResponse.json({ error: 'Invalid therapy status' }, { status: 400 });
                }
                updateData.status = parsedStatus;
            }

            const hasStartDate = Object.prototype.hasOwnProperty.call(body, 'startDate');
            const parsedStartDate = parseDate(body.startDate);
            if (hasStartDate && parsedStartDate === undefined) {
                return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
            }
            if (parsedStartDate) updateData.startDate = parsedStartDate;

            if (body.endDate === null || body.endDate === '') {
                updateData.endDate = null;
            } else {
                const parsedEndDate = parseDate(body.endDate);
                if (Object.prototype.hasOwnProperty.call(body, 'endDate') && parsedEndDate === undefined) {
                    return NextResponse.json({ error: 'Invalid endDate' }, { status: 400 });
                }
                if (parsedEndDate) updateData.endDate = parsedEndDate;
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        const context = auditContextFromSession(session);
        const result = updateTherapyOperation({
            therapyId: id, expectedVersion, values: { ...updateData, updatedAt: new Date() },
            changedFields: therapyChangedFields(updateData, rawBody), mode: 'web',
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /therapies/[id] error:', error);
        return NextResponse.json({ error: 'Update Failed' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const parsed = await readTherapyJsonObject(request, 'web', 'delete');
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const parsedBody = parseTherapyDeleteInput(parsed.body, 'web-delete');
        if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
        const expectedVersion = parsedBody.expectedVersion;
        const normalized = normalizeTherapyUpdateInput({
            deletedAt: parsedBody.body.deletedAt,
            deletionReason: parsedBody.body.deletionReason,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }
        const context = auditContextFromSession(session);
        const result = updateTherapyOperation({
            therapyId: id, expectedVersion, values: normalized.values,
            changedFields: ['deletedAt', 'deletionReason'], mode: 'web',
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /therapies/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
