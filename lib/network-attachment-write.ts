/* @Codex */
import { randomUUID } from 'node:crypto';
/* @Codex */
import { and, eq } from 'drizzle-orm';
/* @Codex */
import { buildAttachmentPath } from './attachment-path';
/* @Codex */
import { getAttachmentPayloadByteSize, isSealedAttachmentValue, resolveMaxAttachmentBytes } from './attachment-payload';
/* @Codex */
import {
    listChangedFields,
    requestIdFromRequest,
    writeAuditEvent,
    type AuditRedactedMetadata,
} from './security/audit';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import { activePatients } from './patient-lifecycle';
/* @Codex */
import type { NetworkWriteContext } from './network-write-context';
/* @Codex */
import { attachments, patients, patientsToAmbulatories } from './schema';

/* @Codex */
export const NETWORK_ATTACHMENT_WRITE_CAPABILITY = 'network.replica.write-documents';

type NetworkAttachmentMutationContext = NetworkWriteContext & {
    patientId: string;
};

type NetworkAttachmentMutationResponse =
    | { status: 201; value: { id: string } }
    | { status: 400 | 404 | 413; value: Record<string, unknown> };

// D2/D3 (ADR 0076, Classe A): the paired create payload is a projection of the
// web payload, not a replica. patientId comes from the path; every
// document-derived and server-controlled field is rejected by presence.
const NETWORK_FORBIDDEN_ATTACHMENT_CREATE_FIELDS = [
    'patientId',
    'id',
    'summarySnapshot',
    'parseEvidenceArtifactSnapshot',
    'ocrQueueState',
    'ocrQueueReason',
    'createdAt',
    'updatedAt',
] as const;

const NETWORK_SEALED_ATTACHMENT_CREATE_FIELDS = ['name', 'path', 'data'] as const;

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateNetworkAttachmentCreateBody(
    body: Record<string, unknown>
): { ok: true } | { ok: false; status: 400; value: Record<string, unknown> } {
    for (const field of NETWORK_FORBIDDEN_ATTACHMENT_CREATE_FIELDS) {
        if (hasOwn(body, field)) {
            return {
                ok: false,
                status: 400,
                value: { error: `Network document write boundary rejects client-controlled ${field}` },
            };
        }
    }

    for (const field of NETWORK_SEALED_ATTACHMENT_CREATE_FIELDS) {
        if (!isSealedAttachmentValue(body[field])) {
            return {
                ok: false,
                status: 400,
                value: { error: `Network document write boundary requires sealed ${field}` },
            };
        }
    }

    if (!isNonEmptyString(body.type)) {
        return {
            ok: false,
            status: 400,
            value: { error: 'Network document write boundary requires a non-empty type' },
        };
    }

    if (!isFiniteNonNegativeNumber(body.size)) {
        return {
            ok: false,
            status: 400,
            value: { error: 'Network document write boundary requires a non-negative size' },
        };
    }

    return { ok: true };
}

function patientIsActiveAndInScope(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    patientId: string,
    scopeAmbulatoryId: string
): boolean {
    const scopedPatient = tx
        .select({ id: patients.id })
        .from(patients)
        .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
        .where(and(
            eq(patients.id, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
            activePatients(),
        ))
        .get();

    return Boolean(scopedPatient);
}

async function writeNetworkAttachmentAuditEvent(input: {
    context: NetworkAttachmentMutationContext;
    subjectRef: string;
    metadata?: AuditRedactedMetadata | null;
}): Promise<void> {
    try {
        await writeAuditEvent({
            eventType: 'attachment.created',
            outcome: 'success',
            actorType: 'user',
            actorRef: input.context.session.userId,
            subjectType: 'attachment',
            subjectRef: input.subjectRef,
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
        console.error('[MediFlow] Network document audit write failed:', error);
    }
}

/* @Codex */
export async function createNetworkScopedAttachment(
    context: NetworkAttachmentMutationContext,
    body: Record<string, unknown>
): Promise<NetworkAttachmentMutationResponse> {
    const boundaryError = validateNetworkAttachmentCreateBody(body);
    if (!boundaryError.ok) return boundaryError;

    // Wire size limit shared with the host attachment upload: it bounds the
    // sealed ciphertext byte size, not the raw file (an host-keyless server
    // cannot measure raw bytes of an ENC: payload).
    const dataSize = getAttachmentPayloadByteSize(body.data);
    if (!dataSize.ok) {
        return { status: 400, value: { error: dataSize.error } };
    }
    if (dataSize.size > resolveMaxAttachmentBytes()) {
        return { status: 413, value: { error: 'Attachment payload too large' } };
    }

    const newId = randomUUID();
    const now = new Date();
    const name = body.name as string;
    const path = buildAttachmentPath(body.path, name, newId);

    const commit = dbServer.transaction((tx): NetworkAttachmentMutationResponse => {
        if (!patientIsActiveAndInScope(tx, context.patientId, context.scopeAmbulatoryId)) {
            return { status: 404, value: { error: 'Not found' } };
        }

        tx.insert(attachments).values({
            id: newId,
            patientId: context.patientId,
            name,
            type: body.type as string,
            size: body.size as number,
            path,
            data: body.data as string,
            summarySnapshot: null,
            parseEvidenceArtifactSnapshot: null,
            ocrQueueState: 'pending',
            ocrQueueReason: 'paired_upload',
            ocrQueueUpdatedAt: now,
            createdAt: now,
        }).run();

        return { status: 201, value: { id: newId } };
    });

    if (commit.status !== 201) return commit;

    await writeNetworkAttachmentAuditEvent({
        context,
        subjectRef: commit.value.id,
        metadata: {
            changedFields: listChangedFields(body),
        },
    });

    return commit;
}
