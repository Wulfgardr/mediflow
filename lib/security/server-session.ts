/* @Codex */
import 'server-only';

import crypto from 'crypto';
import { types } from 'node:util';

import {
    abortPreparedAuthControlActivation,
    abortPreparedAuthControlRetirement,
    commitPreparedAuthControlActivation,
    commitPreparedAuthControlRetirement,
    prepareAuthControlActivation,
    prepareAuthControlRetirement,
} from './web-auth-control-record';

export const SESSION_COOKIE_NAME = 'mediflow_session';
const SESSION_TTL_MS = Number(process.env.MEDIFLOW_SESSION_TTL_MS || 1000 * 60 * 60 * 8);
const MapConstructor = Map;
const SetConstructor = Set;
const WeakMapConstructor = WeakMap;
const DateNow = Date.now;
const ObjectCreate = Object.create;
const ObjectPrototype = Object.prototype;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectFreeze = Object.freeze;
const applyIntrinsic = Reflect.apply;
const functionToString = Function.prototype.toString;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const mapClear = Map.prototype.clear;
const mapKeys = Map.prototype.keys;
const mapValues = Map.prototype.values;
const mapIteratorNext = ObjectGetPrototypeOf(new MapConstructor().keys()).next;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setValues = Set.prototype.values;
const setIteratorNext = ObjectGetPrototypeOf(new SetConstructor().values()).next;
const setSize = ObjectGetOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const cryptoRandomBytes = crypto.randomBytes;
const bufferToString = Buffer.prototype.toString;
const arrayPush = Array.prototype.push;
const isProxy = types.isProxy;

function getMapValue<K, V>(registry: Map<K, V>, key: K): V | undefined {
    return applyIntrinsic(mapGet, registry, [key]);
}

function setMapValue<K, V>(registry: Map<K, V>, key: K, value: V): void {
    applyIntrinsic(mapSet, registry, [key, value]);
}

function deleteMapValue<K, V>(registry: Map<K, V>, key: K): void {
    applyIntrinsic(mapDelete, registry, [key]);
}

function clearMap<K, V>(registry: Map<K, V>): void {
    applyIntrinsic(mapClear, registry, []);
}

function nextMapIterator<T>(iterator: object): IteratorResult<T> {
    return applyIntrinsic(mapIteratorNext, iterator, []) as IteratorResult<T>;
}

function mapKeysOf<K, V>(registry: Map<K, V>): object {
    return applyIntrinsic(mapKeys, registry, []);
}

function mapValuesOf<K, V>(registry: Map<K, V>): object {
    return applyIntrinsic(mapValues, registry, []);
}

function addSetValue<T>(registry: Set<T>, value: T): void {
    applyIntrinsic(setAdd, registry, [value]);
}

function deleteSetValue<T>(registry: Set<T>, value: T): boolean {
    return applyIntrinsic(setDelete, registry, [value]);
}

function nextSetIterator<T>(iterator: object): IteratorResult<T> {
    return applyIntrinsic(setIteratorNext, iterator, []) as IteratorResult<T>;
}

function setSizeOf<T>(registry: Set<T>): number {
    return applyIntrinsic(setSize, registry, []);
}

function getWeakMapValue<K extends object, V>(registry: WeakMap<K, V>, key: K): V | undefined {
    return applyIntrinsic(weakMapGet, registry, [key]);
}

function setWeakMapValue<K extends object, V>(registry: WeakMap<K, V>, key: K, value: V): void {
    applyIntrinsic(weakMapSet, registry, [key, value]);
}

function appendArrayValue<T>(target: T[], value: T): void {
    applyIntrinsic(arrayPush, target, [value]);
}

export type ServerSessionDisposalReason = 'session_deleted' | 'session_expired' | 'sessions_cleared' | 'application_locked';
export type ServerSessionResourceDisposer = (reason: ServerSessionDisposalReason) => void;
export type ServerSessionCleanupOutcome = 'completed' | 'failed' | 'unknown';
export type WebServerSessionRetirementReason = 'lock' | 'dispose' | 'expired' | 'delete' | 'clear';

interface ServerSessionResourceRegistration {
    active: boolean;
    dispose: ServerSessionResourceDisposer;
}

export interface ServerSession {
    id: string;
    userId: string;
    username: string;
    role: string;
    authChannel: 'web' | 'native' | 'system';
    createdAt: number;
    expiresAt: number;
}

export type NativeServerSessionBinding = Readonly<{
    clientId: string;
    clientPlatform: 'macos' | 'ios' | 'ipados';
}>;

declare const stagedWebSessionCapsule: unique symbol;
export type StagedWebServerSession = { readonly [stagedWebSessionCapsule]: never };
declare const preparedWebSessionCapability: unique symbol;
export type PreparedWebServerSession = { readonly [preparedWebSessionCapability]: never };
declare const armedWebSessionPort: unique symbol;
export type ArmedWebServerSessionPort = { readonly [armedWebSessionPort]: never };

