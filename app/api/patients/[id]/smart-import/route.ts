/* @Codex */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { therapyCreateSchema } from '@/lib/api-schemas/clinical-writes';
import { parseApiBody } from '@/lib/api-schemas/parse';
import { normalizeTherapyCreateInput } from '@/lib/api-v1-clinical-write-normalization';
import { dbServer } from '@/lib/db-server';
import { isSealedValue } from '@/lib/network-patient-lifecycle';
import {
    commitPatientSmartImport,
    type PatientSmartImportTherapyValues,
} from '@/lib/patient-smart-import-apply';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

const smartImportApplySchema = z.object({
    version: z.number().int().positive(),
    diagnoses: z.string().optional(),
    therapies: z.array(therapyCreateSchema),
}).refine(
    (value) => value.diagnoses !== undefined || value.therapies.length > 0,
    { message: 'No changes to apply' },
);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    let rawBody: unknown;
    try {
        rawBody = await request.json();
    } catch {
        return NextResponse.json({ error: 'Payload non valido' }, { status: 400 });
    }

    const parsed = parseApiBody(smartImportApplySchema, rawBody);
    if (!parsed.ok) return parsed.response;

    const { id: patientId } = await params;
    if (parsed.data.diagnoses !== undefined && !isSealedValue(parsed.data.diagnoses)) {
        return NextResponse.json({ error: 'Diagnoses must be sealed' }, { status: 400 });
    }

    const now = new Date();
    const normalizedTherapies: PatientSmartImportTherapyValues[] = [];
    for (const therapy of parsed.data.therapies) {
        if (therapy.patientId !== patientId) {
            return NextResponse.json({ error: 'Therapy patient mismatch' }, { status: 400 });
        }
        if (typeof therapy.motivation === 'string' && therapy.motivation.length > 0 && !isSealedValue(therapy.motivation)) {
            return NextResponse.json({ error: 'Therapy motivation must be sealed' }, { status: 400 });
        }

        const normalized = normalizeTherapyCreateInput(therapy, {
            id: therapy.id ?? crypto.randomUUID(),
            patientId,
            now,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }
        normalizedTherapies.push(normalized.values);
    }

    try {
        const result = commitPatientSmartImport(dbServer, {
            patientId,
            expectedVersion: parsed.data.version,
            diagnoses: parsed.data.diagnoses,
            therapies: normalizedTherapies,
            now,
        });
        if (result.status !== 200) {
            return NextResponse.json(result.value, { status: result.status });
        }

        if (parsed.data.diagnoses !== undefined) {
            await safeWriteAuditEventFromRequest(request, session, {
                eventType: 'patient.updated',
                subjectType: 'patient',
                subjectRef: patientId,
                redactedMetadata: {
                    changedFields: ['diagnoses'],
                    resourceVersion: result.value.patientVersion,
                },
            });
        }
        for (const [index, therapyId] of result.value.therapyIds.entries()) {
            await safeWriteAuditEventFromRequest(request, session, {
                eventType: 'therapy.created',
                subjectType: 'therapy',
                subjectRef: therapyId,
                redactedMetadata: {
                    changedFields: listChangedFields(parsed.data.therapies[index] as Record<string, unknown>, ['id']),
                    resourceVersion: 1,
                },
            });
        }

        return NextResponse.json(result.value);
    } catch {
        return NextResponse.json({ error: 'Smart Import apply failed' }, { status: 500 });
    }
}
