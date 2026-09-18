/* @Codex */
import 'server-only';

import { Buffer } from 'node:buffer';
import { hash } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';
import { dbServer } from '../../db-server';
import type { ServerSession } from '../../security/server-session';
import { serverSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner-production';
import {
    abortResourceUse,
    beginResourceUse,
    commitResourceUse,
    mintResourcePort,
    registerPrivateResource,
    releaseResourcePort,
    unregisterPrivateResource,
    type ResourcePort as WebResourcePort,
    type ResourceRegistration as WebResourceRegistration,
    type ResourceUse as WebResourceUse,
} from '../../security/ordinary-session-authority';
import * as webLifetime from '../../security/web-auth-lifecycle-owner-adapter';
import * as nativeLifetime from '../../security/native-inference-lifecycle';
import { nativeSessionProjectionOwnerRegistry } from '../../security/native-session-projection-owner-production';
import { ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';
import {
    captureAttachmentExtractionLocatorGeneration,
    isCurrentAttachmentExtractionLocatorGeneration,
} from './attachment-extraction-locator-revocation';

export type AttachmentExtractionCurrent = Readonly<{ sourceRef: string; revision: number; freshnessEpoch: number }>;
type Bound = Readonly<{ id: string; patientId: string; current: AttachmentExtractionCurrent; selectionEpoch: number; reviewContextEpoch: number; locatorGeneration: object; storedDataSha256: string }>;
type Begun = Readonly<{ status: 'begun'; operation: object; bytes: Uint8Array; evidenceAdmissible: false; applyPolicy: 'none'; writesPerformed: 0 }>;
type Final = Readonly<{ status: 'spent' | 'aborted' | 'denied'; evidenceAdmissible: boolean; applyPolicy: 'none'; writesPerformed: 0 }>;
type Row = Readonly<{ id: string; patientId: string; data: string; current: AttachmentExtractionCurrent }>;
const REF = /^[0-9a-f]{64}$/u; const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u; const DATA_URL = /^data:[^,]*;base64,/iu;
const ROW_KEYS = ['id', 'patientId', 'data', 'sourceRef', 'revision', 'freshnessEpoch'];
const meta = Object.freeze({ applyPolicy: 'none' as const, writesPerformed: 0 as const });
const denied: Final = Object.freeze({ status: 'denied', evidenceAdmissible: false, ...meta });
const spent: Final = Object.freeze({ status: 'spent', evidenceAdmissible: true, ...meta });
const aborted: Final = Object.freeze({ status: 'aborted', evidenceAdmissible: false, ...meta });
const getDescriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf, ownKeys = Reflect.ownKeys;
const apply = Reflect.apply, isProxy = types.isProxy, dbGet = dbServer.get.bind(dbServer) as typeof dbServer.get;
const bytesLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
const bytesSet = Uint8Array.prototype.set, bytesFill = Uint8Array.prototype.fill;
const storedDigest = (data: string) => hash('sha256', data);
const token = (): object => Object.freeze(Object.create(null)) as object;

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || isProxy(value) || getPrototype(value) !== Object.prototype) return null;
    const found = ownKeys(value); if (found.length !== keys.length) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!; if (found[index] !== key) return null;
        const descriptor = getDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        result[key] = descriptor.value;
    }
    return result;
}
function validSession(value: unknown, native: boolean): value is ServerSession {
    const keys = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'];
    if (!value || typeof value !== 'object' || isProxy(value)) return false;
    try {
        const prototype = getPrototype(value);
        if (prototype !== null && prototype !== Object.prototype) return false;
        const found = ownKeys(value);
        if (found.length !== keys.length) return false;
        const fields: Record<string, unknown> = Object.create(null);
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (found[index] !== key) return false;
            const descriptor = getDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return false;
            fields[key] = descriptor.value;
        }
        return typeof fields.id === 'string' && fields.id.length > 0
            && typeof fields.userId === 'string' && fields.userId.length > 0
            && typeof fields.username === 'string' && fields.username.length > 0
            && typeof fields.role === 'string' && fields.role.length > 0
            && fields.authChannel === (native ? 'native' : 'web')
            && Number.isFinite(fields.createdAt) && Number.isFinite(fields.expiresAt);
    } catch { return false; }
}
function selector(value: unknown): string | null {
    const fields = exact(value, ['attachmentId']); const id = fields?.attachmentId;
    return typeof id === 'string' && id.length > 0 && id.length <= 256 && id.trim() === id ? id : null;
}
function read(id: string, patientId: string, metadataOnly = false): Row | null {
    let candidate: unknown;
    const sourceColumn = metadataOnly ? sql`''` : sql`data`;
    try { candidate = dbGet(sql`SELECT id, patient_id AS patientId, ${sourceColumn} AS data, document_source_ref AS sourceRef,
        document_revision AS revision, document_freshness_epoch AS freshnessEpoch FROM attachments WHERE id = ${id} AND patient_id = ${patientId}`); }
    catch { return null; }
    const row = exact(candidate, ROW_KEYS); if (!row || row.id !== id || row.patientId !== patientId || typeof row.data !== 'string'
        || typeof row.sourceRef !== 'string' || !REF.test(row.sourceRef) || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1
        || !Number.isSafeInteger(row.freshnessEpoch) || (row.freshnessEpoch as number) < 1) return null;
    return Object.freeze({ id, patientId, data: row.data, current: Object.freeze({ sourceRef: row.sourceRef,
        revision: row.revision as number, freshnessEpoch: row.freshnessEpoch as number }) });
}
function decode(data: string): Uint8Array | null {
    if (!data || data.startsWith('ENC:') || data.length > Math.ceil(ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES / 3) * 4 + 1024) return null;
    const offset = DATA_URL.test(data) ? data.indexOf(',') + 1 : 0; const compact = data.slice(offset).replace(/\s/gu, '');
    if (!compact || compact.length % 4 !== 0 || !BASE64.test(compact)) return null;
    try {
        const decoded = Buffer.from(compact, 'base64'); if (decoded.length < 1 || decoded.length > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES
            || decoded.toString('base64') !== compact) return null;
        const copy = new Uint8Array(apply(bytesLength, decoded, [])); apply(bytesSet, copy, [decoded]); return copy;
    } catch { return null; }
}
function same(left: Bound, right: Row, withCiphertext = true): boolean { return left.id === right.id && left.patientId === right.patientId
    && left.current.sourceRef === right.current.sourceRef && left.current.revision === right.current.revision
    && left.current.freshnessEpoch === right.current.freshnessEpoch
    && (!withCiphertext || left.storedDataSha256 === storedDigest(right.data)); }