interface StagedWebSessionRecord {
    active: boolean;
    userId: string;
    username: string;
    role: string;
    createdAt: number;
    expiresAt: number;
}

interface PreparedWebSessionRecord {
    active: boolean;
    session: ServerSession;
}

interface ArmedWebSessionCellRecord {
    state: 'ARMED_ACTIVATE' | 'ACTIVE' | 'ARMED_RETIRE' | 'RETIRED' | 'TOMBSTONE';
    session: ServerSession;
    next: ArmedWebSessionCellRecord | null;
    activationTicket: unknown | null;
    retirement: unknown | null;
}

const sessions = new MapConstructor<string, ServerSession>();
const nativeSessionBindings = new WeakMap<ServerSession, NativeServerSessionBinding>();
const sessionResources = new MapConstructor<string, Set<ServerSessionResourceRegistration>>();
const sessionCleanupOutcomes = new MapConstructor<string, Exclude<ServerSessionCleanupOutcome, 'unknown'>>();
const stagedWebSessionRecords = new WeakMapConstructor<object, StagedWebSessionRecord>();
const stagedWebSessions = new SetConstructor<StagedWebSessionRecord>();
const preparedWebSessionRecords = new WeakMapConstructor<object, PreparedWebSessionRecord>();
const preparedWebSessionReservations = new MapConstructor<string, PreparedWebSessionRecord>();
const armedWebSessionPortRecords = new WeakMapConstructor<object, ArmedWebSessionCellRecord>();
const armedWebSessionCellsById = ObjectCreate(null) as Record<string, ArmedWebSessionCellRecord | undefined>;
let armedWebSessionCellHead: ArmedWebSessionCellRecord | null = null;
let webSessionPrepareInProgress = false;
let webSessionPreparePoisoned = false;
let webSessionCellLifecycle: 'idle' | 'active' | 'cleanup' = 'idle';
let webSessionCellLifecyclePoisoned = false;

