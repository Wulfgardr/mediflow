/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { parseTherapyStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
/* @Codex */
import { therapyUpdateSchema } from '@/lib/api-schemas/clinical-writes';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
import { normalizeTherapyUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
import { buildTherapyVersionConflictPayload, parseTherapyExpectedVersion } from '@/lib/therapy-concurrency';
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

async function selectTherapyConflictSnapshot(therapyId: string) {
    return await dbServer
        .select({
            id: therapies.id,
            patientId: therapies.patientId,
            version: therapies.version,
            updatedAt: therapies.updatedAt,
            deletedAt: therapies.deletedAt,
        })
        .from(therapies)
        .where(eq(therapies.id, therapyId))
        .get() ?? null;
}

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
        const rawBody = await request.json() as Record<string, unknown>;
        const expectedVersion = parseTherapyExpectedVersion(rawBody.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const parsedBody = parseApiBody(therapyUpdateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const existing = await dbServer.select({ id: therapies.id }).from(therapies).where(eq(therapies.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

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

        const updateResult = await dbServer.update(therapies)
            .set({
                ...updateData,
                version: expectedVersion + 1,
                updatedAt: new Date(),
            })
            .where(and(eq(therapies.id, id), eq(therapies.version, expectedVersion)))
            .run();
        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildTherapyVersionConflictPayload(
                    expectedVersion,
                    id,
                    await selectTherapyConflictSnapshot(id),
                ),
                { status: 409 },
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'therapy.updated',
                subjectType: 'therapy',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(body),
                    resourceVersion: expectedVersion + 1,
                },
            },
            '[MediFlow] Therapy audit write failed:',
        );

        return NextResponse.json({ success: true });
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
        const parsedBody = await parseClinicalDeleteBody(request, 'web-delete');
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
        }
        const expectedVersion = parseTherapyExpectedVersion(parsedBody.values.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const normalized = normalizeTherapyUpdateInput({
            deletedAt: parsedBody.values.deletedAt,
            deletionReason: parsedBody.values.deletionReason,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }
        const existing = await dbServer.select({ id: therapies.id }).from(therapies).where(eq(therapies.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const updateResult = await dbServer.update(therapies)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(eq(therapies.id, id), eq(therapies.version, expectedVersion)))
            .run();
        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildTherapyVersionConflictPayload(
                    expectedVersion,
                    id,
                    await selectTherapyConflictSnapshot(id),
                ),
                { status: 409 },
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'therapy.deleted',
                subjectType: 'therapy',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: expectedVersion + 1,
                },
            },
            '[MediFlow] Therapy audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /therapies/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