function ledger<T>() {
    type Entry = { key: object; value: T; next: Entry | null }; let head: Entry | null = null;
    const add = (value: T) => { const key = token(); head = { key, value, next: head }; return key; };
    const take = (key: unknown): T | null => { let item = head, prior: Entry | null = null; while (item) {
        if (item.key === key) { if (prior) prior.next = item.next; else head = item.next; item.next = null; return item.value; }
        prior = item; item = item.next;
    } return null; };
    const peek = (key: unknown): T | null => { let item = head; while (item) {
        if (item.key === key) return item.value; item = item.next;
    } return null; };
    const clear = () => { head = null; }; return [add, take, clear, peek] as const;
}

/** Owns attachment acquisition without accepting caller currentness, patient authority, or parser options. */
function createSourceAuthority(sessionValue: ServerSession, native: boolean) {
    const { abortResourceUse, beginResourceUse, commitResourceUse, mintResourcePort, registerPrivateResource,
        releaseResourcePort, unregisterPrivateResource } = native ? nativeLifetime : webLifetime;
    if (!validSession(sessionValue, native)) throw new TypeError('Attachment extraction source authority unavailable');
    const session = sessionValue;
    let port: WebResourcePort | null = mintResourcePort(session);
    let acquisitionUse: WebResourceUse | null = port ? beginResourceUse(port) : null;
    let registration: WebResourceRegistration | null = null;
    let acquisitionCommitted = false;
    try {
        if (!port || !acquisitionUse) throw new TypeError('Attachment extraction source authority unavailable');
        const owner = (native ? nativeSessionProjectionOwnerRegistry : serverSessionProjectionOwnerRegistry).acquire(session);
        const [addLocator, takeLocator, clearLocators, peekLocator] = ledger<Bound>();
        const [addOperation, takeOperation, clearOperations, peekOperation] = ledger<{ bound: Bound; bytes: Uint8Array }>(); let active = true;
        const retirement = new AbortController();
        const buffers: Uint8Array[] = [];
        const wipe = () => { for (let index = 0; index < buffers.length; index += 1) apply(bytesFill, buffers[index]!, [0]); buffers.length = 0; };
        const revoke = () => { active = false; clearLocators(); clearOperations(); wipe(); retirement.abort(); };
        registration = registerPrivateResource(port, () => { revoke(); });
        if (!registration) throw new TypeError('Attachment extraction source authority unavailable');
        acquisitionCommitted = commitResourceUse(acquisitionUse);
        if (!acquisitionCommitted) throw new TypeError('Attachment extraction source authority unavailable');
        const lease = (work: (patientId: string) => number) => {
            if (!active || !port) return 0;
            let use: WebResourceUse | null = null;
            let committed = false;
            try {
                use = beginResourceUse(port);
                if (!use) return 0;
                let result = 0;
                const selected = owner.withLeaseCriticalSection(session, (selection) => {
                    result = work(selection.patientId);
                    return result;
                });
                committed = commitResourceUse(use);
                return committed ? selected : 0;
            } catch { return 0; }
            finally { if (use && !committed) abortResourceUse(use); }
        };
        const epochs = () => ({ selectionEpoch: owner.snapshotSelectionEpoch(session), reviewContextEpoch: owner.snapshotReviewContextEpoch(session) });
        const fresh = (bound: Bound, row: Row, withCiphertext = true) => same(bound, row, withCiphertext) && bound.selectionEpoch === owner.snapshotSelectionEpoch(session)
            && bound.reviewContextEpoch === owner.snapshotReviewContextEpoch(session);
        const current = (bound: Bound | null, withCiphertext = true): boolean => !!bound && lease((patientId) => {
            if (!isCurrentAttachmentExtractionLocatorGeneration(bound.locatorGeneration)) return 0;
            const row = read(bound.id, patientId, !withCiphertext); return row && fresh(bound, row, withCiphertext) ? 1 : 0;
        }) === 1;
        const issue = (value: unknown, encryptedOnly: boolean): { locator: object; canonicalSource: AttachmentExtractionCurrent } | null => {
            const id = selector(value); if (!id) return null; let bound: Bound | null = null;
            if (lease((patientId) => {
                const row = read(id, patientId); if (!row || (encryptedOnly && !row.data.startsWith('ENC:'))) return 0;
                const locatorGeneration = captureAttachmentExtractionLocatorGeneration();
                bound = Object.freeze({ id: row.id, patientId: row.patientId, current: row.current,
                    storedDataSha256: storedDigest(row.data), ...epochs(), locatorGeneration });
                return isCurrentAttachmentExtractionLocatorGeneration(locatorGeneration) ? 1 : 0;
            }) !== 1) return null;
            const published = bound as Bound | null;
            if (!published || !isCurrentAttachmentExtractionLocatorGeneration(published.locatorGeneration)) return null;
            return Object.freeze({ locator: addLocator(published), canonicalSource: published.current });
        };
        const consume = (value: unknown, projection?: unknown): Begun | Final => {
            const bound = takeLocator(value); if (!bound || !active) return denied;
            let bytes: Uint8Array | null = null;
            if (lease((patientId) => {
                if (!isCurrentAttachmentExtractionLocatorGeneration(bound.locatorGeneration)) return 0;
                const row = read(bound.id, patientId); if (!row || !fresh(bound, row)) return 0;
                if (projection === undefined) bytes = decode(row.data);
                else {
                    // The authenticated client supplies content, never ciphertext equality or currentness authority.
                    if (!row.data.startsWith('ENC:') || isProxy(projection) || !types.isUint8Array(projection)
                        || getPrototype(projection) !== Uint8Array.prototype) return 0;
                    const length = apply(bytesLength, projection, []) as number;
                    if (length < 1 || length > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES) return 0;
                    bytes = new Uint8Array(length); apply(bytesSet, bytes, [projection]);
                }
                return bytes ? 1 : 0;
            }) !== 1 || !bytes) { if (bytes) apply(bytesFill, bytes, [0]); return denied; }
            buffers.push(bytes);
            return Object.freeze({ status: 'begun' as const, operation: addOperation({ bound, bytes }), bytes,
                evidenceAdmissible: false as const, ...meta });
        };
        return Object.freeze({
            signal: retirement.signal,
            cancel(): void { revoke(); },
            issue(value: unknown): object | null { return issue(value, false)?.locator ?? null; },
            issueProjection(value: unknown) { return issue(value, true); },
            checkLocator(value: unknown): boolean { return current(peekLocator(value), false); },
            checkpoint(value: unknown): boolean { return current(peekOperation(value)?.bound ?? null); },
            consume(value: unknown): Begun | Final { return consume(value); },
            consumeProjection(value: unknown, bytes: unknown): Begun | Final {
                if (bytes === undefined) { takeLocator(value); return denied; }
                return consume(value, bytes);
            },
            finalize(value: unknown): Final {
                const operation = takeOperation(value); const result = current(operation?.bound ?? null) ? spent : denied;
                if (operation) { apply(bytesFill, operation.bytes, [0]); const index = buffers.indexOf(operation.bytes); if (index >= 0) buffers.splice(index, 1); }
                return result;
            },
            abort(value: unknown): Final {
                const operation = takeOperation(value); const result = current(operation?.bound ?? null) ? aborted : denied;
                if (operation) { apply(bytesFill, operation.bytes, [0]); const index = buffers.indexOf(operation.bytes); if (index >= 0) buffers.splice(index, 1); }
                return result;
            },
            dispose(): void {
                revoke();
                if (port && registration) unregisterPrivateResource(port, registration);
                if (port) releaseResourcePort(port);
                registration = null;
                port = null;
            },
        });
    } catch {
        if (acquisitionUse && !acquisitionCommitted) abortResourceUse(acquisitionUse);
        if (port && registration) unregisterPrivateResource(port, registration);
        if (port) releaseResourcePort(port);
        port = null;
        throw new TypeError('Attachment extraction source authority unavailable');
    } finally {
        acquisitionUse = null;
    }
}

export function createAttachmentExtractionSourceAuthority(session: ServerSession) {
    return createSourceAuthority(session, false);
}
export function createNativeAttachmentExtractionSourceAuthority(session: ServerSession) {
    return createSourceAuthority(session, true);
}