function isSupportedSynchronousDisposer(candidate: unknown): candidate is ServerSessionResourceDisposer {
    if (typeof candidate !== 'function' || isProxy(candidate)) return false;
    try {
        const source = applyIntrinsic(functionToString, candidate, []) as string;
        return !/^\s*async(?:\s|\()/u.test(source) && !source.includes('[native code]');
    } catch {
        return false;
    }
}

function recordCleanupOutcome(sessionId: string, failed: boolean): ServerSessionCleanupOutcome {
    const prior = getMapValue(sessionCleanupOutcomes, sessionId);
    const outcome = prior === 'failed' || failed ? 'failed' : 'completed';
    setMapValue(sessionCleanupOutcomes, sessionId, outcome);
    return outcome;
}

function disposeSessionResources(sessionId: string, reason: ServerSessionDisposalReason): boolean {
    const registrations = getMapValue(sessionResources, sessionId);
    deleteMapValue(sessionResources, sessionId);
    if (!registrations) return false;

    let disposalFailed = false;

    const iterator = applyIntrinsic(setValues, registrations, []);
    for (let next = nextSetIterator<ServerSessionResourceRegistration>(iterator); !next.done;
        next = nextSetIterator<ServerSessionResourceRegistration>(iterator)) {
        const registration = next.value;
        if (!registration.active) continue;
        registration.active = false;
        try {
            const outcome = registration.dispose(reason);
            if (outcome !== undefined) disposalFailed = true;
        } catch {
            // Session authority is already removed; cleanup failures stay opaque.
            disposalFailed = true;
        }
    }
    return disposalFailed;
}

function completeSessionTermination(
    sessionId: string,
    sessionBeforeDeletion: ServerSession | null,
    reason: ServerSessionDisposalReason,
): Readonly<{
    sessionBeforeDeletion: ServerSession | null;
    cleanupOutcome: ServerSessionCleanupOutcome;
    authorityAbsent: boolean;
}> {
    const registrations = getMapValue(sessionResources, sessionId);
    const disposalFailed = disposeSessionResources(sessionId, reason);
    const cleanupOutcome = sessionBeforeDeletion || registrations
        ? recordCleanupOutcome(sessionId, disposalFailed)
        : getMapValue(sessionCleanupOutcomes, sessionId) ?? 'unknown';
    return { sessionBeforeDeletion, cleanupOutcome, authorityAbsent: getMapValue(sessions, sessionId) === undefined };
}

function terminateSession(sessionId: string, reason: ServerSessionDisposalReason) {
    const sessionBeforeDeletion = getMapValue(sessions, sessionId) ?? null;
    deleteMapValue(sessions, sessionId);
    return completeSessionTermination(sessionId, sessionBeforeDeletion, reason);
}

export function registerServerSessionResource(
    sessionId: string,
    dispose: ServerSessionResourceDisposer,
): (() => void) | null {
    if (!isSupportedSynchronousDisposer(dispose)) return null;
    const session = getMapValue(sessions, sessionId);
    if (!session) return null;
    if (session.expiresAt <= DateNow()) {
        terminateSession(sessionId, 'session_expired');
        return null;
    }

    const registration: ServerSessionResourceRegistration = { active: true, dispose };
    const registrations = getMapValue(sessionResources, sessionId) ?? new SetConstructor<ServerSessionResourceRegistration>();
    addSetValue(registrations, registration);
    setMapValue(sessionResources, sessionId, registrations);

    return () => {
        const activeRegistrations = getMapValue(sessionResources, sessionId);
        if (!activeRegistrations || !deleteSetValue(activeRegistrations, registration)) return;
        registration.active = false;
        if (setSizeOf(activeRegistrations) === 0) deleteMapValue(sessionResources, sessionId);
    };
}

export function createSession(
    user: { id: string; username: string; role: string },
    authChannel: ServerSession['authChannel'] = 'web'
): ServerSession {
    const now = DateNow();
    const session: ServerSession = {
        id: crypto.randomBytes(32).toString('hex'),
        userId: user.id,
        username: user.username,
        role: user.role,
        authChannel,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS
    };
    if (getMapValue(sessions, session.id) || getMapValue(preparedWebSessionReservations, session.id)
        || armedWebSessionCellsById[session.id]) {
        throw new Error('server session id unavailable');
    }
    setMapValue(sessions, session.id, session);
    return session;
}

/* @Codex: native authority is server-tagged and bound to the admitted paired client. */
export function createNativeServerSession(
    user: { id: string; username: string; role: string }, binding: NativeServerSessionBinding,
): ServerSession {
    if (!isNativeBinding(binding)) throw new Error('invalid native session binding');
    const session = createSession(user, 'native');
    nativeSessionBindings.set(session, ObjectFreeze({ clientId: binding.clientId, clientPlatform: binding.clientPlatform }));
    return session;
}

/** Compatibility accepts only the exact process-local native session and its admitted pair. */
/* @Codex */
export function isPairedNativeServerSession(
    session: unknown, binding: unknown,
): session is ServerSession {
    if (!isNativeBinding(binding) || !isExactStoredSession(session)) return false;
    const tagged = nativeSessionBindings.get(session);
    return Boolean(tagged && tagged.clientId === binding.clientId && tagged.clientPlatform === binding.clientPlatform);
}

function isNativeBinding(value: unknown): value is NativeServerSessionBinding {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || ObjectGetPrototypeOf(value) !== Object.prototype) return false;
        if (ObjectGetOwnPropertySymbols(value).length || ObjectGetOwnPropertyNames(value).length !== 2) return false;
        const clientId = ObjectGetOwnPropertyDescriptor(value, 'clientId'); const clientPlatform = ObjectGetOwnPropertyDescriptor(value, 'clientPlatform');
        return Boolean(clientId && clientPlatform && 'value' in clientId && 'value' in clientPlatform && clientId.enumerable && clientPlatform.enumerable
            && typeof clientId.value === 'string' && (clientPlatform.value === 'macos' || clientPlatform.value === 'ios' || clientPlatform.value === 'ipados'));
    } catch { return false; }
}

function isExactStoredSession(value: unknown): value is ServerSession {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || ObjectGetPrototypeOf(value) !== Object.prototype) return false;
        const id = ObjectGetOwnPropertyDescriptor(value, 'id');
        return Boolean(id && 'value' in id && typeof id.value === 'string' && getMapValue(sessions, id.value) === value);
    } catch { return false; }
}

function isStrictWebSessionUser(value: unknown): value is { id: string; username: string; role: string } {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || ObjectGetPrototypeOf(value) !== ObjectPrototype) return false;
        if (ObjectGetOwnPropertySymbols(value).length || ObjectGetOwnPropertyNames(value).length !== 3) return false;
        const id = ObjectGetOwnPropertyDescriptor(value, 'id');
        const username = ObjectGetOwnPropertyDescriptor(value, 'username');
        const role = ObjectGetOwnPropertyDescriptor(value, 'role');
        return Boolean(
            id && username && role
            && 'value' in id && 'value' in username && 'value' in role
            && id.enumerable && username.enumerable && role.enumerable
            && typeof id.value === 'string' && typeof username.value === 'string' && typeof role.value === 'string',
        );
    } catch { return false; }
}

function stagedWebSessionRecord(capsule: unknown): StagedWebSessionRecord | null {
    try {
        if (!capsule || typeof capsule !== 'object' || isProxy(capsule) || ObjectGetPrototypeOf(capsule) !== null) return null;
        if (ObjectGetOwnPropertySymbols(capsule).length || ObjectGetOwnPropertyNames(capsule).length) return null;
        return getWeakMapValue(stagedWebSessionRecords, capsule) ?? null;
    } catch { return null; }
}

function revokeStagedWebSession(record: StagedWebSessionRecord): boolean {
    if (!record.active) return false;
    record.active = false;
    deleteSetValue(stagedWebSessions, record);
    return true;
}

