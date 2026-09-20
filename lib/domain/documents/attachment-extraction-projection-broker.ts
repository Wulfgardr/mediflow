/* @Codex */
import 'server-only';
import { randomBytes } from 'node:crypto';
import type { ServerSession } from '../../security/server-session';
import { serverSessionProjectionOwnerProductionOwner } from '../../security/server-session-projection-owner-production-internal';
import { bindAttachmentExtractionSelection } from './attachment-extraction-selection-binding';
import { createAttachmentExtractionSourceAuthority } from './attachment-extraction-source-authority';
import {
    ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA, ATTACHMENT_EXTRACTION_GRANT_TTL_MS,
    ATTACHMENT_EXTRACTION_OPERATION_TTL_MS, ATTACHMENT_EXTRACTION_MAX_PENDING,
    type AttachmentExtractionProjectionGrant,
} from './attachment-extraction-projection-protocol';

type Authority = ReturnType<typeof createAttachmentExtractionSourceAuthority>;
type Entry = {
    session: ServerSession; attachmentId: string; authority: Authority; locator: object;
    grant: AttachmentExtractionProjectionGrant; state: 'issued' | 'running';
    timer: ReturnType<typeof setTimeout>; closed: boolean; close: () => void;
};
const entries = new Map<string, Entry>();
let running: Entry | null = null;
const tokenShape = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function matches(entry: Entry, session: ServerSession, attachmentId: string): boolean {
    return entry.attachmentId === attachmentId && entry.session.id === session.id
        && entry.session.userId === session.userId && entry.session.authChannel === session.authChannel
        && entry.session.createdAt === session.createdAt && entry.session.expiresAt === session.expiresAt;
}

/** Extends ADR0095 for attachments, using the existing source/session owners, not another authority framework. */
export function acquireAttachmentExtractionProjection(session: ServerSession, attachmentId: string): AttachmentExtractionProjectionGrant | null {
    let authority: Authority | null = null;
    try {
        if (entries.size >= ATTACHMENT_EXTRACTION_MAX_PENDING || running) return null;
        // Retire an unused grant for this session. A running operation is never silently replaced.
        for (const entry of entries.values()) if (entry.session.id === session.id) entry.close();
        authority = createAttachmentExtractionSourceAuthority(session);
        // A compatible confirmed multi-membership selection is preserved. Only a NEW explicit acquisition
        // may select the unique canonical pair; claim/checkpoint/finalize never rebind or renew a stale grant.
        let issued = authority.issueProjection({ attachmentId });
        if (!issued && bindAttachmentExtractionSelection(session, attachmentId)) issued = authority.issueProjection({ attachmentId });
        if (!issued) { authority.dispose(); return null; }
        const grantId = randomBytes(32).toString('hex');
        const grant = Object.freeze({ schemaVersion: ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA, grantId,
            expiresAt: Date.now() + ATTACHMENT_EXTRACTION_GRANT_TTL_MS, canonicalSource: issued.canonicalSource });
        const ownedAuthority = authority;
        let detachSelection = () => {};
        const entry: Entry = {
            session, attachmentId, authority, locator: issued.locator, grant, state: 'issued', closed: false,
            timer: setTimeout(() => entry.close(), ATTACHMENT_EXTRACTION_GRANT_TTL_MS),
            close() {
                if (entry.closed) return;
                entry.closed = true; entries.delete(grantId); clearTimeout(entry.timer);
                ownedAuthority.signal.removeEventListener('abort', entry.close);
                // Selection/session owners invoke dependents synchronously while retiring.
                // Revoke bytes and publication now; unregister only after that stack returns.
                ownedAuthority.cancel();
                queueMicrotask(() => { detachSelection(); ownedAuthority.dispose(); });
            },
        };
        entry.timer.unref?.();
        entries.set(grantId, entry);
        authority.signal.addEventListener('abort', entry.close, { once: true });
        const lifecycle = serverSessionProjectionOwnerProductionOwner.selectionLifecycleController;
        let registeredSelection = false;
        const selected = lifecycle.withCurrentSelection(session, (scope) => {
            const registration = lifecycle.registerDependent(scope, entry.close);
            if (registration) { registeredSelection = true; detachSelection = () => { lifecycle.unregisterDependent(scope, registration); }; }
        });
        if (!selected || !registeredSelection || !authority.checkLocator(issued.locator)) { entry.close(); return null; }
        return grant;
    } catch { authority?.dispose(); return null; }
}

/** Claims once before reading the body. Replay cannot start a second parser or consume another session's grant. */
export function claimAttachmentExtractionProjection(session: ServerSession, attachmentId: string, grantId: unknown) {
    if (!tokenShape(grantId)) return null;
    const entry = entries.get(grantId);
    if (!entry || !matches(entry, session, attachmentId) || entry.closed || entry.state !== 'issued' || running) return null;
    if (Date.now() >= entry.grant.expiresAt || !entry.authority.checkLocator(entry.locator)) { entry.close(); return null; }
    entry.state = 'running'; running = entry;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(entry.close, ATTACHMENT_EXTRACTION_OPERATION_TTL_MS); entry.timer.unref?.();
    let operation: object | null = null;
    return Object.freeze({
        grant: entry.grant, signal: entry.authority.signal,
        current: () => !entry.closed && (operation ? entry.authority.checkpoint(operation) : entry.authority.checkLocator(entry.locator)),
        consume(bytes: Uint8Array) {
            if (entry.closed || operation) return null;
            const result = entry.authority.consumeProjection(entry.locator, bytes);
            if (result.status !== 'begun') { entry.close(); return null; }
            operation = result.operation; return result;
        },
        finalize() {
            if (entry.closed || !operation) return false;
            const result = entry.authority.finalize(operation); operation = null;
            return result.status === 'spent' && result.evidenceAdmissible;
        },
        cancel: entry.close,
        dispose() {
            entry.close();
            // A cancelled worker still occupies this slot until its bounded computation returns.
            if (running === entry) running = null;
        },
    });
}
export type AttachmentExtractionProjectionUse = NonNullable<ReturnType<typeof claimAttachmentExtractionProjection>>;

export function cancelAttachmentExtractionProjection(session: ServerSession, attachmentId: string, grantId: unknown): void {
    if (!tokenShape(grantId)) return;
    const entry = entries.get(grantId);
    if (entry && matches(entry, session, attachmentId)) entry.close();
}
