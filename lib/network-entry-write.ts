/* @Codex: paired-network admission remains at the route; this export preserves its write boundary. */
import { requestIdFromRequest } from './security/audit';
import { entryExpectedVersion, prepareEntryCreate, prepareEntryUpdate } from './entry-write-input';
import { createEntryOperation, updateEntryOperation } from './entry-write-operation';
import { isSealedValue } from './network-patient-lifecycle';
import type { NetworkWriteContext } from './network-write-context';

export const NETWORK_ENTRY_WRITE_CAPABILITY = 'network.replica.write-clinical-diary';

type Context = NetworkWriteContext & { patientId: string };
type UpdateContext = Context & { entryId: string };
type Result = { status: 200 | 201 | 400 | 403 | 404 | 409 | 413; value: Record<string, unknown> };

const FORBIDDEN_WRITE = new Set(['aiSummary', 'documentInsights', 'documentInsightId', 'sourceDocumentId']);
const FORBIDDEN_CREATE = new Set(['patientId', 'createdAt', 'updatedAt', 'version']);
const FORBIDDEN_UPDATE = new Set(['patientId', 'createdAt', 'updatedAt']);
const SEALED_FIELDS = ['title', 'content', 'metadata', 'attachments', 'deletionReason'] as const;
const hasOwn = (input: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(input, key);

function networkBoundary(body: Record<string, unknown>, forbidden: Set<string>): Result | null {
    for (const field of FORBIDDEN_WRITE) {
        if (hasOwn(body, field)) return { status: 403,
            value: { error: 'Network diary write boundary excludes AI/document-derived fields' } };
    }
    for (const field of forbidden) {
        if (hasOwn(body, field)) return { status: 400,
            value: { error: `Network diary write boundary rejects client-controlled ${field}` } };
    }
    for (const field of SEALED_FIELDS) {
        const value = body[field];
        const empty = field === 'attachments'
            ? value === undefined || value === null || value === ''
            : value === undefined || value === null;
        if (!empty && !isSealedValue(value)) return { status: 400,
            value: { error: field === 'attachments'
                ? 'Network diary attachment references must be sealed with ENC:'
                : `Network diary ${field} must be sealed with ENC:` } };
    }
    return null;
}

function audit(context: Context) {
    return {
        actorType: 'user' as const, actorRef: context.session.userId,
        sourceSurface: 'native' as const, requestId: requestIdFromRequest(context.request),
        flags: ['auth:paired-client', `paired-client:${context.pairedClient.clientId}`, 'scope:ambulatory'],
    };
}

/* @Codex */
export async function createNetworkScopedEntry(context: Context, body: Record<string, unknown>): Promise<Result> {
    const boundary = networkBoundary(body, FORBIDDEN_CREATE);
    if (boundary) return boundary;
    const prepared = prepareEntryCreate(body, 'network', context.patientId);
    if (!prepared.ok) return { status: prepared.status, value: { error: prepared.error } };
    return createEntryOperation({ patientId: context.patientId, id: prepared.id,
        values: prepared.values, changedFields: prepared.changedFields, mode: 'network',
        scopeAmbulatoryId: context.scopeAmbulatoryId, audit: audit(context) });
}

/* @Codex */
export async function updateNetworkScopedEntry(context: UpdateContext, body: Record<string, unknown>): Promise<Result> {
    if (entryExpectedVersion(body.version) === null) {
        return { status: 400, value: { error: 'Version is required' } };
    }
    const boundary = networkBoundary(body, FORBIDDEN_UPDATE);
    if (boundary) return boundary;
    const prepared = prepareEntryUpdate(body, 'network');
    if (!prepared.ok) return { status: prepared.status, value: { error: prepared.error } };
    return updateEntryOperation({ patientId: context.patientId, entryId: context.entryId,
        expectedVersion: prepared.expectedVersion, values: prepared.values,
        changedFields: prepared.changedFields, mode: 'network',
        scopeAmbulatoryId: context.scopeAmbulatoryId, audit: audit(context) });
}