function revokeStagedWebSessionsForUser(userId: string): void {
    const iterator = applyIntrinsic(setValues, stagedWebSessions, []);
    for (let next = nextSetIterator<StagedWebSessionRecord>(iterator); !next.done;
        next = nextSetIterator<StagedWebSessionRecord>(iterator)) {
        if (next.value.userId === userId) revokeStagedWebSession(next.value);
    }
}

function revokeAllStagedWebSessions(): void {
    const iterator = applyIntrinsic(setValues, stagedWebSessions, []);
    for (let next = nextSetIterator<StagedWebSessionRecord>(iterator); !next.done;
        next = nextSetIterator<StagedWebSessionRecord>(iterator)) revokeStagedWebSession(next.value);
}

function preparedWebSessionRecord(capability: unknown): PreparedWebSessionRecord | null {
    try {
        if (!capability || typeof capability !== 'object' || isProxy(capability) || ObjectGetPrototypeOf(capability) !== null) return null;
        if (ObjectGetOwnPropertySymbols(capability).length || ObjectGetOwnPropertyNames(capability).length) return null;
        return getWeakMapValue(preparedWebSessionRecords, capability) ?? null;
    } catch { return null; }
}

function armedWebSessionCellRecord(port: unknown): ArmedWebSessionCellRecord | null {
    try {
        if (!port || typeof port !== 'object' || isProxy(port) || ObjectGetPrototypeOf(port) !== null) return null;
        if (ObjectGetOwnPropertySymbols(port).length || ObjectGetOwnPropertyNames(port).length) return null;
        return getWeakMapValue(armedWebSessionPortRecords, port) ?? null;
    } catch { return null; }
}

function isWebServerSessionRetirementReason(value: unknown): value is WebServerSessionRetirementReason {
    return value === 'lock' || value === 'dispose' || value === 'expired' || value === 'delete' || value === 'clear';
}

function tombstoneArmedWebSessionCellRecord(record: ArmedWebSessionCellRecord): boolean {
    if (record.state !== 'ARMED_ACTIVATE') return false;
    record.activationTicket = null;
    record.retirement = null;
    record.state = 'TOMBSTONE';
    return true;
}

function retireArmedWebSessionCellRecord(record: ArmedWebSessionCellRecord): boolean {
    if (record.state !== 'ACTIVE' && record.state !== 'ARMED_RETIRE') return false;
    record.state = 'RETIRED';
    return true;
}

function denyNestedWebSessionCellInput(value: unknown): void {
    const prepared = preparedWebSessionRecord(value);
    if (prepared) revokePreparedWebSession(prepared);
    const cell = armedWebSessionCellRecord(value);
    if (cell) tombstoneArmedWebSessionCellRecord(cell);
}

function beginWebSessionCellLifecycle(value: unknown): boolean {
    if (webSessionCellLifecycle === 'idle') {
        webSessionCellLifecycle = 'active';
        webSessionCellLifecyclePoisoned = false;
        return true;
    }
    webSessionCellLifecyclePoisoned = true;
    if (webSessionCellLifecycle === 'active') {
        webSessionCellLifecycle = 'cleanup';
        try { denyNestedWebSessionCellInput(value); } catch { /* denial remains terminal */ }
        finally { webSessionCellLifecycle = 'active'; }
    }
    return false;
}

function endWebSessionCellLifecycle(): void {
    webSessionCellLifecyclePoisoned = false;
    webSessionCellLifecycle = 'idle';
}

function poisonWebSessionCellLifecycle(): void {
    if (webSessionCellLifecycle !== 'idle') webSessionCellLifecyclePoisoned = true;
}

function tombstoneArmedWebSessionCellForId(sessionId: string): void {
    poisonWebSessionCellLifecycle();
    const record = armedWebSessionCellsById[sessionId];
    if (record) tombstoneArmedWebSessionCellRecord(record);
}

function tombstoneArmedWebSessionCellsForUser(userId: string): void {
    poisonWebSessionCellLifecycle();
    for (let record = armedWebSessionCellHead; record; record = record.next) {
        if (record.session.userId === userId) tombstoneArmedWebSessionCellRecord(record);
    }
}

function tombstoneAllArmedWebSessionCells(): void {
    poisonWebSessionCellLifecycle();
    for (let record = armedWebSessionCellHead; record; record = record.next) tombstoneArmedWebSessionCellRecord(record);
}

function revokePreparedWebSession(record: PreparedWebSessionRecord): boolean {
    const wasActive = record.active;
    record.active = false;
    try {
        if (getMapValue(preparedWebSessionReservations, record.session.id) === record) {
            deleteMapValue(preparedWebSessionReservations, record.session.id);
        }
        return wasActive;
    } catch { return false; }
}

function revokePreparedWebSessionsForUser(userId: string): void {
    const iterator = mapValuesOf(preparedWebSessionReservations);
    for (let next = nextMapIterator<PreparedWebSessionRecord>(iterator); !next.done;
        next = nextMapIterator<PreparedWebSessionRecord>(iterator)) {
        if (next.value.session.userId === userId) revokePreparedWebSession(next.value);
    }
}

