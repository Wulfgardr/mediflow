/* @Codex */
import { randomUUID } from 'node:crypto';
/* @Codex */
import { and, eq, isNotNull } from 'drizzle-orm';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import { buildPatientVersionConflictPayload, parseExpectedVersion } from './patient-concurrency';
/* @Codex */
import {
    activePatients,
    buildPatientRestoreValues,
    buildPatientTombstoneValues,
} from './patient-lifecycle';
/* @Codex */
import { normalizePatientCreateInput } from './patient-write-normalization';
/* @Codex */
import { patients, patientsToAmbulatories } from './schema';
/* @Codex */
import {
    NETWORK_FORBIDDEN_PATIENT_WRITE_FIELDS,
    writeNetworkPatientAuditEvent,
} from './network-patient-write';
/* @Codex */
import type { NetworkWriteContext } from './network-write-context';

/* @Codex */
export const NETWORK_PATIENT_LIFECYCLE_CAPABILITY = 'network.replica.write-patient-lifecycle';

type NetworkPatientLifecycleContext = NetworkWriteContext & {
    patientId: string;
};

type NetworkPatientLifecycleResponse =
    | { status: 200 | 201; value: { id: string; version: number } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };

type PatientLifecycleSnapshot = {
    id: string;
    version: number;
    updatedAt: Date | string | number | null;
    isArchived: boolean | null;
};

const NETWORK_CREATE_SENSITIVE_FIELDS = [
    'address',
    'phone',
    'caregiver',
    'exemptions',
    'diagnoses',
    'statusReason',
    'notes',
    'archiveReason',
    'archiveNote',
] as const;

const NETWORK_CREATE_SERVER_CONTROLLED_FIELDS = [
    'version',
    'createdAt',
    'updatedAt',
    'isArchived',
    'deletedAt',
] as const;

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

// A sealed field is the two-segment envelope the client crypto emits,
// `ENC:<base64 iv>:<base64 ciphertext>` (lib/db.ts encryptFields). A keyless
// host cannot verify the encryption, but it MUST reject values that only look
// sealed by prefix: `ENC:["patient-id"]` (raw JSON) or `ENC: +39 333...` (free
// text) would otherwise land plaintext in a column contracted to hold opaque
// ciphertext. The anchored pattern requires two non-empty base64 segments, so
// accidental plaintext (brackets, quotes, spaces, hyphens) is rejected.
const SEALED_FIELD_ENVELOPE_PATTERN = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;

export function isSealedValue(value: unknown): boolean {
    return typeof value === 'string' && SEALED_FIELD_ENVELOPE_PATTERN.test(value);
}

