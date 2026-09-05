/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataDir } from '../../data-dir';
import {
    ProviderLifecycleError,
    snapshotProviderLifecycle,
    transitionProviderLifecycle,
    type ProviderLifecycleEvent,
    type ProviderLifecycleState,
} from './provider-lifecycle';
export const PROVIDER_LIFECYCLE_STORE_SCHEMA_VERSION = 'mediflow.ai.provider-lifecycle-record.v1' as const;
export type ProviderLifecycleActorClass = 'physician' | 'host_service';
export type ProviderLifecycleRecord = Readonly<{
    schemaVersion: typeof PROVIDER_LIFECYCLE_STORE_SCHEMA_VERSION;
    lifecycle: ProviderLifecycleState;
    actorClass: ProviderLifecycleActorClass; actorRef: string;
    version: number; hostTimestamp: string; receiptRef: string;
}>;
type CommonCommand = Readonly<{
    expectedVersion: number; actorClass: ProviderLifecycleActorClass;
    actorRef: string;
    receiptRef: string;
}>;
export type ProviderLifecycleStoreCommand =
    | (CommonCommand & Readonly<{ kind: 'admit'; lifecycle: ProviderLifecycleState }>)
    | (CommonCommand & Readonly<{ kind: 'transition'; event: ProviderLifecycleEvent }>);
export type ProviderLifecycleStoreErrorCode =
    | 'missing' | 'unreadable' | 'corrupt' | 'busy' | 'command_invalid' | 'version_conflict'
    | 'transition_invalid' | 'clock_invalid';
export class ProviderLifecycleStoreError extends Error {
    constructor(public readonly code: ProviderLifecycleStoreErrorCode) {
        super(`Provider lifecycle store rejected: ${code}`);
        this.name = 'ProviderLifecycleStoreError';
    }
}
const ACTOR_CLASSES = new Set<unknown>(['physician', 'host_service']);
const ACTOR_REF = /^actor_[0-9a-f]{32,64}$/;
const RECEIPT_REF = /^receipt_[0-9a-f]{32,64}$/;
const PROVIDER_REF = /^[a-z][a-z0-9_-]{0,63}$/;
function hasExactKeys(value: object, expected: readonly string[]): boolean {
    const keys = Reflect.ownKeys(value);
    return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
function freezeRecord(value: Omit<ProviderLifecycleRecord, 'schemaVersion'>): ProviderLifecycleRecord {
    return Object.freeze({ schemaVersion: PROVIDER_LIFECYCLE_STORE_SCHEMA_VERSION, ...value });
}
function snapshotRecord(value: unknown, provider: string): ProviderLifecycleRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !hasExactKeys(value, [
        'schemaVersion', 'lifecycle', 'actorClass', 'actorRef', 'version', 'hostTimestamp', 'receiptRef',
    ])) throw new ProviderLifecycleStoreError('corrupt');
    const input = value as Record<string, unknown>;
    const schemaVersion = input.schemaVersion;
    const lifecycle = input.lifecycle;
    const actorClass = input.actorClass;
    const actorRef = input.actorRef;
    const version = input.version;
    const hostTimestamp = input.hostTimestamp;
    const receiptRef = input.receiptRef;
    if (
        schemaVersion !== PROVIDER_LIFECYCLE_STORE_SCHEMA_VERSION
        || (lifecycle as { provider?: unknown } | null)?.provider !== provider
        || !ACTOR_CLASSES.has(actorClass) || typeof actorRef !== 'string' || !ACTOR_REF.test(actorRef)
        || !Number.isSafeInteger(version) || (version as number) < 1
        || typeof hostTimestamp !== 'string' || new Date(hostTimestamp).toISOString() !== hostTimestamp
        || typeof receiptRef !== 'string' || !RECEIPT_REF.test(receiptRef)
    ) throw new ProviderLifecycleStoreError('corrupt');
    try {
        return freezeRecord({
            lifecycle: snapshotProviderLifecycle(lifecycle),
            actorClass: actorClass as ProviderLifecycleActorClass,
            actorRef, version: version as number, hostTimestamp, receiptRef,
        });
    } catch {
        throw new ProviderLifecycleStoreError('corrupt');
    }
}
function snapshotCommand(value: unknown, provider: string): ProviderLifecycleStoreCommand {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ProviderLifecycleStoreError('command_invalid');
    }
    const input = value as Record<string, unknown>;
    const kind = input.kind;
    const expected = kind === 'admit'
        ? ['kind', 'expectedVersion', 'lifecycle', 'actorClass', 'actorRef', 'receiptRef']
        : ['kind', 'expectedVersion', 'event', 'actorClass', 'actorRef', 'receiptRef'];
    const expectedVersion = input.expectedVersion;
    const actorClass = input.actorClass;
    const actorRef = input.actorRef;
    const receiptRef = input.receiptRef;
    if (
        (kind !== 'admit' && kind !== 'transition') || !hasExactKeys(value, expected)
        || !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0
        || !ACTOR_CLASSES.has(actorClass) || typeof actorRef !== 'string' || !ACTOR_REF.test(actorRef)
        || typeof receiptRef !== 'string' || !RECEIPT_REF.test(receiptRef)
    ) throw new ProviderLifecycleStoreError('command_invalid');
    if (kind === 'admit') {
        try {
            const lifecycle = snapshotProviderLifecycle(input.lifecycle);
            if (lifecycle.status !== 'available_unqualified' || lifecycle.provider !== provider) throw new Error();
            return Object.freeze({ kind, expectedVersion: expectedVersion as number, lifecycle,
                actorClass: actorClass as ProviderLifecycleActorClass, actorRef, receiptRef });
        } catch { throw new ProviderLifecycleStoreError('command_invalid'); }
    }
    const event = input.event;
    if (event !== 'degrade' && event !== 'recover' && event !== 'revoke') {
        throw new ProviderLifecycleStoreError('command_invalid');
    }
    return Object.freeze({ kind, expectedVersion: expectedVersion as number, event,
        actorClass: actorClass as ProviderLifecycleActorClass, actorRef, receiptRef });
}
function providerRef(value: unknown): string {
    if (typeof value !== 'string' || !PROVIDER_REF.test(value)) throw new ProviderLifecycleStoreError('command_invalid');
    return value;
}

