/* @Codex */
import 'server-only';

import { Buffer } from 'node:buffer';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';
import { dbServer } from '../../db-server';
import { peekSession, registerServerSessionResource, type ServerSession } from '../../security/server-session';
import { serverSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner-production';
import { ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';

type Current = Readonly<{ sourceRef: string; revision: number; freshnessEpoch: number }>;
type Bound = Readonly<{ id: string; patientId: string; current: Current; selectionEpoch: number; reviewContextEpoch: number }>;
type Begun = Readonly<{ status: 'begun'; operation: object; bytes: Uint8Array; evidenceAdmissible: false; applyPolicy: 'none'; writesPerformed: 0 }>;
type Final = Readonly<{ status: 'spent' | 'aborted' | 'denied'; evidenceAdmissible: boolean; applyPolicy: 'none'; writesPerformed: 0 }>;
type Row = Readonly<{ id: string; patientId: string; data: string; current: Current }>;
const REF = /^[0-9a-f]{64}$/u; const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u; const DATA_URL = /^data:[^,]*;base64,/iu;
const ROW_KEYS = ['id', 'patientId', 'data', 'sourceRef', 'revision', 'freshnessEpoch'];
const meta = Object.freeze({ applyPolicy: 'none' as const, writesPerformed: 0 as const });
const denied: Final = Object.freeze({ status: 'denied', evidenceAdmissible: false, ...meta });
const spent: Final = Object.freeze({ status: 'spent', evidenceAdmissible: true, ...meta });
const aborted: Final = Object.freeze({ status: 'aborted', evidenceAdmissible: false, ...meta });
const getDescriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf, ownKeys = Reflect.ownKeys;
const apply = Reflect.apply, isProxy = types.isProxy, dbGet = dbServer.get.bind(dbServer) as typeof dbServer.get;
const bytesLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
const bytesSet = Uint8Array.prototype.set, token = (): object => Object.freeze(Object.create(null)) as object;

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
function validSession(value: unknown): value is ServerSession {
    const fields = exact(value, ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt']);
    return !!fields && typeof fields.id === 'string' && fields.authChannel === 'web' && peekSession(fields.id) === value;
}
function selector(value: unknown): string | null {
    const fields = exact(value, ['attachmentId']); const id = fields?.attachmentId;
    return typeof id === 'string' && id.length > 0 && id.length <= 256 && id.trim() === id ? id : null;
}
function read(id: string, patientId: string): Row | null {
    let candidate: unknown;
    try { candidate = dbGet(sql`SELECT id, patient_id AS patientId, data, document_source_ref AS sourceRef,
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
function same(left: Bound, right: Row): boolean { return left.id === right.id && left.patientId === right.patientId
    && left.current.sourceRef === right.current.sourceRef && left.current.revision === right.current.revision
    && left.current.freshnessEpoch === right.current.freshnessEpoch; }
function ledger<T>() {
    type Entry = { key: object; value: T; next: Entry | null }; let head: Entry | null = null;
    const add = (value: T) => { const key = token(); head = { key, value, next: head }; return key; };
    const take = (key: unknown): T | null => { let item = head, prior: Entry | null = null; while (item) {
        if (item.key === key) { if (prior) prior.next = item.next; else head = item.next; item.next = null; return item.value; }
        prior = item; item = item.next;
    } return null; };
    const clear = () => { head = null; }; return [add, take, clear] as const;
}

/** Owns host-readable attachment bytes without accepting caller currentness, patient authority, or parser options. */
export function createAttachmentExtractionSourceAuthority(sessionValue: ServerSession) {
    if (!validSession(sessionValue)) throw new TypeError('Attachment extraction source authority unavailable');
    const session = sessionValue;
    let owner;
    try { owner = serverSessionProjectionOwnerRegistry.acquire(session); }
    catch { throw new TypeError('Attachment extraction source authority unavailable'); }
    const [addLocator, takeLocator, clearLocators] = ledger<Bound>();
    const [addOperation, takeOperation, clearOperations] = ledger<Bound>(); let active = true;
    const revoke = () => { active = false; clearLocators(); clearOperations(); };
    const unregister = registerServerSessionResource(session.id, revoke); if (!unregister) throw new TypeError('Attachment extraction source authority unavailable');
    const lease = (work: (patientId: string) => number) => { if (!active) return 0; let result = 0;
        try { return owner.withLeaseCriticalSection(session, (selection) => { result = work(selection.patientId); return result; }); } catch { return 0; } };
    const epochs = () => ({ selectionEpoch: owner.snapshotSelectionEpoch(session), reviewContextEpoch: owner.snapshotReviewContextEpoch(session) });
    const fresh = (bound: Bound, row: Row) => same(bound, row) && bound.selectionEpoch === owner.snapshotSelectionEpoch(session)
        && bound.reviewContextEpoch === owner.snapshotReviewContextEpoch(session);
    return Object.freeze({
        issue(value: unknown): object | null { const id = selector(value); if (!id) return null; let bound: Bound | null = null;
            if (lease((patientId) => { const row = read(id, patientId); if (!row) return 0; bound = Object.freeze({ id: row.id,
                patientId: row.patientId, current: row.current, ...epochs() }); return 1; }) !== 1 || !bound) return null;
            return addLocator(bound); },
        consume(value: unknown): Begun | Final { const bound = takeLocator(value); if (!bound || !active) return denied; let bytes: Uint8Array | null = null;
            if (lease((patientId) => { const row = read(bound.id, patientId); if (!row || !fresh(bound, row)) return 0; bytes = decode(row.data); return bytes ? 1 : 0; }) !== 1 || !bytes) return denied;
            return Object.freeze({ status: 'begun' as const, operation: addOperation(bound), bytes, evidenceAdmissible: false as const, ...meta }); },
        finalize(value: unknown): Final { const bound = takeOperation(value); if (!bound || !active) return denied;
            return lease((patientId) => { const row = read(bound.id, patientId); return row && fresh(bound, row) ? 1 : 0; }) === 1 ? spent : denied; },
        abort(value: unknown): Final { const bound = takeOperation(value); if (!bound || !active) return denied;
            return lease((patientId) => { const row = read(bound.id, patientId); return row && fresh(bound, row) ? 1 : 0; }) === 1 ? aborted : denied; },
        dispose(): void { if (active) { revoke(); unregister(); } },
    });
}
