/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';

import { dbServer } from '../../db-server';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from '../../security/server-auth';
import { registerServerSessionResource } from '../../security/server-session';

type Currentness = Readonly<{ documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number }>;
type RecordState = Readonly<{ selected: true; currentness: Currentness; selectionEpoch: number; reviewContextEpoch: number; scope: 'document_synthesis_attachment_capture'; revocationGeneration: number }>;
type Broker = { records: Map<string, RecordState>; dispose: () => void; publish: (handle: string, state: RecordState) => boolean };
type Result = Readonly<{ status: 'available' | 'denied'; code: null | 'input_invalid' | 'unavailable'; captureHandle: string | null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;

const OBJECT = Object.prototype; const KEYS = ['attachmentId'] as const; const ROW_KEYS = ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch'] as const;
const HANDLE = /^dsc_[a-f0-9]{32}$/u; const SOURCE_REF = /^[0-9a-f]{64}$/u; const MAX_ID = 256;
const ObjectCreate = Object.create; const ObjectFreeze = Object.freeze; const ObjectAssign = Object.assign; const ObjectHasOwn = Object.hasOwn;
const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ReflectOwnKeys = Reflect.ownKeys; const ArrayIsArray = Array.isArray; const NumberIsSafeInteger = Number.isSafeInteger; const Uint8ArrayConstructor = Uint8Array;
const StringTrim = Function.call.bind(String.prototype.trim) as (value: string) => string; const RegExpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const MapConstructor = Map; const WeakMapConstructor = WeakMap; const mapHas = Function.call.bind(Map.prototype.has) as (map: Map<string, unknown>, key: string) => boolean; const mapSet = Function.call.bind(Map.prototype.set) as (map: Map<string, unknown>, key: string, value: unknown) => Map<string, unknown>; const mapClear = Function.call.bind(Map.prototype.clear) as (map: Map<string, unknown>) => void;
const weakMapGet = Function.call.bind(WeakMap.prototype.get) as <T>(map: WeakMap<object, T>, key: object) => T | undefined; const weakMapSet = Function.call.bind(WeakMap.prototype.set) as <T>(map: WeakMap<object, T>, key: object, value: T) => WeakMap<object, T>; const weakMapDelete = Function.call.bind(WeakMap.prototype.delete) as <T>(map: WeakMap<object, T>, key: object) => boolean;
const IsProxy = types.isProxy; const IsPromise = types.isPromise; const DbGet = dbServer.get.bind(dbServer); const Entropy = randomBytes;

function sealed<T extends Record<string, unknown>>(value: T): Readonly<T> { return ObjectFreeze(ObjectAssign(ObjectCreate(null) as T, value)); }
function denied(code: 'input_invalid' | 'unavailable'): Result { return sealed({ status: 'denied' as const, code, captureHandle: null, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }); }
function available(captureHandle: string): Result { return sealed({ status: 'available' as const, code: null, captureHandle, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null { try { if (typeof value !== 'object' || value === null || IsProxy(value) || ArrayIsArray(value) || ObjectGetPrototypeOf(value) !== OBJECT || ReflectOwnKeys(value).length !== keys.length) return null; const descriptors = ObjectGetOwnPropertyDescriptors(value); const output = ObjectCreate(null) as Record<string, unknown>; for (const key of keys) { const descriptor = ObjectGetOwnPropertyDescriptor(descriptors, key); if (!descriptor || !ObjectHasOwn(descriptor, 'value')) return null; const field = descriptor.value as PropertyDescriptor; if (!field || field.enumerable !== true || !ObjectHasOwn(field, 'value')) return null; output[key] = field.value; } return output; } catch { return null; } }
function intent(value: unknown): string | null { const id = exact(value, KEYS)?.attachmentId; return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID && id === StringTrim(id) ? id : null; }
function currentness(value: unknown): Currentness | null { const row = IsPromise(value) ? null : exact(value, ROW_KEYS); if (!row || typeof row.documentSourceRef !== 'string' || !RegExpTest(SOURCE_REF, row.documentSourceRef) || typeof row.documentRevision !== 'number' || !NumberIsSafeInteger(row.documentRevision) || row.documentRevision < 1 || typeof row.documentFreshnessEpoch !== 'number' || !NumberIsSafeInteger(row.documentFreshnessEpoch) || row.documentFreshnessEpoch < 1) return null; return sealed({ documentSourceRef: row.documentSourceRef, documentRevision: row.documentRevision, documentFreshnessEpoch: row.documentFreshnessEpoch }); }
function mint(bytes: unknown): string | null { if (!(bytes instanceof Uint8ArrayConstructor) || IsProxy(bytes) || bytes.length !== 16) return null; let value = 'dsc_'; for (let index = 0; index < 16; index += 1) { const byte = bytes[index]; if (typeof byte !== 'number' || !NumberIsSafeInteger(byte) || byte < 0 || byte > 255) return null; value += '0123456789abcdef'[byte >>> 4]! + '0123456789abcdef'[byte & 15]!; } return RegExpTest(HANDLE, value) ? value : null; }

const ownerBrokers = new WeakMapConstructor<object, WeakMap<object, Broker>>();
function brokerFor(context: NonNullable<Awaited<ReturnType<typeof acquireAuthenticatedWebSessionProjectionOwnerContext>>>): Broker {
    let sessions = weakMapGet(ownerBrokers, context.owner); if (!sessions) { sessions = new WeakMapConstructor<object, Broker>(); weakMapSet(ownerBrokers, context.owner, sessions); }
    const prior = weakMapGet(sessions, context.session); if (prior) return prior;
    const records = new MapConstructor<string, RecordState>(); let disposed = false; let unregister: (() => void) | null = null;
    const dispose = () => { if (disposed) return; disposed = true; mapClear(records); try { unregister?.(); } catch { /* disposal remains final */ } unregister = null; weakMapDelete(sessions!, context.session); };
    const broker: Broker = { records, dispose, publish(handle, state) { if (disposed || mapHas(records, handle)) return false; let registered: (() => void) | null; try { registered = unregister ?? registerServerSessionResource(context.session.id, dispose); } catch { return false; } if (!registered || disposed || mapHas(records, handle)) return false; unregister = registered; mapSet(records, handle, state); return true; } };
    weakMapSet(sessions, context.session, broker); return broker;
}

/** Fixed server-only I1b boundary: accepts the sole own-data attachment intent and returns an opaque capture handle. */
export async function captureDocumentSynthesisAuthenticatedAttachment(input: unknown): Promise<Result> {
    const attachmentId = intent(input); if (!attachmentId) return denied('input_invalid');
    let context: Awaited<ReturnType<typeof acquireAuthenticatedWebSessionProjectionOwnerContext>>;
    try { context = await acquireAuthenticatedWebSessionProjectionOwnerContext(); } catch { return denied('unavailable'); }
    if (!context) return denied('unavailable');
    try { const broker = brokerFor(context); return context.owner.withLeaseCriticalSection(context.session, (selection) => { const tuple = currentness(DbGet(sql`SELECT a.document_source_ref AS documentSourceRef, a.document_revision AS documentRevision, a.document_freshness_epoch AS documentFreshnessEpoch FROM attachments AS a INNER JOIN patients_to_ambulatories AS pta ON pta.patient_id = a.patient_id WHERE a.id = ${attachmentId} AND a.patient_id = ${selection.patientId} AND pta.ambulatory_id = ${selection.ambulatoryId} LIMIT 1`)); if (!tuple) return denied('unavailable'); const captureHandle = mint(Entropy(16)); if (!captureHandle) return denied('unavailable'); const state = sealed<RecordState>({ selected: true, currentness: tuple, selectionEpoch: context.owner.snapshotSelectionEpoch(context.session), reviewContextEpoch: context.owner.snapshotReviewContextEpoch(context.session), scope: 'document_synthesis_attachment_capture', revocationGeneration: 0 }); return broker.publish(captureHandle, state) ? available(captureHandle) : denied('unavailable'); }); } catch { return denied('unavailable'); }
}
