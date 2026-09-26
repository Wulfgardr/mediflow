/* @Codex */
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
import { isSealedValue } from './network-patient-lifecycle';
/* @Codex */
import { parseExpectedVersion } from './patient-concurrency';
/* @Codex */
import { updatePatientOperation } from './patient-update-operation';
/* @Codex */
import { normalizePatientUpdateInput } from './patient-write-normalization';
/* @Codex */
/* @Codex */
import type { StoredNetworkPairedClient } from './network-pairing-model';
/* @Codex */
import type { ServerSession } from './security/server-session';

/* @Codex */
export const NETWORK_PATIENT_WRITE_CAPABILITY = 'network.replica.write-patient-profile';
/* @Codex */
export const NETWORK_FORBIDDEN_PATIENT_WRITE_FIELDS = new Set(['aiSummary', 'documentInsights']);

// I campi sensibili arrivano sigillati dal client (ENC:); l'host non li
// decodifica e non deve accettarli in chiaro da un client paired.
export const NETWORK_UPDATE_SEALED_PATIENT_FIELDS = [
    'address',
    'phone',
    'caregiver',
    'exemptions',
    'diagnoses',
    'notes',
    'statusReason',
    'archiveReason',
    'archiveNote',
] as const;

type NetworkPatientMutationResponse =
    | { status: 200; value: { success: true } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };

type NetworkPatientMutationContext = {
    request: Request;
    patientId: string;
    scopeAmbulatoryId: string;
    pairedClient: StoredNetworkPairedClient;
    session: ServerSession;
};

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

    for (const field of NETWORK_UPDATE_SEALED_PATIENT_FIELDS) {
        const value = body[field];
        if (value !== undefined && value !== null && !isSealedValue(value)) {
            return {
                status: 400,
                value: { error: 'Network update requires sealed sensitive fields' },
            };
        }
    }

    return null;
}

/* @Codex */
export async function writeNetworkPatientAuditEvent(input: {
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

    const commit = updatePatientOperation({
        patientId: context.patientId,
        expectedVersion,
        values: normalized.values,
        setPrimaryAmbulatory: hasOwn(body, 'ambulatoryId'),
        scopeAmbulatoryId: context.scopeAmbulatoryId,
        audit: {
            actorType: 'user', actorRef: context.session.userId,
            sourceSurface: 'native', requestId: requestIdFromRequest(context.request),
            flags: [
                'auth:paired-client',
                `paired-client:${context.pairedClient.clientId}`,
                'scope:ambulatory',
            ],
        },
    });

    if (commit.status !== 200) return commit;

    return { status: 200, value: { success: true } };
}