function revokeAllPreparedWebSessions(): void {
    const iterator = mapValuesOf(preparedWebSessionReservations);
    for (let next = nextMapIterator<PreparedWebSessionRecord>(iterator); !next.done;
        next = nextMapIterator<PreparedWebSessionRecord>(iterator)) revokePreparedWebSession(next.value);
}

function revokePreparedWebSessionForId(sessionId: string): void {
    const record = getMapValue(preparedWebSessionReservations, sessionId);
    if (record) revokePreparedWebSession(record);
}

/** Stages only exact host-owned Web user data; the capsule has no observable session fields. */
/* @Codex */
export function stageWebServerSession(user: unknown): StagedWebServerSession | null {
    if (!isStrictWebSessionUser(user)) return null;
    try {
        const now = DateNow();
        const capsule = ObjectFreeze(ObjectCreate(null)) as StagedWebServerSession;
        const record: StagedWebSessionRecord = {
            active: true,
            userId: user.id,
            username: user.username,
            role: user.role,
            createdAt: now,
            expiresAt: now + SESSION_TTL_MS,
        };
        setWeakMapValue(stagedWebSessionRecords, capsule, record);
        addSetValue(stagedWebSessions, record);
        return capsule;
    } catch { return null; }
}

/** Consumes a staged Web capsule into one private, unpublishable Web-session reservation. */
/* @Codex */
export function prepareStagedWebServerSession(capsule: unknown): PreparedWebServerSession | null {
    if (webSessionPrepareInProgress) {
        webSessionPreparePoisoned = true;
        const nestedRecord = stagedWebSessionRecord(capsule);
        if (nestedRecord) revokeStagedWebSession(nestedRecord);
        return null;
    }
    webSessionPrepareInProgress = true;
    try {
    const record = stagedWebSessionRecord(capsule);
    if (!record || !record.active) return null;
    if (record.expiresAt <= DateNow()) {
        revokeStagedWebSession(record);
        return null;
    }

    let preparedRecord: PreparedWebSessionRecord | null = null;
    try {
        const bytes = applyIntrinsic(cryptoRandomBytes, crypto, [32]) as Buffer;
        const sessionId = applyIntrinsic(bufferToString, bytes, ['hex']) as string;
        if (webSessionPreparePoisoned || !record.active || record.expiresAt <= DateNow()) {
            revokeStagedWebSession(record);
            return null;
        }
        if (getMapValue(sessions, sessionId) || getMapValue(preparedWebSessionReservations, sessionId)
            || armedWebSessionCellsById[sessionId]) {
            revokeStagedWebSession(record);
            return null;
        }
        const capability = ObjectFreeze(ObjectCreate(null)) as PreparedWebServerSession;
        preparedRecord = {
            active: true,
            session: {
                id: sessionId,
                userId: record.userId,
                username: record.username,
                role: record.role,
                authChannel: 'web',
                createdAt: record.createdAt,
                expiresAt: record.expiresAt,
            },
        };
        setWeakMapValue(preparedWebSessionRecords, capability, preparedRecord);
        setMapValue(preparedWebSessionReservations, sessionId, preparedRecord);
        if (!revokeStagedWebSession(record)) {
            revokePreparedWebSession(preparedRecord);
            return null;
        }
        return capability;
    } catch {
        if (preparedRecord) revokePreparedWebSession(preparedRecord);
        revokeStagedWebSession(record);
        return null;
    }
    } finally {
        webSessionPrepareInProgress = false;
        webSessionPreparePoisoned = false;
    }
}

/** Returns only the reserved ID to the holder of the exact private capability. */
/* @Codex */
export function getPreparedWebServerSessionId(capability: unknown): string | null {
    const record = preparedWebSessionRecord(capability);
    if (!record || !record.active) return null;
    if (record.session.expiresAt <= DateNow() || getMapValue(preparedWebSessionReservations, record.session.id) !== record
        || getMapValue(sessions, record.session.id)) {
        revokePreparedWebSession(record);
        return null;
    }
    return record.session.id;
}

