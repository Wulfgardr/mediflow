import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, ambulatories, patientsToAmbulatories } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { and, asc, desc, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
// WUL-306 (ADR 0066): list reads must exclude soft-deleted patients
import { activePatients } from '@/lib/patient-lifecycle';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';

/* @Codex: opt-in fenced create; all legacy read/write contracts remain separate. */
import * as patientCreateOwner from '@/lib/security/web-auth-lifecycle-owner-adapter';
import { patientCreateContexts, readPatientCreateLane } from '@/lib/security/patient-create-context';
import { createPatientAtPreviewDestination, PatientCreateFenceError } from '@/lib/patient-create-service';

// address/phone/caregiver/notes etc are ENC:. firstName/lastName/taxCode/dates
// are plaintext in the schema, so they are safe sort targets.
const PATIENT_SORT_COLUMNS = {
    updatedAt: patients.updatedAt,
    createdAt: patients.createdAt,
    lastName: patients.lastName,
    firstName: patients.firstName,
    birthDate: patients.birthDate,
} as const;
/* @Codex */
import { normalizePatientCreateInput } from '@/lib/patient-write-normalization';
/* @Codex */
import {
    auditContextFromSession,
    listChangedFields,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';

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

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    /* STREAM B */
    const { searchParams } = new URL(request.url);
    const parsed = parseListParams(searchParams, {
        sortableColumns: Object.keys(PATIENT_SORT_COLUMNS),
        defaultOrderBy: 'updatedAt',
        defaultOrderDir: 'desc',
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { limit, offset, orderBy, orderDir } = parsed.params;

    try {
        const cookieStore = await cookies();
        let ambulatoryId = cookieStore.get('ambulatory_id')?.value;

        // Fallback: Use default ambulatory if no cookie
        if (!ambulatoryId) {
            const defaultAmb = await dbServer.select().from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1);
            if (defaultAmb.length > 0) {
                ambulatoryId = defaultAmb[0].id;
            }
        }

        if (!ambulatoryId) {
            // If still no ambulatory, return empty or all? Safety: return empty or handled by UI
            return NextResponse.json([]);
        }

        const sortColumn = PATIENT_SORT_COLUMNS[(orderBy ?? 'updatedAt') as keyof typeof PATIENT_SORT_COLUMNS];
        const orderExpr = orderDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

        // MANY-TO-MANY JOIN
        // Select patients where there is a link in patientsToAmbulatories for this ambulatoryId
        let query = dbServer.select({
            patient: patients
        })
            .from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(eq(patientsToAmbulatories.ambulatoryId, ambulatoryId), activePatients()))
            .orderBy(orderExpr)
            .$dynamic();
        if (typeof limit === 'number') query = query.limit(limit);
        if (typeof offset === 'number') query = query.offset(offset);

        const rows = await query;

        // Flatten result
        const result = rows.map(r => r.patient);

        return NextResponse.json(result);
    } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.error("API GET /patients error:", error, (error as any)?.message, (error as any)?.stack);
        return NextResponse.json({ error: "Failed to fetch patients" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const lane = readPatientCreateLane(request.headers);
    if (lane.kind === 'invalid') return NextResponse.json({ error: 'Invalid patient create precondition' }, { status: 400 });

    try {
        const body = await request.json() as Record<string, unknown>;
        const newId = body.id || uuidv4();

        // The fenced lane never reads selection cookies/defaults. Target is fixed in
        // the server's preview entry and checked again in the synchronous transaction.
        let ambulatoryId: string | undefined;
        if (lane.kind === 'legacy') {
            const cookieStore = await cookies();
            ambulatoryId = cookieStore.get('ambulatory_id')?.value;
            if (!ambulatoryId) {
                const defaultAmb = await dbServer.select().from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1);
                if (defaultAmb.length > 0) ambulatoryId = defaultAmb[0].id;
            }
        }

        const normalized = normalizePatientCreateInput(body, {
            id: typeof newId === 'string' ? newId : uuidv4(),
            ambulatoryId: ambulatoryId || null,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        if (lane.kind === 'fenced') {
            createPatientAtPreviewDestination({
                transaction: operation => dbServer.transaction(tx => operation({
                    targetExists: id => Boolean(tx.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.id, id)).get()),
                    insertPatient: values => { tx.insert(patients).values(values).run(); },
                    insertMembership: (patientId, targetId) => {
                        tx.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: targetId }).run();
                    },
                })),
            }, patientCreateContexts(patientCreateOwner), session, lane.precondition, normalized.values);
        } else {
            // WUL-268 (STREAM A): the patient row and its ambulatory membership must be
            // created atomically. better-sqlite3 transactions are synchronous, so no
            // awaits inside; the async audit write stays outside (separate audit DB).
            dbServer.transaction((tx) => {
                tx.insert(patients).values(normalized.values).run();

                /* @Codex */
                if (normalized.values.ambulatoryId) {
                    tx.insert(patientsToAmbulatories)
                        .values({ patientId: normalized.values.id, ambulatoryId: normalized.values.ambulatoryId })
                        .onConflictDoNothing()
                        .run();
                }
            });

        }

        /* @Codex */
        await recordPatientAuditEvent(request, session, 'patient.created', normalized.values.id, {
            changedFields: listChangedFields(body, ['id', 'version']),
            resourceVersion: 1,
        });

        return NextResponse.json({ id: normalized.values.id }, { status: 201 });
    } catch (error) {
        if (lane.kind === 'fenced') {
            // Driver errors can contain bound data: no payload/nonce/error object in logs.
            return NextResponse.json({ error: error instanceof PatientCreateFenceError
                ? 'Patient create precondition denied; review again' : 'Failed to create patient' },
                { status: error instanceof PatientCreateFenceError ? 409 : 500 });
        }
        console.error("API POST /patients error:", error);
        return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });
    }
}
