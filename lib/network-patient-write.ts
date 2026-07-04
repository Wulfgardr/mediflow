/* @Codex */
import { and, eq } from 'drizzle-orm';
/* @Codex */
import {
    classifyPatientMutationEvent,
    listChangedFields,
    requestIdFromRequest,
    writeAuditEvent,
    type AuditEventType,
    type AuditRedactedMetadata,
} from './security/audit';
/* @Codex */
import { dbServer } from './db-server';
import { upsertPrimaryAmbulatoryMembership } from './patient-ambulatory-membership';
/* @Codex */
import { buildPatientVersionConflictPayload, parseExpectedVersion } from './patient-concurrency';
// WUL-306 (ADR 0066): network writes treat soft-deleted patients as missing
import { activePatients } from './patient-lifecycle';
/* @Codex */
import { normalizePatientUpdateInput } from './patient-write-normalization';
/* @Codex */
import { patients, patientsToAmbulatories } from './schema';
/* @Codex */
import type { StoredNetworkPairedClient } from './network-pairing-model';
/* @Codex */
import type { ServerSession } from './security/server-session';

/* @Codex */
export const NETWORK_PATIENT_WRITE_CAPABILITY = 'network.replica.write-patient-profile';

type NetworkPatientMutationResponse =
    | { status: 200; value: { success: true } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };

type NetworkPatientUpdateCommit =
    | { status: 200; value: { success: true }; existing: typeof patients.$inferSelect }
    | { status: 404 | 409; value: Record<string, unknown> };

type NetworkPatientMutationContext = {
    request: Request;
    patientId: string;
    scopeAmbulatoryId: string;
    pairedClient: StoredNetworkPairedClient;
    session: ServerSession;
};

type PatientMutationSnapshot = {
    id: string;
    version: number;
    updatedAt: Date | string | number | null;
    isArchived: boolean | null;
};

const NETWORK_FORBIDDEN_PATIENT_WRITE_FIELDS = new Set(['aiSummary', 'documentInsights']);

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function validateNetworkPatientMutationBoundary(
    body: Record<string, unknown>,
    scopeAmbulatoryId: string
): NetworkPatientMutationResponse | null {
    for (const field of NETWORK_FORBIDDEN_PATIENT_WRITE_FIELDS) {
        if (hasOwn(body, field)) {
            return {
                status: 403,
                value: {
                    error: 'Network patient write boundary excludes AI fields',
                },
            };
        }
    }

    if (hasOwn(body, 'ambulatoryId') && body.ambulatoryId !== scopeAmbulatoryId) {
        return {
            status: 403,
            value: {
                error: 'Network scope violation',
            },
        };
    }

    return null;
}

function selectPatientConflictSnapshot(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    patientId: string
): PatientMutationSnapshot | null {
    const current = tx
        .select({
            id: patients.id,
            version: patients.version,
            updatedAt: patients.updatedAt,
            isArchived: patients.isArchived,
        })
        .from(patients)
        .where(and(eq(patients.id, patientId), activePatients()))
        .get();

    return current ?? null;
}

async function writeNetworkPatientAuditEvent(input: {
    context: NetworkPatientMutationContext;
    eventType: AuditEventType;
    metadata?: AuditRedactedMetadata | null;
}): Promise<void> {
    try {
        await writeAuditEvent({
            eventType: input.eventType,
            outcome: 'success',
            actorType: 'user',
            actorRef: input.context.session.userId,
            subjectType: 'patient',
            subjectRef: input.context.patientId,
            sourceSurface: 'native',
            requestId: requestIdFromRequest(input.context.request),
            redactedMetadata: {
                ...(input.metadata ?? {}),
                flags: [
                    ...(input.metadata?.flags ?? []),
                    'auth:paired-client',
                    `paired-client:${input.context.pairedClient.clientId}`,
                    'scope:ambulatory',
                ],
            },
        });
    } catch (error) {
        console.error('[MediFlow] Network patient audit write failed:', error);
    }
}

/* @Codex */
export async function updateNetworkScopedPatient(
    context: NetworkPatientMutationContext,
    body: Record<string, unknown>
): Promise<NetworkPatientMutationResponse> {
    const expectedVersion = parseExpectedVersion(body.version);
    if (expectedVersion === null) {
        return { status: 400, value: { error: 'Version is required' } };
    }

    const boundaryError = validateNetworkPatientMutationBoundary(body, context.scopeAmbulatoryId);
    if (boundaryError) return boundaryError;

    const normalized = normalizePatientUpdateInput(body, { expectedVersion });
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkPatientUpdateCommit => {
        const existing = tx
            .select({ patient: patients })
            .from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(
                eq(patients.id, context.patientId),
                eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId),
                activePatients(),
            ))
            .get();

        if (!existing) {
            return { status: 404, value: { error: 'Not found' } };
        }

        const updateResult = tx
            .update(patients)
            .set(normalized.values)
            .where(and(eq(patients.id, context.patientId), eq(patients.version, expectedVersion), activePatients()))
            .run();

        if (updateResult.changes === 0) {
            return {
                status: 409,
                value: buildPatientVersionConflictPayload(
                    expectedVersion,
                    context.patientId,
                    selectPatientConflictSnapshot(tx, context.patientId),
                ),
            };
        }

        if (hasOwn(body, 'ambulatoryId')) {
            // WUL-309: set-primary semantics: upsert the scoped association only;
            // a network client must never rewrite the patient's other memberships.
            upsertPrimaryAmbulatoryMembership(tx, context.patientId, context.scopeAmbulatoryId);
        }

        return { status: 200, value: { success: true }, existing: existing.patient };
    });

    if (commit.status !== 200) return commit;

    await writeNetworkPatientAuditEvent({
        context,
        eventType: classifyPatientMutationEvent(
            commit.existing.isArchived ?? null,
            normalized.values.isArchived as boolean | undefined,
        ),
        metadata: {
            changedFields: listChangedFields(body, ['version']),
            resourceVersion: expectedVersion + 1,
        },
    });

    return { status: 200, value: { success: true } };
}
