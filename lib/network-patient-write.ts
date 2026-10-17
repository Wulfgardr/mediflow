import { archiveGenerationForSession } from './security/archive-session-generation';
import {
    classifyPatientMutationEvent,
    listChangedFields,
    requestIdFromRequest,
    writeAuditEvent,
    type AuditEventType,
    type AuditRedactedMetadata,
} from './security/audit';
import { isSealedValue } from './network-patient-lifecycle';
import { parseExpectedVersion } from './patient-concurrency';
import { updatePatientProfile } from './patient-profile-service';
import { prepareNetworkPatientCommitGuard } from './network-patient-commit-authority';
import type { StoredNetworkPairedClient } from './network-pairing-model';
import type { ServerSession } from './security/server-session';

export const NETWORK_PATIENT_WRITE_CAPABILITY = 'network.replica.write-patient-profile';
export const NETWORK_FORBIDDEN_PATIENT_WRITE_FIELDS = new Set([
    'aiSummary', 'aiSummaryGeneratedAt', 'aiSummaryContextHash', 'documentInsights',
]);

// Only these profile/status fields can reach the shared local-write normalizer.
// Unknown extension fields remain ignored; newly added local derived fields
// cannot silently expand paired-client authority.
const NETWORK_PATIENT_PROFILE_FIELDS = [
    'firstName', 'lastName', 'taxCode', 'birthDate', 'address', 'phone', 'caregiver',
    'exemptions', 'diagnoses', 'notes', 'monitoringProfile', 'statusReason',
    'archiveReason', 'archiveNote', 'isAdi', 'isArchived', 'ambulatoryId',
] as const;

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
    | { status: 400 | 401 | 403 | 404 | 409; value: Record<string, unknown> };

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

export async function writeNetworkPatientAuditEvent(input: {
    context: NetworkPatientMutationContext;
    eventType: AuditEventType;
    metadata?: AuditRedactedMetadata | null;
}): Promise<void> {
    try {
        await writeAuditEvent({
            eventType: input.eventType,
            outcome: 'success',
            archiveGeneration: archiveGenerationForSession(input.context.session), actorType: 'user',
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

    const profile = Object.fromEntries(NETWORK_PATIENT_PROFILE_FIELDS
        .filter((field) => hasOwn(body, field)).map((field) => [field, body[field]]));
    const commit = await updatePatientProfile({
        prepareCommitGuard: () => prepareNetworkPatientCommitGuard(context, NETWORK_PATIENT_WRITE_CAPABILITY),
        patientId: context.patientId,
        expectedVersion,
        scopeAmbulatoryId: context.scopeAmbulatoryId,
        audit: () => ({
            archiveGeneration: archiveGenerationForSession(context.session), actorType: 'user', actorRef: context.session.userId,
            sourceSurface: 'native', requestId: requestIdFromRequest(context.request),
            flags: [
                'auth:paired-client',
                `paired-client:${context.pairedClient.clientId}`,
                'scope:ambulatory',
            ],
        }),
    }, profile);

    if (commit.status !== 200) return commit;

    return { status: 200, value: { success: true } };
}
