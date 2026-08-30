/* @Codex */
import 'server-only';

import { types } from 'node:util';

import type {
    PatientInsightLeaseCommitPort,
    PatientInsightLeaseCommitRef,
} from '../../security/server-session-projection-owner';
import type { PatientInsightBroker } from './patient-insight-broker';

export type PatientInsightAtomicLeaseErrorCode =
    | 'disposed' | 'input_invalid' | 'operation_reentered' | 'record_spent' | 'stale_selection';

export class PatientInsightAtomicLeaseError extends Error {
    constructor(readonly code: PatientInsightAtomicLeaseErrorCode) {
        super(`Patient Insight atomic lease rejected: ${code}`);
        this.name = 'PatientInsightAtomicLeaseError';
    }
}

export type PatientInsightAtomicLease = Readonly<{
    commit(): string;
    dispose(): void;
}>;

const isProxy = types.isProxy;
const isAsyncFunction = types.isAsyncFunction;
const ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const isFrozen = Object.isFrozen;
const freeze = Object.freeze;

function fail(code: PatientInsightAtomicLeaseErrorCode): never {
    throw new PatientInsightAtomicLeaseError(code);
}

function exactMethods(value: unknown, keys: readonly string[]): boolean {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || getPrototypeOf(value) !== Object.prototype || !isFrozen(value)) return false;
        const actual = ownKeys(value);
        if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) return false;
        for (const key of keys) {
            const descriptor = getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'function'
                || isProxy(descriptor.value) || isAsyncFunction(descriptor.value)) return false;
        }
        return true;
    } catch { return false; }
}

function binding(input: unknown): Readonly<{ port: PatientInsightLeaseCommitPort; broker: PatientInsightBroker }> | null {
    try {
        if (!input || typeof input !== 'object' || isProxy(input) || getPrototypeOf(input) !== Object.prototype || !isFrozen(input)) return null;
        const keys = ownKeys(input);
        if (keys.length !== 2 || !keys.includes('port') || !keys.includes('broker')) return null;
        const port = getOwnPropertyDescriptor(input, 'port');
        const broker = getOwnPropertyDescriptor(input, 'broker');
        if (!port?.enumerable || !broker?.enumerable || !('value' in port) || !('value' in broker)
            || !exactMethods(port.value, ['snapshot', 'prepare', 'commit', 'abort', 'dispose'])
            || !exactMethods(broker.value, ['stage', 'publish', 'abort', 'issue', 'consume'])) return null;
        return freeze({ port: port.value as PatientInsightLeaseCommitPort, broker: broker.value as PatientInsightBroker });
    } catch { return null; }
}

function snapshot(value: unknown): Readonly<{
    currentRef: PatientInsightLeaseCommitRef;
    stagedRef: PatientInsightLeaseCommitRef | null;
    generation: number;
    terminal: boolean;
}> | null {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || getPrototypeOf(value) !== Object.prototype || !isFrozen(value)) return null;
        const keys = ownKeys(value);
        if (keys.length !== 4 || !keys.includes('currentRef') || !keys.includes('stagedRef')
            || !keys.includes('generation') || !keys.includes('terminal')) return null;
        const currentRef = getOwnPropertyDescriptor(value, 'currentRef');
        const stagedRef = getOwnPropertyDescriptor(value, 'stagedRef');
        const generation = getOwnPropertyDescriptor(value, 'generation');
        const terminal = getOwnPropertyDescriptor(value, 'terminal');
        if (![currentRef, stagedRef, generation, terminal].every((item) => item?.enumerable && 'value' in item!)) return null;
        if (!currentRef || !stagedRef || !generation || !terminal || typeof currentRef.value !== 'object' || currentRef.value === null
            || (stagedRef.value !== null && (typeof stagedRef.value !== 'object' || stagedRef.value === null))
            || !Number.isSafeInteger(generation.value) || generation.value < 0 || typeof terminal.value !== 'boolean') return null;
        return value as never;
    } catch { return null; }
}

function reservation(value: unknown): value is object {
    try {
        return !!value && typeof value === 'object' && !isProxy(value) && getPrototypeOf(value) === null
            && isFrozen(value) && ownKeys(value).length === 0;
    } catch { return false; }
}

export function createPatientInsightAtomicLease(input: unknown): PatientInsightAtomicLease {
    const value = binding(input); if (!value) fail('input_invalid');
    const { port, broker } = value;
    let active = false;
    let poisoned = false;
    let terminal = false;
    let disposed = false;

    const close = (staged: object | null, replacement: PatientInsightLeaseCommitRef | null, published: string | null): void => {
        if (published) { try { broker.consume(freeze({ handle: published })); } catch { /* no live authority */ } }
        else if (staged) { try { broker.abort(staged); } catch { /* already absent */ } }
        if (replacement) {
            try { if (!port.abort(freeze({ replacement }))) port.dispose(); } catch { port.dispose(); }
        } else port.dispose();
        active = false;
        poisoned = false;
    };

    return freeze({
        commit() {
            if (active) { poisoned = true; return fail('operation_reentered'); }
            if (disposed) fail('disposed');
            if (terminal) fail('record_spent');
            active = true;
            terminal = true;
            let staged: object | null = null;
            let replacement: PatientInsightLeaseCommitRef | null = null;
            let published: string | null = null;
            try {
                const before = snapshot(port.snapshot());
                if (!before || before.terminal || before.stagedRef !== null) fail('stale_selection');
                const candidate = broker.stage();
                if (!reservation(candidate)) fail('input_invalid');
                staged = candidate;
                if (poisoned) fail('operation_reentered');
                replacement = port.prepare(freeze({ expected: before.currentRef }));
                if (!replacement || poisoned) fail(poisoned ? 'operation_reentered' : 'stale_selection');
                const prepared = snapshot(port.snapshot());
                if (!prepared || prepared.currentRef !== before.currentRef || prepared.stagedRef !== replacement
                    || prepared.generation !== before.generation || prepared.terminal || poisoned) fail('stale_selection');
                const handle = broker.publish(staged);
                staged = null;
                if (typeof handle !== 'string' || !/^pib_[0-9a-f]{32}$/u.test(handle) || poisoned) {
                    fail(poisoned ? 'operation_reentered' : 'input_invalid');
                }
                published = handle;
                const final = snapshot(port.snapshot());
                if (!final || final.currentRef !== before.currentRef || final.stagedRef !== replacement
                    || final.generation !== before.generation || final.terminal || poisoned) fail('stale_selection');
                active = false;
                poisoned = false;
                if (!port.commit(freeze({ expected: before.currentRef, replacement }))) fail('stale_selection');
                return handle;
            } catch (error) {
                close(staged, replacement, published);
                throw error;
            }
        },
        dispose() {
            if (active) { poisoned = true; return; }
            if (disposed) return;
            disposed = true;
            terminal = true;
            port.dispose();
        },
    });
}