function hasRequiredString(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

/* @Codex */
export function validateNetworkPatientCreateBody(
    body: Record<string, unknown>,
    scopeAmbulatoryId: string
): { ok: true } | { ok: false; status: 400 | 403; value: Record<string, unknown> } {
    for (const field of NETWORK_FORBIDDEN_PATIENT_WRITE_FIELDS) {
        if (hasOwn(body, field)) {
            return {
                ok: false,
                status: 403,
                value: { error: 'Network patient write boundary excludes AI fields' },
            };
        }
    }

    for (const field of NETWORK_CREATE_SERVER_CONTROLLED_FIELDS) {
        if (hasOwn(body, field)) {
            return {
                ok: false,
                status: 400,
                value: { error: 'Network create excludes server-controlled fields' },
            };
        }
    }

    if (hasOwn(body, 'ambulatoryId') && body.ambulatoryId !== scopeAmbulatoryId) {
        return {
            ok: false,
            status: 403,
            value: { error: 'Network scope violation' },
        };
    }

    for (const field of NETWORK_CREATE_SENSITIVE_FIELDS) {
        const value = body[field];
        if (value !== undefined && value !== null && !isSealedValue(value)) {
            return {
                ok: false,
                status: 400,
                value: { error: 'Network create requires sealed sensitive fields' },
            };
        }
    }

    if (!hasRequiredString(body.firstName) || !hasRequiredString(body.lastName) || !hasRequiredString(body.taxCode)) {
        return {
            ok: false,
            status: 400,
            value: { error: 'Missing required fields' },
        };
    }

    return { ok: true };
}

/* @Codex */
export function validateNetworkDeletionReason(
    deletionReason: unknown
): { ok: true } | { ok: false; status: 400; value: { error: string } } {
    if (deletionReason === undefined || deletionReason === null) return { ok: true };
    if (isSealedValue(deletionReason)) return { ok: true };
    return {
        ok: false,
        status: 400,
        value: { error: 'Network delete requires a sealed deletion reason' },
    };
}

function selectActivePatientSnapshot(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    patientId: string
): PatientLifecycleSnapshot | null {
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

function selectTombstonedPatientSnapshot(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    patientId: string
): PatientLifecycleSnapshot | null {
    const current = tx
        .select({
            id: patients.id,
            version: patients.version,
            updatedAt: patients.updatedAt,
            isArchived: patients.isArchived,
        })
        .from(patients)
        .where(and(eq(patients.id, patientId), isNotNull(patients.deletedAt)))
        .get();

    return current ?? null;
}

/* @Codex */
export async function createNetworkScopedPatient(
    context: NetworkWriteContext,
    body: Record<string, unknown>
): Promise<NetworkPatientLifecycleResponse> {
    const boundaryError = validateNetworkPatientCreateBody(body, context.scopeAmbulatoryId);
    if (!boundaryError.ok) return boundaryError;

    const normalized = normalizePatientCreateInput(body, {
        id: typeof body.id === 'string' ? body.id : randomUUID(),
        ambulatoryId: context.scopeAmbulatoryId,
    });
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    dbServer.transaction((tx) => {
        tx.insert(patients).values(normalized.values).run();
        tx.insert(patientsToAmbulatories)
            .values({
                patientId: normalized.values.id,
                ambulatoryId: context.scopeAmbulatoryId,
            })
            .onConflictDoNothing()
            .run();
    });

    await writeNetworkPatientAuditEvent({
        context: {
            ...context,
            patientId: normalized.values.id,
        },
        eventType: 'patient.created',
        metadata: {
            resourceVersion: 1,
        },
    });

    return { status: 201, value: { id: normalized.values.id, version: 1 } };
}

/* @Codex */
export async function deleteNetworkScopedPatient(
    context: NetworkPatientLifecycleContext,
    body: Record<string, unknown>
): Promise<NetworkPatientLifecycleResponse> {
    const expectedVersion = parseExpectedVersion(body.version);
    if (expectedVersion === null) {
        return { status: 400, value: { error: 'Version is required' } };
    }

    const reasonError = validateNetworkDeletionReason(body.deletionReason);
    if (!reasonError.ok) return reasonError;

    const deletionReason = typeof body.deletionReason === 'string' ? body.deletionReason : 'paired-delete';
    const nextVersion = expectedVersion + 1;

    const commit = dbServer.transaction((tx): NetworkPatientLifecycleResponse => {
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
            .set(buildPatientTombstoneValues(expectedVersion, deletionReason))
            .where(and(eq(patients.id, context.patientId), eq(patients.version, expectedVersion), activePatients()))
            .run();

        if (updateResult.changes === 0) {
            return {
                status: 409,
                value: buildPatientVersionConflictPayload(
                    expectedVersion,
                    context.patientId,
                    selectActivePatientSnapshot(tx, context.patientId),
                ),
            };
        }

        return { status: 200, value: { id: context.patientId, version: nextVersion } };
    });

    if (commit.status !== 200) return commit;

    await writeNetworkPatientAuditEvent({
        context,
        eventType: 'patient.deleted',
        metadata: {
            resourceVersion: nextVersion,
        },
    });

    return commit;
}

/* @Codex */
export async function restoreNetworkScopedPatient(
    context: NetworkPatientLifecycleContext,
    body: Record<string, unknown>
): Promise<NetworkPatientLifecycleResponse> {
    const expectedVersion = parseExpectedVersion(body.version);
    if (expectedVersion === null) {
        return { status: 400, value: { error: 'Version is required' } };
    }

    const nextVersion = expectedVersion + 1;
    const commit = dbServer.transaction((tx): NetworkPatientLifecycleResponse => {
        const existing = tx
            .select({ patient: patients })
            .from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(
                eq(patients.id, context.patientId),
                eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId),
                isNotNull(patients.deletedAt),
            ))
            .get();

        if (!existing) {
            return { status: 404, value: { error: 'Not found' } };
        }

        const updateResult = tx
            .update(patients)
            .set(buildPatientRestoreValues(expectedVersion))
            .where(and(eq(patients.id, context.patientId), eq(patients.version, expectedVersion), isNotNull(patients.deletedAt)))
            .run();

        if (updateResult.changes === 0) {
            return {
                status: 409,
                value: buildPatientVersionConflictPayload(
                    expectedVersion,
                    context.patientId,
                    selectTombstonedPatientSnapshot(tx, context.patientId),
                ),
            };
        }

        return { status: 200, value: { id: context.patientId, version: nextVersion } };
    });

    if (commit.status !== 200) return commit;

    await writeNetworkPatientAuditEvent({
        context,
        eventType: 'patient.restored',
        metadata: {
            resourceVersion: nextVersion,
        },
    });

    return commit;
}