export function getProviderLifecycleStorePaths(appDataDir = getDataDir(), provider = 'ollama') {
    const canonicalProvider = providerRef(provider);
    const directory = path.join(appDataDir, 'ai', 'fabric');
    const basename = canonicalProvider === 'ollama'
        ? 'provider-lifecycle.v1'
        : `provider-lifecycle.${canonicalProvider}.v1`;
    return {
        directory,
        recordPath: path.join(directory, `${basename}.json`),
        lockPath: path.join(directory, `${basename}.lock`),
    } as const;
}
export function createProviderLifecycleStore(appDataDir = getDataDir(), hostClock: () => Date = () => new Date(), provider = 'ollama') {
    const canonicalProvider = providerRef(provider);
    const paths = getProviderLifecycleStorePaths(appDataDir, canonicalProvider);
    function readNullable(): ProviderLifecycleRecord | null {
        let raw: string;
        try { raw = fs.readFileSync(paths.recordPath, 'utf8'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw new ProviderLifecycleStoreError('unreadable');
        }
        try { return snapshotRecord(JSON.parse(raw), canonicalProvider); }
        catch { throw new ProviderLifecycleStoreError('corrupt'); }
    }
    function load(): ProviderLifecycleRecord {
        const record = readNullable();
        if (!record) throw new ProviderLifecycleStoreError('missing');
        return record;
    }
    function save(value: unknown): ProviderLifecycleRecord {
        const command = snapshotCommand(value, canonicalProvider);
        fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') fs.chmodSync(paths.directory, 0o700);
        let lock: number;
        try { lock = fs.openSync(paths.lockPath, 'wx', 0o600); }
        catch { throw new ProviderLifecycleStoreError('busy'); }
        let temporaryPath: string | null = null;
        try {
            const current = readNullable();
            if ((current?.version ?? 0) !== command.expectedVersion) {
                throw new ProviderLifecycleStoreError('version_conflict');
            }
            if (Boolean(current) === (command.kind === 'admit')) {
                throw new ProviderLifecycleStoreError('transition_invalid');
            }
            let lifecycle: ProviderLifecycleState;
            try {
                lifecycle = command.kind === 'admit'
                    ? command.lifecycle
                    : transitionProviderLifecycle(current!.lifecycle, command.event);
            } catch (error) {
                if (error instanceof ProviderLifecycleError) {
                    throw new ProviderLifecycleStoreError('transition_invalid');
                }
                throw error;
            }
            let timestamp: string;
            try { timestamp = hostClock().toISOString(); }
            catch { throw new ProviderLifecycleStoreError('clock_invalid'); }
            if (current && timestamp < current.hostTimestamp) {
                throw new ProviderLifecycleStoreError('clock_invalid');
            }
            const record = freezeRecord({ lifecycle, actorClass: command.actorClass,
                actorRef: command.actorRef, version: (current?.version ?? 0) + 1,
                hostTimestamp: timestamp, receiptRef: command.receiptRef });
            temporaryPath = `${paths.recordPath}.${process.pid}.${randomUUID()}.tmp`;
            const file = fs.openSync(temporaryPath, 'wx', 0o600);
            try { fs.writeFileSync(file, `${JSON.stringify(record)}\n`, 'utf8'); fs.fsyncSync(file); }
            finally { fs.closeSync(file); }
            fs.renameSync(temporaryPath, paths.recordPath);
            temporaryPath = null;
            if (process.platform !== 'win32') {
                fs.chmodSync(paths.recordPath, 0o600);
                const directory = fs.openSync(paths.directory, 'r');
                try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
            }
            return snapshotRecord(record, canonicalProvider);
        } finally {
            if (temporaryPath) fs.rmSync(temporaryPath, { force: true });
            fs.closeSync(lock!);
            fs.rmSync(paths.lockPath, { force: true });
        }
    }
    return Object.freeze({ load, save });
}
