/* @Codex */
import 'server-only';

import { createHostSmartImportProjectionAttacher } from '../smart-import-projection-attachment-host';
import type { ServerSession } from './server-session';
import { createServerSessionProjectionOwnerRegistry, type ServerSessionProjectionOwner } from './server-session-projection-owner';
import {
    abortResourceUse,
    beginResourceUse,
    commitResourceUse,
    mintResourcePort,
    releaseResourcePort,
    type WebResourcePort,
    type WebResourceUse,
} from './web-auth-lifecycle-owner-adapter';

type ProjectionOwnerRegistry = Pick<ReturnType<typeof createServerSessionProjectionOwnerRegistry>, 'lookup'>;
type ProjectionOwner = Pick<ServerSessionProjectionOwner, 'acquireProjectionIngest'>;
type Tuple = Readonly<{ sessionRef: string; selectionEpoch: number; patientRef: string; ambulatoryRef: string; leaseRef: string }>;
export type ServerSessionSmartImportAttachmentIngestErrorCode = 'input_invalid' | 'owner_unavailable' | 'session_unavailable';
export class ServerSessionSmartImportAttachmentIngestError extends Error {
    constructor(readonly code: ServerSessionSmartImportAttachmentIngestErrorCode) {
        super(`Server session Smart Import attachment ingest rejected: ${code}`);
        this.name = 'ServerSessionSmartImportAttachmentIngestError';
    }
}
function fail(code: ServerSessionSmartImportAttachmentIngestErrorCode): never { throw new ServerSessionSmartImportAttachmentIngestError(code); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('input_invalid');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail('input_invalid');
    const record: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) fail('input_invalid');
        record[key] = descriptor.value;
    }
    return record;
}
function safeExact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    try { return exact(value, keys); } catch (error) {
        if (error instanceof ServerSessionSmartImportAttachmentIngestError) throw error;
        return fail('input_invalid');
    }
}
function opaque(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u.test(value)) fail('input_invalid');
    return value;
}
function tuple(value: unknown): Tuple {
    const input = safeExact(value, ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef']);
    if (!Number.isSafeInteger(input.selectionEpoch) || (input.selectionEpoch as number) < 1) fail('input_invalid');
    return Object.freeze({ sessionRef: opaque(input.sessionRef), selectionEpoch: input.selectionEpoch as number,
        patientRef: opaque(input.patientRef), ambulatoryRef: opaque(input.ambulatoryRef), leaseRef: opaque(input.leaseRef) });
}
function prepared(inputValue: unknown) {
    const input = safeExact(inputValue, ['tuple', 'attachment', 'requestId']);
    return Object.freeze({ currentTuple: tuple(input.tuple), attachment: input.attachment, requestId: opaque(input.requestId) });
}
function ingestPrepared(session: ServerSession, owner: ProjectionOwner, input: ReturnType<typeof prepared>): string {
    const ingest = owner.acquireProjectionIngest(session, input.currentTuple);
    const projection = createHostSmartImportProjectionAttacher({ patientRef: input.currentTuple.patientRef,
        selectionEpoch: input.currentTuple.selectionEpoch }).attach(input.attachment);
    return ingest.ingest({ projection, requestId: input.requestId });
}

function withCurrentWebSession<T>(session: ServerSession, operation: () => T): T {
    let port: WebResourcePort | null = null;
    let use: WebResourceUse | null = null;
    let committed = false;
    try {
        port = mintResourcePort(session);
        if (!port) return fail('session_unavailable');
        use = beginResourceUse(port);
        if (!use || session.authChannel !== 'web' || session.id === 'local-api') return fail('session_unavailable');
        const result = operation();
        committed = commitResourceUse(use);
        if (!committed) return fail('session_unavailable');
        return result;
    } finally {
        if (use && !committed) abortResourceUse(use);
        if (port) releaseResourcePort(port);
    }
}

export function ingestServerSessionSmartImportAttachmentWithOwner(
    session: ServerSession,
    owner: ProjectionOwner,
    inputValue: unknown,
): string {
    return withCurrentWebSession(session, () => ingestPrepared(session, owner, prepared(inputValue)));
}

export function ingestServerSessionSmartImportAttachment(
    session: ServerSession,
    registry: ProjectionOwnerRegistry,
    inputValue: unknown,
): string {
    return withCurrentWebSession(session, () => {
        const input = prepared(inputValue);
        const owner = registry.lookup(session.id);
        if (!owner) return fail('owner_unavailable');
        return ingestPrepared(session, owner, input);
    });
}