/** Burns one prepared capability into its final inert, non-resolvable session cell. */
/* @Codex */
export function armPreparedWebServerSession(capability: unknown): ArmedWebServerSessionPort | null {
    if (!beginWebSessionCellLifecycle(capability)) return null;
    let cell: ArmedWebSessionCellRecord | null = null;
    try {
        const prepared = preparedWebSessionRecord(capability);
        if (webSessionCellLifecyclePoisoned || !prepared || !prepared.active) return null;
        const session = prepared.session;
        if (session.expiresAt <= DateNow() || getMapValue(preparedWebSessionReservations, session.id) !== prepared
            || getMapValue(sessions, session.id) || armedWebSessionCellsById[session.id]) {
            revokePreparedWebSession(prepared);
            return null;
        }
        ObjectFreeze(session);
        const port = ObjectFreeze(ObjectCreate(null)) as ArmedWebServerSessionPort;
        cell = { state: 'ARMED_ACTIVATE', session, next: armedWebSessionCellHead, activationTicket: null, retirement: null };
        armedWebSessionCellHead = cell;
        armedWebSessionCellsById[session.id] = cell;
        setWeakMapValue(armedWebSessionPortRecords, port, cell);
        const burned = revokePreparedWebSession(prepared);
        if (webSessionCellLifecyclePoisoned || !burned) {
            tombstoneArmedWebSessionCellRecord(cell);
            return null;
        }
        return port;
    } catch {
        if (cell) tombstoneArmedWebSessionCellRecord(cell);
        const prepared = preparedWebSessionRecord(capability);
        if (prepared) revokePreparedWebSession(prepared);
        return null;
    } finally { endWebSessionCellLifecycle(); }
}

/** Returns only the exact private ID of an authentic armed cell; it grants no session authority. */
/* @Codex */
export function getArmedWebServerSessionId(port: unknown): string | null {
    if (!beginWebSessionCellLifecycle(port)) return null;
    try {
        const cell = armedWebSessionCellRecord(port);
        if (webSessionCellLifecyclePoisoned || !cell || cell.state !== 'ARMED_ACTIVATE'
            || armedWebSessionCellsById[cell.session.id] !== cell) return null;
        const session = cell.session;
        const sessionId = session.id;
        const now = DateNow();
        if (webSessionCellLifecyclePoisoned || cell.state !== 'ARMED_ACTIVATE' || cell.session !== session
            || session.id !== sessionId || armedWebSessionCellsById[sessionId] !== cell || session.expiresAt <= now) {
            tombstoneArmedWebSessionCellRecord(cell);
            return null;
        }
        return sessionId;
    } catch { return null; }
    finally { endWebSessionCellLifecycle(); }
}

/** Converts an authentic armed cell to its terminal, non-reactivatable tombstone. */
/* @Codex */
export function tombstoneArmedWebServerSession(port: unknown): boolean {
    if (!beginWebSessionCellLifecycle(port)) return false;
    try {
        const cell = armedWebSessionCellRecord(port);
        if (webSessionCellLifecyclePoisoned || !cell || armedWebSessionCellsById[cell.session.id] !== cell) return false;
        return tombstoneArmedWebSessionCellRecord(cell);
    } catch { return false; }
    finally { endWebSessionCellLifecycle(); }
}

/** Atomically splices one exact P2 CAS into its already-installed inert P3 cell. */
/* @Codex */
export function activateArmedWebServerSession(port: unknown, ticket: unknown): boolean {
    const sessionId = getArmedWebServerSessionId(port);
    const preparedActivation = prepareAuthControlActivation(ticket, sessionId);
    if (!sessionId || !preparedActivation) {
        tombstoneArmedWebServerSession(port);
        return false;
    }
    if (!beginWebSessionCellLifecycle(port)) {
        const deniedCell = armedWebSessionCellRecord(port);
        if (deniedCell) tombstoneArmedWebSessionCellRecord(deniedCell);
        abortPreparedAuthControlActivation(preparedActivation);
        return false;
    }
    let cell: ArmedWebSessionCellRecord | null = null;
    try {
        cell = armedWebSessionCellRecord(port);
        const session = cell?.session ?? null;
        const visibleSession = getMapValue(sessions, sessionId);
        const now = DateNow();
        if (webSessionCellLifecyclePoisoned || !cell || cell.state !== 'ARMED_ACTIVATE'
            || armedWebSessionCellsById[sessionId] !== cell || !session || cell.session !== session
            || session.id !== sessionId || session.authChannel !== 'web' || session.expiresAt <= now || visibleSession) {
            if (cell) cell.state = 'TOMBSTONE';
            abortPreparedAuthControlActivation(preparedActivation);
            webSessionCellLifecyclePoisoned = false;
            webSessionCellLifecycle = 'idle';
            return false;
        }
        cell.activationTicket = ticket;
    } catch {
        if (cell) tombstoneArmedWebSessionCellRecord(cell);
        try { abortPreparedAuthControlActivation(preparedActivation); } catch { /* prepared P2 denial stays terminal */ }
        webSessionCellLifecyclePoisoned = false;
        webSessionCellLifecycle = 'idle';
        return false;
    }
    if (commitPreparedAuthControlActivation(preparedActivation) === 1) {
        cell.state = 'ACTIVE';
        webSessionCellLifecyclePoisoned = false;
        webSessionCellLifecycle = 'idle';
        return true;
    }
    cell.activationTicket = null;
    cell.retirement = null;
    cell.state = 'TOMBSTONE';
    webSessionCellLifecyclePoisoned = false;
    webSessionCellLifecycle = 'idle';
    return false;
}

/** Retires one exact ACTIVE Web cell through its privately retained P2 ticket. */
/* @Codex */
export function retireActiveWebServerSession(sessionId: unknown, reason: unknown): boolean {
    if (typeof sessionId !== 'string' || !sessionId || !isWebServerSessionRetirementReason(reason)) return false;
    const cell = armedWebSessionCellsById[sessionId];
    if (!cell || cell.state !== 'ACTIVE' || cell.session.id !== sessionId || !cell.activationTicket) return false;
    const session = cell.session;
    const ticket = cell.activationTicket;
    const preparedRetirement = prepareAuthControlRetirement(ticket, sessionId, reason);
    if (!preparedRetirement) {
        if (cell.state === 'ACTIVE' && armedWebSessionCellsById[sessionId] === cell && cell.session === session) {
            retireArmedWebSessionCellRecord(cell);
        }
        return false;
    }
    if (!beginWebSessionCellLifecycle(sessionId)) {
        if (cell.state === 'ACTIVE' && armedWebSessionCellsById[sessionId] === cell && cell.session === session) {
            retireArmedWebSessionCellRecord(cell);
        }
        abortPreparedAuthControlRetirement(preparedRetirement);
        return false;
    }
    try {
        const exact = armedWebSessionCellsById[sessionId] === cell && cell.state === 'ACTIVE'
            && cell.session === session && cell.activationTicket === ticket && session.id === sessionId
            && session.authChannel === 'web' && session.expiresAt > DateNow();
        if (webSessionCellLifecyclePoisoned || !exact) {
            retireArmedWebSessionCellRecord(cell);
            abortPreparedAuthControlRetirement(preparedRetirement);
            webSessionCellLifecyclePoisoned = false;
            webSessionCellLifecycle = 'idle';
            return false;
        }
        cell.retirement = preparedRetirement;
        cell.state = 'ARMED_RETIRE';
        if (webSessionCellLifecyclePoisoned || armedWebSessionCellsById[sessionId] !== cell
            || cell.state !== 'ARMED_RETIRE' || cell.session !== session || cell.activationTicket !== ticket) {
            cell.state = 'RETIRED';
            abortPreparedAuthControlRetirement(preparedRetirement);
            cell.retirement = null;
            webSessionCellLifecyclePoisoned = false;
            webSessionCellLifecycle = 'idle';
            return false;
        }
    } catch {
        if (cell.state === 'ACTIVE' || cell.state === 'ARMED_RETIRE') cell.state = 'RETIRED';
        try { abortPreparedAuthControlRetirement(preparedRetirement); } catch { /* terminal denial remains */ }
        cell.retirement = null;
        webSessionCellLifecyclePoisoned = false;
        webSessionCellLifecycle = 'idle';
        return false;
    }
    const retirementResult = commitPreparedAuthControlRetirement(preparedRetirement);
    if (retirementResult === 2) {
        cell.state = 'RETIRED';
        webSessionCellLifecyclePoisoned = false;
        webSessionCellLifecycle = 'idle';
        return true;
    }
    cell.state = 'RETIRED';
    webSessionCellLifecyclePoisoned = false;
    webSessionCellLifecycle = 'idle';
    return false;
}

/** Canonically publishes a prepared session only for server-local compatibility callers. */
function commitPreparedWebServerSessionInternally(capability: unknown, returnSession: true): ServerSession | null;
function commitPreparedWebServerSessionInternally(capability: unknown, returnSession: false): boolean;
function commitPreparedWebServerSessionInternally(capability: unknown, returnSession: boolean): ServerSession | boolean | null {
    const deniedResult = returnSession ? null : false;
    const record = preparedWebSessionRecord(capability);
    if (!record || !record.active) return deniedResult;
    try {
        const session = record.session;
        if (record.session.expiresAt <= DateNow() || getMapValue(preparedWebSessionReservations, record.session.id) !== record
            || getMapValue(sessions, record.session.id)) {
            revokePreparedWebSession(record);
            return deniedResult;
        }
        const terminalResult = returnSession ? session : true;
        record.active = false;
        deleteMapValue(preparedWebSessionReservations, record.session.id);
        setMapValue(sessions, session.id, session);
        return terminalResult;
    } catch {
        revokePreparedWebSession(record);
        return deniedResult;
    }
}

/** Commits a prepared Web session once without exposing session authority. */
/* @Codex */
export function commitPreparedWebServerSession(capability: unknown): boolean {
    return commitPreparedWebServerSessionInternally(capability, false);
}

/** Aborts a private prepared Web-session reservation without publication. */
/* @Codex */
export function abortPreparedWebServerSession(capability: unknown): boolean {
    const record = preparedWebSessionRecord(capability);
    return Boolean(record && revokePreparedWebSession(record));
}

/** Compatibility wrapper for callers that do not need an external terminal turn. */
/* @Codex */
export function activateStagedWebServerSession(capsule: unknown): ServerSession | null {
    const capability = prepareStagedWebServerSession(capsule);
    return capability ? commitPreparedWebServerSessionInternally(capability, true) : null;
}

/** Aborts a pending Web session without ever publishing it. */
/* @Codex */
export function abortStagedWebServerSession(capsule: unknown): boolean {
    const record = stagedWebSessionRecord(capsule);
    return Boolean(record && revokeStagedWebSession(record));
}

/** Resolves only one exact ACTIVE P3 Web cell without publishing it to the legacy session map. */
/* @Codex */
export function resolveActiveWebServerSession(sessionId: unknown): ServerSession | null {
    if (!beginWebSessionCellLifecycle(sessionId)) return null;
    try {
        if (typeof sessionId !== 'string' || !sessionId) return null;
        const cell = armedWebSessionCellsById[sessionId];
        const visibleSession = getMapValue(sessions, sessionId);
        if (webSessionCellLifecyclePoisoned || visibleSession || !cell || cell.state !== 'ACTIVE') return null;
        const session = cell.session;
        const expiry = session.expiresAt;
        const now = DateNow();
        if (webSessionCellLifecyclePoisoned || armedWebSessionCellsById[sessionId] !== cell
            || cell.state !== 'ACTIVE' || cell.session !== session || session.id !== sessionId
            || session.authChannel !== 'web' || session.expiresAt !== expiry || expiry <= now
            || getMapValue(sessions, sessionId)) return null;
        return session;
    } catch { return null; }
    finally { endWebSessionCellLifecycle(); }
}

export function getSession(sessionId: string | null | undefined): ServerSession | null {
    if (!sessionId) return null;
    const session = getMapValue(sessions, sessionId);
    if (!session) return null;

    const now = DateNow();
    if (session.expiresAt <= now) {
        terminateSession(sessionId, 'session_expired');
        return null;
    }

    // Sliding expiration on access
    session.expiresAt = now + SESSION_TTL_MS;
    setMapValue(sessions, sessionId, session);
    return session;
}

/* @Codex */
export function peekSession(sessionId: string | null | undefined): ServerSession | null {
    if (!sessionId) return null;
    const session = getMapValue(sessions, sessionId);
    if (!session) return null;
    if (session.expiresAt <= DateNow()) {
        terminateSession(sessionId, 'session_expired');
        return null;
    }
    return session;
}

export function deleteSession(sessionId: string | null | undefined): void {
    if (!sessionId) return;
    tombstoneArmedWebSessionCellForId(sessionId);
    revokePreparedWebSessionForId(sessionId);
    terminateSession(sessionId, 'session_deleted');
}

/* @Codex: WUL-522 application lock keeps deletion and cleanup in one server-only primitive. */
export function invalidateServerSessionForApplicationLock(sessionId: string): Readonly<{
    sessionBeforeDeletion: ServerSession | null;
    cleanupOutcome: ServerSessionCleanupOutcome;
    authorityAbsent: boolean;
}> {
    tombstoneArmedWebSessionCellForId(sessionId);
    revokePreparedWebSessionForId(sessionId);
    return terminateSession(sessionId, 'application_locked');
}

/* @Codex */
export function invalidateSessionsForUser(userId: string): void {
    if (!userId) return;

    tombstoneArmedWebSessionCellsForUser(userId);
    revokeStagedWebSessionsForUser(userId);
    revokePreparedWebSessionsForUser(userId);

    const sessionIds: string[] = [];
    const iterator = mapValuesOf(sessions);
    for (let next = nextMapIterator<ServerSession>(iterator); !next.done; next = nextMapIterator<ServerSession>(iterator)) {
        if (next.value.userId === userId) appendArrayValue(sessionIds, next.value.id);
    }

    for (let index = 0; index < sessionIds.length; index += 1) {
        deleteSession(sessionIds[index]);
    }
}

/* @Codex */
export function clearAllSessions(): void {
    tombstoneAllArmedWebSessionCells();
    revokeAllStagedWebSessions();
    revokeAllPreparedWebSessions();
    const sessionIds: string[] = [];
    const sessionSnapshots = new MapConstructor<string, ServerSession>();
    const sessionIterator = mapKeysOf(sessions);
    for (let next = nextMapIterator<string>(sessionIterator); !next.done; next = nextMapIterator<string>(sessionIterator)) {
        appendArrayValue(sessionIds, next.value);
        const session = getMapValue(sessions, next.value);
        if (session) setMapValue(sessionSnapshots, next.value, session);
    }
    const resourceIterator = mapKeysOf(sessionResources);
    for (let next = nextMapIterator<string>(resourceIterator); !next.done; next = nextMapIterator<string>(resourceIterator)) {
        const sessionId = next.value;
        let known = false;
        for (let index = 0; index < sessionIds.length; index += 1) {
            if (sessionIds[index] === sessionId) { known = true; break; }
        }
        if (!known) appendArrayValue(sessionIds, sessionId);
    }
    clearMap(sessions);
    for (let index = 0; index < sessionIds.length; index += 1) {
        completeSessionTermination(sessionIds[index], getMapValue(sessionSnapshots, sessionIds[index]) ?? null, 'sessions_cleared');
    }
}
