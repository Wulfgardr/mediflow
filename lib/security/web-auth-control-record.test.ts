/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
    abortPreparedAuthControlTicket,
    abortPreparedAuthControlActivation,
    abortPreparedAuthControlRetirement,
    commitAuthControlTicket,
    commitPreparedAuthControlActivation,
    commitPreparedAuthControlRetirement,
    createWebAuthControlRecord,
    isCurrentAuthControlSessionBinding,
    prepareAuthControlActivation,
    prepareAuthControlRetirement,
    retireAuthControlTicket,
} from './web-auth-control-record.ts';
import {
    inventoryModuleImports,
    moduleImportBypassFixtures,
    repositoryTypeScriptSources,
} from './module-import-inventory.test-support.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const validateControlImports = (sources: Readonly<Record<string, string>>) => {
    const allowedUnresolved = new Set([
        'lib/ai-providers/fabric/document-synthesis-provider-binding.test.ts', 'lib/ai-providers/fabric/document-synthesis-provider-envelope.test.ts',
        'lib/ai-providers/fabric/document-synthesis-source-set-currentness-owner.test.ts', 'lib/pm2-manager.test.ts',
        'lib/security/web-auth-control-owner.test.ts', 'lib/security/web-auth-control-record.test.ts', 'lib/security/web-auth-session-issuer.test.ts',
        'scripts/benchmark-clinical-entities.ts', 'scripts/benchmark-redaction.ts',
    ]);
    const uses = Object.entries(sources).flatMap(([file, source]) => inventoryModuleImports({
        file, source, target: 'lib/security/web-auth-control-record', repositoryRoot: ROOT, allowUnresolvedFiles: allowedUnresolved,
    })); const errors: string[] = [];
    const production = new Map([
        ['lib/security/server-session.ts', { runtime: new Set(['abortPreparedAuthControlActivation', 'abortPreparedAuthControlRetirement', 'commitPreparedAuthControlActivation', 'commitPreparedAuthControlRetirement', 'prepareAuthControlActivation', 'prepareAuthControlRetirement']), types: new Set<string>() }],
        ['lib/security/web-auth-control-owner.ts', { runtime: new Set(['abortPreparedAuthControlTicket', 'createWebAuthControlRecord']), types: new Set(['AuthControlTicket']) }],
    ]);
    const ownTest = new Set(['abortPreparedAuthControlTicket', 'abortPreparedAuthControlActivation', 'abortPreparedAuthControlRetirement', 'commitAuthControlTicket', 'commitPreparedAuthControlActivation', 'commitPreparedAuthControlRetirement', 'createWebAuthControlRecord', 'isCurrentAuthControlSessionBinding', 'prepareAuthControlActivation', 'prepareAuthControlRetirement', 'retireAuthControlTicket']);
    for (const use of uses) {
        if (use.file === 'lib/security/web-auth-control-record.test.ts') {
            if (!((use.form === 'named' && !use.typeOnly && ownTest.has(use.symbol)) || (use.form === 'import-type' && use.typeOnly))) errors.push(`${use.file}:${use.form}:${use.symbol}`);
            continue;
        }
        if (use.file === 'lib/security/web-auth-logout-server.test.ts') {
            if (use.form !== 'named' || use.typeOnly || use.symbol !== 'createWebAuthControlRecord') errors.push(`${use.file}:${use.form}:${use.symbol}`);
            continue;
        }
        const allowed = production.get(use.file); const symbols = use.typeOnly ? allowed?.types : allowed?.runtime;
        if (!allowed || use.form !== 'named' || !symbols?.has(use.symbol)) errors.push(`${use.file}:${use.form}:${use.symbol}`);
    }
    const logout = uses.filter((use) => use.file === 'lib/security/web-auth-logout-server.test.ts' && !use.typeOnly);
    if ('lib/security/web-auth-logout-server.test.ts' in sources
        && (logout.length !== 1 || logout[0]?.form !== 'named' || logout[0]?.symbol !== 'createWebAuthControlRecord')) errors.push('logout-test:fixture');
    return { errors, uses };
};
let repositorySourceCache: Record<string, string> | undefined;
const repositoryTypeScript = () => repositorySourceCache ??= repositoryTypeScriptSources(ROOT);

const MAX = BigInt('18446744073709551615');
function control(fence = 'f0', generation = BigInt(0)) {
    let next = 0;
    const issued = () => `f${++next}`;
    return { record: createWebAuthControlRecord(fence, generation), issued };
}
async function freshModule(label: string) {
    const directory = mkdtempSync(join(tmpdir(), `mediflow-${label}-`)); const target = join(directory, 'web-auth-control-record.ts');
    writeFileSync(target, readFileSync(fileURLToPath(new URL('./web-auth-control-record.ts', import.meta.url))));
    try { return await import(pathToFileURL(target).href); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('holds one pending, commits an exact auth CAS, and permits only one active Web binding', () => {
    const { record } = control();
    assert.equal(record.begin('login', 'op-1', 'key-1', 'fp-1', 0).ok, true);
    assert.equal(record.begin('setup', 'op-2', 'key-2', 'fp-2', 1).ok, false);
    const pending = record.snapshot();
    const auth = record.finalizeAuth('f0', 'op-1', pending.generation, 'fp-1', 'web-1', 'f1', 2);
    assert.deepEqual(auth, { ok: true, fence: 'f1', generation: BigInt(1) });
    assert.equal(record.begin('login', 'op-2', 'key-2', 'fp-2', 3).ok, false);
    assert.equal(record.finalizeAuth('f0', 'op-1', BigInt(0), 'fp-1', 'web-2', 'f2', 3).ok, false);
    assert.deepEqual(record.disposeBoundSession('f1', 'web-1', 'f2', 4), { ok: true, fence: 'f2', generation: BigInt(2) });
});

test('begin rolls back captured Map reentry and apply-then-throw without consuming capacity', async (t) => {
    const originalGet = Map.prototype.get; const originalSet = Map.prototype.set;
    let isolated: Awaited<ReturnType<typeof freshModule>>; let activeRecord: ReturnType<typeof createWebAuthControlRecord> | null = null;
    let armedGet = false; let armedSet = false; let throwGet = false; let throwSet = false; let nested = true;
    Map.prototype.get = function (...args: Parameters<typeof originalGet>) {
        const result = Reflect.apply(originalGet, this, args) as unknown;
        if (armedGet) { armedGet = false; if (throwGet) throw new Error('get after apply'); nested = activeRecord!.begin('login', 'nested', 'nested-key', 'nested-fp', 1).ok; }
        return result;
    };
    Map.prototype.set = function (...args: Parameters<typeof originalSet>) {
        const result = Reflect.apply(originalSet, this, args) as Map<unknown, unknown>;
        if (armedSet) { armedSet = false; if (throwSet) throw new Error('set after apply'); nested = activeRecord!.begin('login', 'nested', 'nested-key', 'nested-fp', 1).ok; }
        return result;
    };
    try { isolated = await freshModule('begin-rollback'); } finally { Map.prototype.get = originalGet; Map.prototype.set = originalSet; }
    const record = isolated.createWebAuthControlRecord('f0'); activeRecord = record;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));

    armedGet = true; assert.equal(record.begin('login', 'outer', 'get-reentry', 'fp', 0).ok, false); assert.equal(nested, false); assert.equal(record.snapshot().pending, false);
    armedGet = true; throwGet = true; assert.equal(record.begin('login', 'outer', 'get-throw', 'fp', 2).ok, false); assert.equal(record.snapshot().pending, false); throwGet = false;
    armedSet = true; assert.equal(record.begin('login', 'outer', 'set-reentry', 'fp', 3).ok, false); assert.equal(nested, false); assert.equal(record.snapshot().pending, false);
    for (let index = 0; index < 64; index += 1) {
        armedSet = true; throwSet = true;
        assert.equal(record.begin('login', 'outer', `failed-${index}`, 'fp', 4 + index).ok, false);
        assert.equal(record.snapshot().pending, false);
    }
    throwSet = false;
    assert.equal(record.begin('login', 'outer', 'clean-retry', 'fp', 100).ok, true, 'failed publication cannot consume idempotency capacity');
    assert.equal(record.snapshot().pending, true);
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
});

test('cancels only the exact live pre-ticket pending tuple and preserves replay receipts', () => {
    const { record } = control();
    const receipt = record.begin('login', 'op-1', 'key-1', 'fp-1', 0);
    const pending = record.snapshot();
    const mismatches: [unknown, unknown, unknown, unknown, unknown][] = [
        ['other', 'op-1', pending.generation, 'fp-1', 200_000],
        ['f0', 'other', pending.generation, 'fp-1', 1],
        ['f0', 'op-1', BigInt(1), 'fp-1', 1],
        ['f0', 'op-1', pending.generation, 'other', 1],
        ['f0', 'op-1', pending.generation, 'fp-1', -1],
    ];
    for (const values of mismatches) {
        assert.equal(record.cancelPendingAuth(...values), 0);
        assert.deepEqual(record.snapshot(), pending, 'a mismatch cannot advance time or clear another attempt');
    }
    assert.equal(record.cancelPendingAuth('f0', 'op-1', pending.generation, 'fp-1', 1), 1);
    assert.deepEqual(record.snapshot(), { fence: 'f0', generation: BigInt(0), pending: false, active: false });
    assert.equal(record.finalizeAuth('f0', 'op-1', pending.generation, 'fp-1', 'web', 'f1', 2).ok, false);
    assert.deepEqual(record.begin('login', 'op-1', 'key-1', 'fp-1', 2), receipt, 'a begin replay is receipt-only');
    assert.equal(record.snapshot().pending, false);
    assert.equal(record.begin('login', 'op-1', 'key-2', 'fp-2', 3).ok, true, 'a new key may retry');
    assert.equal(record.cancelPendingAuth('f0', 'op-1', BigInt(0), 'fp-1', 4), 0, 'the stale fingerprint cannot cancel the retry');
    assert.equal(record.snapshot().pending, true);
    assert.equal(record.cancelPendingAuth('f0', 'op-1', BigInt(0), 'fp-2', 4), 1);
    assert.equal(record.cancelPendingAuth('f0', 'op-1', BigInt(0), 'fp-2', 4), 0);
});

test('expires exact cancellation monotonically and excludes prepared tickets and ACTIVE state', () => {
    const expired = control().record;
    expired.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(expired.cancelPendingAuth('f0', 'op', BigInt(0), 'fp', 120_000), 0);
    assert.equal(expired.snapshot().pending, false);

    const ticketed = control().record;
    ticketed.begin('login', 'op', 'key', 'fp', 0);
    const ticket = ticketed.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(ticket);
    const before = ticketed.snapshot();
    assert.equal(ticketed.cancelPendingAuth('f0', 'op', BigInt(0), 'fp', 2), 0, 'prepared-ticket cleanup belongs to P2c0b');
    assert.deepEqual(ticketed.snapshot(), before);
    assert.equal(commitAuthControlTicket(ticket), true);
    const active = ticketed.snapshot();
    assert.equal(ticketed.cancelPendingAuth(active.fence, 'op', active.generation, 'fp', 3), 0);
    assert.deepEqual(ticketed.snapshot(), active);
});

test('aborts one exact prepared ticket and preserves idempotency for a clean retry', () => {
    const record = control().record;
    const receipt = record.begin('login', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(ticket);
    assert.equal(abortPreparedAuthControlTicket(ticket), true);
    assert.equal(abortPreparedAuthControlTicket(ticket), false, 'the ticket burn is one-shot');
    assert.deepEqual(record.snapshot(), { fence: 'f0', generation: BigInt(0), pending: false, active: false });
    assert.deepEqual(record.begin('login', 'op', 'key', 'fp', 2), receipt, 'the original begin remains receipt-only');
    assert.equal(record.snapshot().pending, false);
    assert.equal(record.begin('login', 'op', 'new-key', 'fp', 3).ok, true);
    const retry = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 4); assert.ok(retry);
    assert.equal(abortPreparedAuthControlTicket(retry), true);
});

test('burns stale prepared tickets without clearing an expired or ABA replacement pending', () => {
    const record = control().record;
    record.begin('login', 'op', 'old-key', 'fp', 0);
    const old = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-old', 1); assert.ok(old);
    assert.equal(record.begin('login', 'op', 'new-key', 'fp', 120_000).ok, true, 'same tuple values may belong to a new pending identity');
    const replacement = record.snapshot();
    assert.equal(abortPreparedAuthControlTicket(old), true);
    assert.deepEqual(record.snapshot(), replacement, 'the old ticket cannot clear the ABA replacement');
    const next = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-new', 120_002); assert.ok(next);
    assert.equal(abortPreparedAuthControlTicket(next), true);

    const expired = control().record;
    expired.begin('login', 'op', 'key', 'fp', 0);
    const stale = expired.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(stale);
    assert.equal(expired.finalizeAuth('wrong', 'op', BigInt(0), 'fp', 'web', 'f1', 120_000).ok, false);
    assert.equal(expired.snapshot().pending, false);
    assert.equal(abortPreparedAuthControlTicket(stale), true, 'a stale exact ticket still burns its reservations');
    assert.equal(expired.snapshot().pending, false);
});

test('does not steal ticket ownership from prepared activation or retirement lifecycles', () => {
    const record = control().record; record.begin('login', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(ticket);
    const activation = prepareAuthControlActivation(ticket, 'web'); assert.ok(activation);
    const beforeActivation = record.snapshot();
    assert.equal(abortPreparedAuthControlTicket(ticket), false);
    assert.deepEqual(record.snapshot(), beforeActivation);
    assert.equal(commitPreparedAuthControlActivation(activation), 1);
    const retirement = prepareAuthControlRetirement(ticket, 'web', 'lock'); assert.ok(retirement);
    const beforeRetirement = record.snapshot();
    assert.equal(abortPreparedAuthControlTicket(ticket), false);
    assert.deepEqual(record.snapshot(), beforeRetirement);
    assert.equal(commitPreparedAuthControlRetirement(retirement), 2);
});

test('ticket abort rejects hostile, foreign, reentrant, and throwing lookups without residue', async (t) => {
    let traps = 0;
    const proxy = new Proxy({}, { get: () => { traps += 1; throw new Error('get'); }, ownKeys: () => { traps += 1; throw new Error('keys'); } });
    const rejected = Promise.reject(new Error('hostile')); rejected.catch(() => undefined);
    for (const value of [proxy, rejected, { then: proxy }, Symbol('x'), null]) assert.equal(abortPreparedAuthControlTicket(value), false);
    assert.equal(traps, 0);
    const primary = control().record; primary.begin('login', 'op', 'key', 'fp', 0);
    const primaryTicket = primary.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(primaryTicket);
    const foreign = await freshModule('abort-ticket-foreign');
    assert.equal(foreign.abortPreparedAuthControlTicket(primaryTicket), false);
    assert.equal(abortPreparedAuthControlTicket(primaryTicket), true);

    const original = WeakMap.prototype.get; let isolated: Awaited<ReturnType<typeof freshModule>>; let ticket: object; let armed = false; let reenter = true; let nested = true; let failAfterApply = false;
    WeakMap.prototype.get = function (...args: Parameters<typeof original>) {
        const result = Reflect.apply(original, this, args) as unknown;
        if (armed) { armed = false; if (reenter) nested = isolated.abortPreparedAuthControlTicket(ticket); if (failAfterApply) throw new Error('apply then throw'); }
        return result;
    };
    try { isolated = await freshModule('abort-ticket-reentry'); } finally { WeakMap.prototype.get = original; }
    const first = isolated.createWebAuthControlRecord('f0'); first.begin('login', 'op', 'key', 'fp', 0);
    ticket = first.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1) as object;
    armed = true; assert.equal(isolated.abortPreparedAuthControlTicket(ticket), false); assert.equal(nested, false); assert.equal(first.snapshot().pending, true);
    assert.equal(isolated.abortPreparedAuthControlTicket(ticket), true);
    const second = isolated.createWebAuthControlRecord('g0'); second.begin('login', 'op', 'key', 'fp', 0);
    ticket = second.prepareAuthControlTicket('g0', 'op', BigInt(0), 'fp', 'web', 1) as object;
    armed = true; reenter = false; failAfterApply = true; assert.equal(isolated.abortPreparedAuthControlTicket(ticket), false); assert.equal(second.snapshot().pending, true);
    failAfterApply = false; assert.equal(isolated.abortPreparedAuthControlTicket(ticket), true);
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
});

test('cancellation denies hostile values and intrinsic reentry without residue', async (t) => {
    let traps = 0;
    const proxy = new Proxy({}, { get: () => { traps += 1; throw new Error('get'); }, ownKeys: () => { traps += 1; throw new Error('keys'); } });
    const rejected = Promise.reject(new Error('hostile')); rejected.catch(() => undefined);
    const record = control().record; record.begin('login', 'op', 'key', 'fp', 0);
    const before = record.snapshot();
    for (const value of [proxy, rejected, { then: proxy }, Symbol('x')]) {
        assert.equal(record.cancelPendingAuth(value, 'op', BigInt(0), 'fp', 1), 0);
        assert.equal(record.cancelPendingAuth('f0', value, BigInt(0), 'fp', 1), 0);
        assert.equal(record.cancelPendingAuth('f0', 'op', value, 'fp', 1), 0);
        assert.equal(record.cancelPendingAuth('f0', 'op', BigInt(0), value, 1), 0);
        assert.equal(record.cancelPendingAuth('f0', 'op', BigInt(0), 'fp', value), 0);
    }
    assert.equal(traps, 0); assert.deepEqual(record.snapshot(), before);
    const ambientThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); let ambientReads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => { ambientReads += 1; throw new Error('ambient then'); } });
    try { assert.equal(record.cancelPendingAuth('wrong', 'op', BigInt(0), 'fp', 1), 0); }
    finally { if (ambientThen) Object.defineProperty(Object.prototype, 'then', ambientThen); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(ambientReads, 0); assert.deepEqual(record.snapshot(), before);

    const original = Number.isSafeInteger; let isolated: Awaited<ReturnType<typeof freshModule>>; let nested = -1; let armed = false; let failAfterApply = false;
    Number.isSafeInteger = ((value: unknown) => {
        const accepted = original(value);
        if (armed) { armed = false; nested = reentrant.cancelPendingAuth('f0', 'op', BigInt(0), 'fp', 1); if (failAfterApply) throw new Error('apply then throw'); }
        return accepted;
    }) as typeof Number.isSafeInteger;
    try { isolated = await freshModule('cancel-pending-reentry'); } finally { Number.isSafeInteger = original; }
    const reentrant = isolated.createWebAuthControlRecord('f0'); reentrant.begin('login', 'op', 'key', 'fp', 0);
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    armed = true; assert.equal(reentrant.cancelPendingAuth('f0', 'op', BigInt(0), 'fp', 1), 0); assert.equal(nested, 0); assert.equal(reentrant.snapshot().pending, true);
    armed = true; failAfterApply = true; assert.equal(reentrant.cancelPendingAuth('f0', 'op', BigInt(0), 'fp', 1), 0); assert.equal(reentrant.snapshot().pending, true);
    failAfterApply = false; assert.equal(reentrant.cancelPendingAuth('f0', 'op', BigInt(0), 'fp', 1), 1);
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
});

test('lock preempts pending, binds its successor fence, and detaches only once on exact replay', () => {
    const { record, issued } = control();
    record.begin('setup', 'op', 'key', 'fp', 0);
    assert.deepEqual(record.advanceLock('f0', 'lock', 'lock-fp', issued(), 1), { ok: true, fence: 'f1', generation: BigInt(1), detachedSessionId: null });
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f2', 2).ok, false);
    assert.deepEqual(record.advanceLock('f0', 'lock', 'lock-fp', 'f1', 3), { ok: true, fence: 'f1', generation: BigInt(1), detachedSessionId: null });
    assert.equal(record.advanceLock('f0', 'lock', 'lock-fp', 'f2', 3).ok, false, 'replay needs the exact successor fence');
    assert.deepEqual(record.finalizeLock('f0', 'lock', 'lock-fp', 4), { ok: true, fence: 'f1', generation: BigInt(1), receipt: 'confirmed' });
    assert.deepEqual(record.finalizeLock('f0', 'lock', 'lock-fp', 5), { ok: true, fence: 'f1', generation: BigInt(1), receipt: 'confirmed' });
});

test('auth first makes a stale lock unconfirmed until its successor fence', () => {
    const { record } = control();
    record.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f1', 1).ok, true);
    assert.equal(record.advanceLock('f0', 'lock', 'fp-lock', 'f2', 2).ok, false);
    assert.equal(record.finalizeLock('f0', 'lock', 'fp-lock', 2).ok, false);
    assert.equal(record.advanceLock('f1', 'lock', 'fp-lock', 'f2', 3).ok, true);
});

test('expires pending monotonically and retains idempotency tombstones at capacity', () => {
    const { record } = control();
    record.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f1', 120_000).ok, false);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f1', 0).ok, false, 'clock rollback cannot revive a pending operation');
    assert.deepEqual(record.begin('login', 'op', 'key', 'fp', 120_000), { ok: true, fence: 'f0', generation: BigInt(0) }, 'the exact pending-TTL replay remains available before replay TTL');
    let fence = 'f0';
    for (let index = 0; index < 63; index += 1) {
        const result = record.advanceLock(fence, `key-${index}`, `fp-${index}`, `f${index + 1}`, 120_001 + index);
        assert.equal(result.ok, true);
        if (result.ok) fence = result.fence;
    }
    assert.equal(record.advanceLock(fence, 'key-63', 'fp-63', 'f64', 500_001).ok, false);
    assert.equal(record.advanceLock('f0', 'key-0', 'changed', 'f1', 500_001).ok, false);
    assert.equal(record.advanceLock('f0', 'key-0', 'fp-0', 'f1', 500_001).ok, false);
});

test('rejects hostile successor objects without observing them or changing state', async (t) => {
    let observed = false;
    const accessor = {}; Object.defineProperty(accessor, 'then', { get: () => { observed = true; throw new Error('read'); } });
    const hidden = {}; Object.defineProperty(hidden, 'value', { value: 'x', enumerable: false });
    const proxy = new Proxy({}, { get: () => { observed = true; throw new Error('get trap'); }, ownKeys: () => { observed = true; throw new Error('ownKeys trap'); } });
    const rejected = Promise.reject(new Error('rejected successor')); rejected.catch(() => undefined);
    const hostile = [Promise.resolve('f1'), rejected, { then: () => { observed = true; } }, accessor, hidden, proxy, {}, Symbol('x')];
    const lock = control().record;
    const auth = control().record;
    assert.equal(auth.begin('login', 'op', 'key', 'fp', 0).ok, true);
    const bound = control().record;
    assert.equal(bound.begin('login', 'op', 'key', 'fp', 0).ok, true);
    assert.equal(bound.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f1', 1).ok, true);
    const mutations = [
        { record: lock, apply: (value: unknown) => lock.advanceLock('f0', 'key', 'fp', value, 1) },
        { record: auth, apply: (value: unknown) => auth.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', value, 1) },
        { record: bound, apply: (value: unknown) => bound.disposeBoundSession('f1', 'web', value, 2) },
    ];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of hostile) {
        for (const mutation of mutations) {
            const before = mutation.record.snapshot();
            assert.equal(mutation.apply(value).ok, false);
            assert.deepEqual(mutation.record.snapshot(), before);
        }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, false);
    assert.deepEqual(unhandled, []);
});

test('denies ABA fences, collisions, and wraps without advancing generation', () => {
    const { record } = control();
    assert.equal(record.advanceLock('f0', 'key', 'fp', 'f0', 0).ok, false, 'successor collision is fail closed');
    assert.equal(record.advanceLock('f0', 'key', 'fp', 'f1', 0).ok, true);
    assert.equal(record.advanceLock('f0', 'key-2', 'fp', 'f0', 1).ok, false, 'used fence cannot be reused');
    const wrapped = createWebAuthControlRecord('max', MAX);
    assert.equal(wrapped.advanceLock('max', 'key', 'fp', 'next', 0).ok, false);
    const lexical = createWebAuthControlRecord('__proto__');
    assert.equal(lexical.advanceLock('__proto__', 'key', 'fp', 'constructor', 0).ok, true);
    assert.equal(lexical.advanceLock('constructor', 'other', 'fp', '__proto__', 1).ok, false, 'null-prototype tombstones retain special string keys');
});

test('constructor accepts only inert primitive initial state', () => {
    let called = false;
    assert.throws(() => createWebAuthControlRecord('f0', () => { called = true; return BigInt(0); }));
    assert.equal(called, false);
});

test('keeps P2a transitions atomic after post-import intrinsic poison', async (t) => {
    const zero = BigInt(0);
    const SetIntrinsic = Set;
    const MapIntrinsic = Map;
    const originals = {
        add: SetIntrinsic.prototype.add, has: SetIntrinsic.prototype.has, get: MapIntrinsic.prototype.get, mapSet: MapIntrinsic.prototype.set,
        size: Object.getOwnPropertyDescriptor(MapIntrinsic.prototype, 'size')!, freeze: Object.freeze,
        safeInteger: Number.isSafeInteger, max: Math.max, setGlobal: Object.getOwnPropertyDescriptor(globalThis, 'Set')!,
        map: Object.getOwnPropertyDescriptor(globalThis, 'Map')!, bigint: Object.getOwnPropertyDescriptor(globalThis, 'BigInt')!,
    };
    const fail = () => { throw new Error('post-import poison'); };
    const auth = control().record;
    const locked = control().record;
    const ticketRecord = control().record; ticketRecord.begin('login', 'ticket-op', 'ticket-key', 'ticket-fp', 0);
    const ticket = ticketRecord.prepareAuthControlTicket('f0', 'ticket-op', BigInt(0), 'ticket-fp', 'ticket-web', 1); assert.ok(ticket);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));
    let thrown: unknown;
    let begin: unknown; let completed: unknown; let disposed: unknown; let lock: unknown; let ticketCommit: unknown; let ticketRetire: unknown; let constructed: ReturnType<typeof createWebAuthControlRecord> | undefined;
    try {
        SetIntrinsic.prototype.add = fail as typeof SetIntrinsic.prototype.add;
        SetIntrinsic.prototype.has = fail as typeof SetIntrinsic.prototype.has;
        MapIntrinsic.prototype.get = fail as typeof MapIntrinsic.prototype.get;
        MapIntrinsic.prototype.set = fail as typeof MapIntrinsic.prototype.set;
        Object.defineProperty(MapIntrinsic.prototype, 'size', { configurable: true, get: fail });
        Object.freeze = fail as typeof Object.freeze;
        Number.isSafeInteger = fail;
        Math.max = fail;
        Object.defineProperty(globalThis, 'Set', { configurable: true, value: fail });
        Object.defineProperty(globalThis, 'Map', { configurable: true, value: fail });
        Object.defineProperty(globalThis, 'BigInt', { configurable: true, value: fail });
        try {
            constructed = createWebAuthControlRecord('c0');
            begin = auth.begin('login', 'op', 'key', 'fp', 0);
            completed = auth.finalizeAuth('f0', 'op', zero, 'fp', 'web', 'f1', 1);
            disposed = auth.disposeBoundSession('f1', 'web', 'f2', 2);
            lock = locked.advanceLock('f0', 'lock', 'lock-fp', 'f1', 0);
            ticketCommit = commitAuthControlTicket(ticket); ticketRetire = retireAuthControlTicket(ticket, 'lock');
        } catch (error) { thrown = error; }
    } finally {
        SetIntrinsic.prototype.add = originals.add;
        SetIntrinsic.prototype.has = originals.has;
        MapIntrinsic.prototype.get = originals.get;
        MapIntrinsic.prototype.set = originals.mapSet;
        Object.defineProperty(MapIntrinsic.prototype, 'size', originals.size);
        Object.freeze = originals.freeze;
        Number.isSafeInteger = originals.safeInteger;
        Math.max = originals.max;
        Object.defineProperty(globalThis, 'Set', originals.setGlobal);
        Object.defineProperty(globalThis, 'Map', originals.map);
        Object.defineProperty(globalThis, 'BigInt', originals.bigint);
    }
    assert.equal(thrown, undefined);
    assert.deepEqual(begin, { ok: true, fence: 'f0', generation: BigInt(0) });
    assert.deepEqual(completed, { ok: true, fence: 'f1', generation: BigInt(1) });
    assert.deepEqual(disposed, { ok: true, fence: 'f2', generation: BigInt(2) });
    assert.deepEqual(lock, { ok: true, fence: 'f1', generation: BigInt(1), detachedSessionId: null });
    assert.equal(ticketCommit, true); assert.equal(ticketRetire, 1);
    assert.deepEqual(constructed?.snapshot(), { fence: 'c0', generation: BigInt(0), pending: false, active: false });
    assert.deepEqual(auth.snapshot(), { fence: 'f2', generation: BigInt(2), pending: false, active: false });
    assert.deepEqual(locked.snapshot(), { fence: 'f1', generation: BigInt(1), pending: false, active: false });
    assert.equal(Object.isFrozen(completed), true);
    assert.equal(Object.isFrozen(lock), true);
    assert.equal(auth.begin('login', 'retry', 'retry-key', 'retry-fp', 3).ok, true, 'the completed disposal leaves a valid retry state');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
});

test('commits one opaque ticket for the exact pending control and session binding', () => {
    const first = control().record;
    const other = control('other').record;
    assert.equal(first.begin('login', 'op', 'key', 'fp', 0).ok, true);
    assert.equal(other.begin('login', 'op', 'key', 'fp', 0).ok, true);

    const ticket = first.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-1', 1);
    assert.ok(ticket);
    assert.equal(Object.getPrototypeOf(ticket), null);
    assert.equal(Object.isFrozen(ticket), true);
    assert.deepEqual(Reflect.ownKeys(ticket), []);
    assert.equal(commitAuthControlTicket(ticket), true);
    assert.deepEqual(first.snapshot(), { fence: first.snapshot().fence, generation: BigInt(1), pending: false, active: true });
    assert.equal(commitAuthControlTicket(ticket), false, 'activation ticket is single-use');
    assert.equal(other.snapshot().active, false, 'the ticket cannot mutate another control record');
});

test('prepares one exact activation and commits it through a lexical final CAS', () => {
    const { record } = control(); record.begin('login', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', '__proto__', 1); assert.ok(ticket);
    const prepared = prepareAuthControlActivation(ticket, '__proto__'); assert.ok(prepared);
    assert.deepEqual([Object.getPrototypeOf(prepared), Object.isFrozen(prepared), Reflect.ownKeys(prepared)], [null, true, []]);
    assert.equal(commitAuthControlTicket(ticket), false, 'legacy direct commit cannot bypass a prepared activation');
    assert.equal(commitPreparedAuthControlActivation(prepared), 1);
    assert.deepEqual(record.snapshot(), { fence: record.snapshot().fence, generation: BigInt(1), pending: false, active: true });
    assert.equal(commitPreparedAuthControlActivation(prepared), 0);
    assert.equal(abortPreparedAuthControlActivation(prepared), false);
    assert.equal(retireAuthControlTicket(ticket, 'lock'), 1, 'the original ticket remains the retirement binding');

    const source = readFileSync(fileURLToPath(new URL('./web-auth-control-record.ts', import.meta.url)), 'utf8');
    const body = source.slice(source.indexOf('export function commitPreparedAuthControlActivation'), source.indexOf('export function abortPreparedAuthControlActivation'));
    assert.doesNotMatch(body, /weakMap|mapGet|mapSet|tableHas|tableAdd|tableDelete|Reflect|apply\(|Object\.|Promise|then|callback/u);
});

test('activation preparation denies wrong, stale, replayed, and colliding bindings without residue', () => {
    const wrong = control().record; wrong.begin('login', 'op', 'key', 'fp', 0);
    const wrongTicket = wrong.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-1', 1); assert.ok(wrongTicket);
    assert.equal(prepareAuthControlActivation(wrongTicket, 'web-2'), null);
    assert.equal(commitAuthControlTicket(wrongTicket), false);

    const stale = control().record; stale.begin('login', 'op', 'key', 'fp', 0);
    const staleTicket = stale.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-stale', 1); assert.ok(staleTicket);
    stale.advanceLock('f0', 'lock', 'lock-fp', 'f-stale', 2);
    assert.equal(prepareAuthControlActivation(staleTicket, 'web-stale'), null);

    const first = control('first').record; first.begin('login', 'op-a', 'key-a', 'fp-a', 0);
    const second = control('second').record; second.begin('setup', 'op-b', 'key-b', 'fp-b', 0);
    const firstTicket = first.prepareAuthControlTicket('first', 'op-a', BigInt(0), 'fp-a', 'web-a', 1);
    const secondTicket = second.prepareAuthControlTicket('second', 'op-b', BigInt(0), 'fp-b', 'web-b', 1); assert.ok(firstTicket && secondTicket);
    const firstPrepared = prepareAuthControlActivation(firstTicket, 'web-a'); assert.ok(firstPrepared);
    assert.equal(prepareAuthControlActivation(secondTicket, 'web-b'), null, 'a concurrent prepared activation denies both reservations');
    assert.equal(commitPreparedAuthControlActivation(firstPrepared), 0);
    assert.equal(commitAuthControlTicket(secondTicket), false);
    const replayTicket = first.prepareAuthControlTicket('first', 'op-a', BigInt(0), 'fp-a', 'web-a', 2); assert.ok(replayTicket);
    const replayPrepared = prepareAuthControlActivation(replayTicket, 'web-a'); assert.ok(replayPrepared);
    assert.equal(prepareAuthControlActivation(replayTicket, 'web-a'), null, 'double prepare is terminal');
    assert.equal(commitPreparedAuthControlActivation(replayPrepared), 0);
    const secondRetry = second.prepareAuthControlTicket('second', 'op-b', BigInt(0), 'fp-b', 'web-b', 2); assert.ok(secondRetry);
    const secondPrepared = prepareAuthControlActivation(secondRetry, 'web-b'); assert.ok(secondPrepared);
    assert.equal(abortPreparedAuthControlActivation(secondPrepared), true);
    assert.equal(abortPreparedAuthControlActivation(secondPrepared), false);
});

test('activation capabilities reject hostile and cross-module values without ambient work', async () => {
    let observed = 0; const proxy = new Proxy({}, { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('hostile')); rejected.catch(() => undefined);
    const hostile = [null, {}, Object.create(null), proxy, accessor, Promise.resolve(), rejected, { then() { observed += 1; } }];
    for (const value of hostile) { assert.equal(prepareAuthControlActivation(value, 'web'), null); assert.equal(commitPreparedAuthControlActivation(value), 0); assert.equal(abortPreparedAuthControlActivation(value), false); }

    const record = control().record; record.begin('login', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(ticket);
    const prepared = prepareAuthControlActivation(ticket, 'web'); assert.ok(prepared);
    const restarted = await freshModule('web-auth-activation-restart');
    assert.equal(restarted.prepareAuthControlActivation(ticket, 'web'), null);
    assert.equal(restarted.commitPreparedAuthControlActivation(prepared), 0);
    const fail = () => { throw new Error('ambient poison'); }; const get = WeakMap.prototype.get; const reflectApply = Reflect.apply;
    const thenDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try {
        WeakMap.prototype.get = fail as typeof get; Reflect.apply = fail as typeof Reflect.apply;
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get: fail });
        assert.equal(commitPreparedAuthControlActivation(prepared), 1);
    } finally {
        WeakMap.prototype.get = get; Reflect.apply = reflectApply;
        if (thenDescriptor) Object.defineProperty(Object.prototype, 'then', thenDescriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    const terminal = record.snapshot();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(record.snapshot(), terminal);

    const denied = control('denied').record; denied.begin('login', 'op', 'key', 'fp', 0);
    const deniedTicket = denied.prepareAuthControlTicket('denied', 'op', BigInt(0), 'fp', 'denied-web', 1); assert.ok(deniedTicket);
    const deniedPrepared = prepareAuthControlActivation(deniedTicket, 'denied-web'); assert.ok(deniedPrepared);
    assert.equal(commitPreparedAuthControlActivation(proxy), 0); assert.equal(commitPreparedAuthControlActivation(deniedPrepared), 0); assert.equal(observed, 0);
});

test('activation preparation survives pre-import WeakMap reentry and apply-then-throw fail closed', async () => {
    const originalGet = WeakMap.prototype.get; let target = ''; let failAfterApply = false; let nested = () => undefined;
    WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
        if (target === 'get') { target = ''; nested(); }
        const result = Reflect.apply(originalGet, this, [key]);
        if (failAfterApply) { failAfterApply = false; throw new Error('apply-then-throw'); }
        return result;
    };
    let isolated: typeof import('./web-auth-control-record.ts');
    try { isolated = await freshModule('web-auth-activation-weakmap'); } finally { WeakMap.prototype.get = originalGet; }
    const record = isolated.createWebAuthControlRecord('f0'); record.begin('login', 'op', 'key', 'fp', 0);
    const first = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(first);
    let nestedResult: unknown; target = 'get'; nested = () => { nestedResult = isolated.prepareAuthControlActivation(first, 'web'); };
    assert.equal(isolated.prepareAuthControlActivation(first, 'web'), null); assert.equal(nestedResult, null); assert.equal(isolated.commitAuthControlTicket(first), false);
    const second = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 2); assert.ok(second);
    failAfterApply = true; assert.equal(isolated.prepareAuthControlActivation(second, 'web'), null); assert.equal(isolated.commitAuthControlTicket(second), false);
    const retry = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 3); assert.ok(retry);
    const prepared = isolated.prepareAuthControlActivation(retry, 'web'); assert.ok(prepared); assert.equal(isolated.commitPreparedAuthControlActivation(prepared), 1);
    const terminal = record.snapshot(); await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(record.snapshot(), terminal);
});

test('prepares one exact retirement and commits it through a lexical final CAS', () => {
    const { record } = control(); record.begin('login', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', '__proto__', 1); assert.ok(ticket);
    const activation = prepareAuthControlActivation(ticket, '__proto__'); assert.ok(activation);
    assert.equal(commitPreparedAuthControlActivation(activation), 1);
    const prepared = prepareAuthControlRetirement(ticket, '__proto__', 'lock'); assert.ok(prepared);
    assert.deepEqual([Object.getPrototypeOf(prepared), Object.isFrozen(prepared), Reflect.ownKeys(prepared)], [null, true, []]);
    assert.equal(retireAuthControlTicket(ticket, 'lock'), 0, 'legacy retirement cannot bypass a prepared CAS');
    assert.equal(commitPreparedAuthControlRetirement(prepared), 2);
    assert.deepEqual(record.snapshot(), { fence: record.snapshot().fence, generation: BigInt(2), pending: false, active: false });
    assert.equal(commitPreparedAuthControlRetirement(prepared), 0);
    assert.equal(abortPreparedAuthControlRetirement(prepared), false);
    assert.equal(retireAuthControlTicket(ticket, 'lock'), 2, 'the exact reason remains a receipt-only replay');
    assert.equal(retireAuthControlTicket(ticket, 'dispose'), 0);

    const source = readFileSync(fileURLToPath(new URL('./web-auth-control-record.ts', import.meta.url)), 'utf8');
    const body = source.slice(source.indexOf('export function commitPreparedAuthControlRetirement'), source.indexOf('export function abortPreparedAuthControlRetirement'));
    assert.doesNotMatch(body, /weakMap|mapGet|mapSet|tableHas|tableAdd|tableDelete|Reflect|apply\(|Object\.|Promise|then|callback|enterTicket|leaveTicket/u);
});

test('observes only the exact current ACTIVE ticket and never burns it', () => {
    const record = control('current').record; record.begin('login', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('current', 'op', BigInt(0), 'fp', 'web-current', 1); assert.ok(ticket);
    assert.equal(isCurrentAuthControlSessionBinding(ticket, 'web-current'), false, 'prepared is not ACTIVE');
    const activation = prepareAuthControlActivation(ticket, 'web-current'); assert.ok(activation);
    assert.equal(isCurrentAuthControlSessionBinding(ticket, 'web-current'), false, 'activation-prepared is not ACTIVE');
    assert.equal(commitPreparedAuthControlActivation(activation), 1);
    const active = record.snapshot();
    assert.equal(isCurrentAuthControlSessionBinding(ticket, 'web-current'), true);
    assert.equal(isCurrentAuthControlSessionBinding(ticket, 'web-current'), true, 'predicate is non-burning');
    assert.equal(isCurrentAuthControlSessionBinding(ticket, 'web-other'), false);
    assert.deepEqual(record.snapshot(), active);
    const retirement = prepareAuthControlRetirement(ticket, 'web-current', 'lock'); assert.ok(retirement);
    assert.equal(isCurrentAuthControlSessionBinding(ticket, 'web-current'), false, 'reserved retirement is not current');
    assert.equal(abortPreparedAuthControlRetirement(retirement), true);
    assert.equal(isCurrentAuthControlSessionBinding(ticket, 'web-current'), false, 'aborted ticket stays terminal');

    const stale = control('stale-current').record; stale.begin('login', 'op', 'key', 'fp', 0);
    const staleTicket = stale.prepareAuthControlTicket('stale-current', 'op', BigInt(0), 'fp', 'web-stale', 1); assert.ok(staleTicket);
    const staleActivation = prepareAuthControlActivation(staleTicket, 'web-stale'); assert.ok(staleActivation);
    assert.equal(commitPreparedAuthControlActivation(staleActivation), 1);
    const staleFence = stale.snapshot().fence;
    assert.equal(stale.advanceLock(staleFence, 'lock', 'lock-fp', 'stale-next', 2).ok, true);
    assert.equal(isCurrentAuthControlSessionBinding(staleTicket, 'web-stale'), false, 'fence, generation, and active-session drift deny');

    const retired = control('retired-current').record; retired.begin('login', 'op', 'key', 'fp', 0);
    const retiredTicket = retired.prepareAuthControlTicket('retired-current', 'op', BigInt(0), 'fp', 'web-retired', 1); assert.ok(retiredTicket);
    const retiredActivation = prepareAuthControlActivation(retiredTicket, 'web-retired'); assert.ok(retiredActivation);
    assert.equal(commitPreparedAuthControlActivation(retiredActivation), 1);
    assert.equal(retireAuthControlTicket(retiredTicket, 'expired'), 1);
    assert.equal(isCurrentAuthControlSessionBinding(retiredTicket, 'web-retired'), false);
    assert.equal(retireAuthControlTicket(retiredTicket, 'expired'), 2, 'retirement replay remains receipt-only');
    assert.equal(isCurrentAuthControlSessionBinding(retiredTicket, 'web-retired'), false);
});

test('denies forged and hostile current-binding probes without observation or drift', async (t) => {
    const record = control('hostile-current').record; record.begin('login', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('hostile-current', 'op', BigInt(0), 'fp', 'web-hostile', 1); assert.ok(ticket);
    const activation = prepareAuthControlActivation(ticket, 'web-hostile'); assert.ok(activation);
    assert.equal(commitPreparedAuthControlActivation(activation), 1);
    const before = record.snapshot(); let reads = 0; let traps = 0;
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get() { reads += 1; throw new Error('then'); } });
    const proxy = new Proxy(Object.create(null), { get() { traps += 1; throw new Error('get'); }, ownKeys() { traps += 1; throw new Error('keys'); } });
    const rejected = Promise.reject(new Error('synthetic hostile current binding')); rejected.catch(() => undefined);
    const hostile = [null, undefined, {}, Object.create(null), { ...ticket }, proxy, accessor, Promise.resolve(), rejected, { then() { reads += 1; } }];
    const hostileIds = [null, undefined, {}, proxy, accessor, Promise.resolve(), { then() { reads += 1; } }];
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of hostile) assert.equal(isCurrentAuthControlSessionBinding(value, 'web-hostile'), false);
    for (const value of hostileIds) assert.equal(isCurrentAuthControlSessionBinding(ticket, value), false);
    const restarted = await freshModule('web-auth-current-binding-restart');
    assert.equal(restarted.isCurrentAuthControlSessionBinding(ticket, 'web-hostile'), false);
    assert.equal(reads, 0); assert.equal(traps, 0); assert.deepEqual(record.snapshot(), before);
    assert.equal(isCurrentAuthControlSessionBinding(ticket, 'web-hostile'), true, 'hostile probes do not burn the authentic ticket');
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []); assert.deepEqual(record.snapshot(), before);
});

test('keeps current-binding lookup read-only through captured intrinsic poison and reentry', async () => {
    const originalGet = WeakMap.prototype.get; let armed = false; let failAfterApply = false; let nested: unknown;
    let isolated: typeof import('./web-auth-control-record.ts'); const isolatedTicket: { value: unknown } = { value: null };
    WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
        if (armed) { armed = false; nested = isolated.isCurrentAuthControlSessionBinding(isolatedTicket.value, 'web-reentry'); }
        const value = Reflect.apply(originalGet, this, [key]);
        if (failAfterApply) { failAfterApply = false; throw new Error('synthetic get failure'); }
        return value;
    };
    try { isolated = await freshModule('web-auth-current-binding-reentry'); } finally { WeakMap.prototype.get = originalGet; }
    const record = isolated.createWebAuthControlRecord('reentry'); record.begin('login', 'op', 'key', 'fp', 0);
    const outerTicket = record.prepareAuthControlTicket('reentry', 'op', BigInt(0), 'fp', 'web-reentry', 1); assert.ok(outerTicket); isolatedTicket.value = outerTicket;
    const activation = isolated.prepareAuthControlActivation(outerTicket, 'web-reentry'); assert.ok(activation);
    assert.equal(isolated.commitPreparedAuthControlActivation(activation), 1); const before = record.snapshot();
    armed = true; assert.equal(isolated.isCurrentAuthControlSessionBinding(outerTicket, 'web-reentry'), false); assert.equal(nested, false);
    assert.equal(isolated.isCurrentAuthControlSessionBinding(outerTicket, 'web-reentry'), true, 'reentry denial is recoverable');
    const other = isolated.createWebAuthControlRecord('reentry-other'); other.begin('login', 'op', 'key', 'fp', 0);
    const otherTicket = other.prepareAuthControlTicket('reentry-other', 'op', BigInt(0), 'fp', 'web-other', 1); assert.ok(otherTicket);
    const otherActivation = isolated.prepareAuthControlActivation(otherTicket, 'web-other'); assert.ok(otherActivation);
    assert.equal(isolated.commitPreparedAuthControlActivation(otherActivation), 1); isolatedTicket.value = otherTicket;
    armed = true; assert.equal(isolated.isCurrentAuthControlSessionBinding(outerTicket, 'web-reentry'), false); assert.equal(nested, false, 'cross-ticket reentry denies');
    assert.equal(isolated.isCurrentAuthControlSessionBinding(outerTicket, 'web-reentry'), true); assert.equal(isolated.isCurrentAuthControlSessionBinding(otherTicket, 'web-other'), true);
    isolatedTicket.value = Object.create(null); armed = true; assert.equal(isolated.isCurrentAuthControlSessionBinding(outerTicket, 'web-reentry'), false); assert.equal(nested, false, 'hostile nested probe poisons outer');
    isolatedTicket.value = outerTicket; failAfterApply = true; assert.equal(isolated.isCurrentAuthControlSessionBinding(outerTicket, 'web-reentry'), false);
    const apply = Reflect.apply; const get = WeakMap.prototype.get; const then = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try {
        Reflect.apply = (() => { throw new Error('poisoned apply'); }) as typeof Reflect.apply;
        WeakMap.prototype.get = (() => { throw new Error('poisoned get'); }) as typeof WeakMap.prototype.get;
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { throw new Error('ambient then'); } });
        assert.equal(isolated.isCurrentAuthControlSessionBinding(isolatedTicket.value, 'web-reentry'), false, 'a captured hostile lookup intrinsic fails closed');
    } finally {
        Reflect.apply = apply; WeakMap.prototype.get = get;
        if (then) Object.defineProperty(Object.prototype, 'then', then); else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(record.snapshot(), before);
});

test('keeps the current-binding predicate private until the server-session retained-ticket packet', () => {
    assert.deepEqual(validateControlImports(repositoryTypeScript()).errors, []);
    const positive = validateControlImports({
        'lib/security/web-auth-logout-server.test.ts': "import { createWebAuthControlRecord as fixture } from '@/lib/security/web-auth-control-record';",
        'lib/security/literal.ts': "// import control from './web-auth-control-record'; const value = 'createWebAuthControlRecord'; const regex = /commitAuthControlTicket/u;",
    });
    assert.deepEqual(positive.errors, []); assert.equal(positive.uses[0]?.symbol, 'createWebAuthControlRecord');
    const rejected = [
        "import { commitAuthControlTicket as createWebAuthControlRecord } from './web-auth-control-record';",
        "import control from './web-auth-control-record';",
        "import * as control from './web-auth-control-record';",
        "export { createWebAuthControlRecord } from './web-auth-control-record';",
        ['const control = req', "uire('./web-auth-control-record');"].join(''),
        "const control = await import('./web-auth-control-record');",
        "const target = './web-auth-' + 'control-record'; const control = import((target as const), { with: { type: 'json' } });",
        "const suffix = pick(); const target = './web-auth-control-record' + suffix; import(target);",
        "const target = `./web-auth-control-record`; const load = require; load(target);",
        ['module.req', "uire('./web-auth-control-record'); req", "uire.call(null, './web-auth-control-record');"].join(''),
        "import { createWebAuthControlRecord } from './web-auth-control\\x2drecord';",
        "import { createWebAuthControlRecord } from './web-auth-control-record.js';",
        "import { createWebAuthControlRecord } from './nested/../web-auth-control-record';",
        "import type { createWebAuthControlRecord } from './web-auth-control-record';",
    ];
    for (const source of rejected) assert.notDeepEqual(validateControlImports({ 'lib/security/web-auth-logout-server.test.ts': source }).errors, []);
    const target = join(ROOT, 'lib/security/web-auth-control-record');
    for (const source of moduleImportBypassFixtures('./web-auth-control-record', target)) {
        assert.notDeepEqual(validateControlImports({ 'lib/security/web-auth-logout-server.test.ts': source }).errors, [], source);
    }
    const unresolvedRequire = ['req', 'uire(pick());'].join('');
    assert.ok(validateControlImports({ 'lib/security/extra.ts': unresolvedRequire }).errors.includes('lib/security/extra.ts:unsupported-expression:*'));
    assert.notDeepEqual(validateControlImports({ 'lib/security/web-auth-logout-server.ts': "import { createWebAuthControlRecord } from '../../lib/security/web-auth-control-record.ts';" }).errors, []);
    assert.notDeepEqual(validateControlImports({ 'lib/security/extra.ts': "import { createWebAuthControlRecord } from './web-auth-control-record';" }).errors, []);
    assert.notDeepEqual(validateControlImports({ 'lib/security/extra.test.ts': "import { createWebAuthControlRecord } from './web-auth-control-record.ts';" }).errors, []);
    assert.notDeepEqual(validateControlImports({ 'lib/security/server-session.ts': "import type { prepareAuthControlActivation } from './web-auth-control-record';" }).errors, []);
    assert.notDeepEqual(validateControlImports({ 'lib/security/web-auth-control-owner.ts': "import { AuthControlTicket } from './web-auth-control-record';" }).errors, []);
    const source = readFileSync(fileURLToPath(new URL('./web-auth-control-record.ts', import.meta.url)), 'utf8');
    const start = source.indexOf('export function isCurrentAuthControlSessionBinding');
    const body = source.slice(start, source.indexOf('/** Resolves one active ticket', start));
    assert.doesNotMatch(body, /async|await|Promise|callback|ticketBindings\.(?:set|delete)|weakMapSet|weakMapDelete|tableAdd|tableDelete|enterTicketOperation|leaveTicketOperation/u);
});

test('retirement preparation burns wrong, colliding, replayed, and aborted bindings', () => {
    const active = (fence: string, sessionId: string) => {
        const record = control(fence).record; record.begin('login', 'op', 'key', 'fp', 0);
        const ticket = record.prepareAuthControlTicket(fence, 'op', BigInt(0), 'fp', sessionId, 1); assert.ok(ticket);
        const activation = prepareAuthControlActivation(ticket, sessionId); assert.ok(activation); assert.equal(commitPreparedAuthControlActivation(activation), 1);
        return { record, ticket };
    };
    const wrongSession = active('wrong-session', 'web-a');
    assert.equal(prepareAuthControlRetirement(wrongSession.ticket, 'web-b', 'lock'), null);
    assert.equal(retireAuthControlTicket(wrongSession.ticket, 'lock'), 0);
    const wrongReason = active('wrong-reason', 'web-a');
    assert.equal(prepareAuthControlRetirement(wrongReason.ticket, 'web-a', 'unknown'), null);
    assert.equal(retireAuthControlTicket(wrongReason.ticket, 'lock'), 0);
    const stale = active('stale', 'web-stale'); const staleFence = stale.record.snapshot().fence;
    assert.equal(stale.record.advanceLock(staleFence, 'lock', 'lock-fp', 'stale-next', 2).ok, true);
    assert.equal(prepareAuthControlRetirement(stale.ticket, 'web-stale', 'lock'), null);

    const first = active('first', 'web-a'); const second = active('second', 'web-b');
    const firstPrepared = prepareAuthControlRetirement(first.ticket, 'web-a', 'dispose'); assert.ok(firstPrepared);
    assert.equal(prepareAuthControlRetirement(second.ticket, 'web-b', 'clear'), null, 'a concurrent retirement denies both tickets');
    assert.equal(commitPreparedAuthControlRetirement(firstPrepared), 0);
    assert.equal(retireAuthControlTicket(second.ticket, 'clear'), 0);

    const replay = active('replay', 'web-r');
    const replayPrepared = prepareAuthControlRetirement(replay.ticket, 'web-r', 'expired'); assert.ok(replayPrepared);
    assert.equal(prepareAuthControlRetirement(replay.ticket, 'web-r', 'expired'), null, 'double prepare is terminal');
    assert.equal(commitPreparedAuthControlRetirement(replayPrepared), 0);
    const aborted = active('abort', 'web-z');
    const abortedPrepared = prepareAuthControlRetirement(aborted.ticket, 'web-z', 'delete'); assert.ok(abortedPrepared);
    assert.equal(abortPreparedAuthControlRetirement(abortedPrepared), true);
    assert.equal(abortPreparedAuthControlRetirement(abortedPrepared), false);
    assert.equal(retireAuthControlTicket(aborted.ticket, 'delete'), 0);
});

test('retirement capabilities reject hostile and cross-module values without ambient work', async (t) => {
    let observed = 0; const proxy = new Proxy({}, { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('hostile')); rejected.catch(() => undefined);
    const hostile = [null, {}, Object.create(null), proxy, accessor, Promise.resolve(), rejected, { then() { observed += 1; } }];
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of hostile) {
        assert.equal(prepareAuthControlRetirement(value, 'web', 'lock'), null);
        assert.equal(commitPreparedAuthControlRetirement(value), 0);
        assert.equal(abortPreparedAuthControlRetirement(value), false);
    }
    const denied = control('denied').record; denied.begin('login', 'op', 'key', 'fp', 0);
    const deniedTicket = denied.prepareAuthControlTicket('denied', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(deniedTicket);
    const deniedActivation = prepareAuthControlActivation(deniedTicket, 'web'); assert.ok(deniedActivation); assert.equal(commitPreparedAuthControlActivation(deniedActivation), 1);
    const deniedPrepared = prepareAuthControlRetirement(deniedTicket, 'web', 'lock'); assert.ok(deniedPrepared);
    assert.equal(commitPreparedAuthControlRetirement(proxy), 0); assert.equal(commitPreparedAuthControlRetirement(deniedPrepared), 0);
    const record = control().record; record.begin('login', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(ticket);
    const activation = prepareAuthControlActivation(ticket, 'web'); assert.ok(activation); assert.equal(commitPreparedAuthControlActivation(activation), 1);
    const prepared = prepareAuthControlRetirement(ticket, 'web', 'lock'); assert.ok(prepared);
    const restarted = await freshModule('web-auth-retirement-restart');
    assert.equal(restarted.prepareAuthControlRetirement(ticket, 'web', 'lock'), null);
    assert.equal(restarted.commitPreparedAuthControlRetirement(prepared), 0);
    const fail = () => { throw new Error('ambient poison'); }; const get = WeakMap.prototype.get; const reflectApply = Reflect.apply;
    const thenDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try {
        WeakMap.prototype.get = fail as typeof get; Reflect.apply = fail as typeof Reflect.apply;
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get: fail });
        assert.equal(commitPreparedAuthControlRetirement(prepared), 2);
    } finally {
        WeakMap.prototype.get = get; Reflect.apply = reflectApply;
        if (thenDescriptor) Object.defineProperty(Object.prototype, 'then', thenDescriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    const terminal = record.snapshot(); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(unhandled, []); assert.deepEqual(record.snapshot(), terminal);
});

test('retirement preparation survives WeakMap reentry and apply-then-throw fail closed', async () => {
    const originalGet = WeakMap.prototype.get; let target = ''; let failAfterApply = false; let nested = () => undefined;
    WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
        if (target === 'get') { target = ''; nested(); }
        const result = Reflect.apply(originalGet, this, [key]);
        if (failAfterApply) { failAfterApply = false; throw new Error('apply-then-throw'); }
        return result;
    };
    let isolated: typeof import('./web-auth-control-record.ts');
    try { isolated = await freshModule('web-auth-retirement-weakmap'); } finally { WeakMap.prototype.get = originalGet; }
    const activate = (fence: string) => {
        const record = isolated.createWebAuthControlRecord(fence); record.begin('login', 'op', 'key', 'fp', 0);
        const ticket = record.prepareAuthControlTicket(fence, 'op', BigInt(0), 'fp', 'web', 1); assert.ok(ticket);
        const activation = isolated.prepareAuthControlActivation(ticket, 'web'); assert.ok(activation); assert.equal(isolated.commitPreparedAuthControlActivation(activation), 1);
        return { record, ticket };
    };
    const first = activate('first'); let nestedResult: unknown;
    target = 'get'; nested = () => { nestedResult = isolated.prepareAuthControlRetirement(first.ticket, 'web', 'lock'); };
    assert.equal(isolated.prepareAuthControlRetirement(first.ticket, 'web', 'lock'), null); assert.equal(nestedResult, null);
    assert.equal(isolated.retireAuthControlTicket(first.ticket, 'lock'), 0);
    const second = activate('second'); failAfterApply = true;
    assert.equal(isolated.prepareAuthControlRetirement(second.ticket, 'web', 'lock'), null);
    assert.equal(isolated.retireAuthControlTicket(second.ticket, 'lock'), 0);
    const retry = activate('retry'); const prepared = isolated.prepareAuthControlRetirement(retry.ticket, 'web', 'lock'); assert.ok(prepared);
    assert.equal(isolated.commitPreparedAuthControlRetirement(prepared), 2);
    const terminal = retry.record.snapshot(); await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(retry.record.snapshot(), terminal);
});

test('retires the exact active ticket once and exposes only same-reason replay', () => {
    const burned = control().record; burned.begin('setup', 'op', 'key', 'fp', 0);
    const burnedTicket = burned.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-1', 1); assert.ok(burnedTicket);
    assert.equal(retireAuthControlTicket(burnedTicket, 'unknown'), 0, 'every prepared retirement burns the ticket without changing authority');
    assert.equal(commitAuthControlTicket(burnedTicket), false);
    const { record } = control();
    record.begin('setup', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-1', 1);
    assert.ok(ticket);
    assert.equal(commitAuthControlTicket(ticket), true);
    const activeFence = record.snapshot().fence;
    assert.equal(retireAuthControlTicket(ticket, 'unknown'), 0);
    assert.deepEqual(record.snapshot(), { fence: activeFence, generation: BigInt(1), pending: false, active: true });
    assert.equal(retireAuthControlTicket(ticket, 'lock'), 1);
    assert.deepEqual(record.snapshot(), { fence: record.snapshot().fence, generation: BigInt(2), pending: false, active: false });
    assert.equal(retireAuthControlTicket(ticket, 'lock'), 2);
    assert.equal(retireAuthControlTicket(ticket, 'dispose'), 0);
    assert.equal(commitAuthControlTicket(ticket), false);
});

test('denies stale, expired, wrapped, restarted, and hostile tickets without observation', async (t) => {
    const stale = control().record;
    stale.begin('login', 'op', 'key', 'fp', 0);
    const staleTicket = stale.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1);
    assert.ok(staleTicket);
    assert.equal(stale.advanceLock('f0', 'lock', 'lock-fp', 'legacy-f1', 2).ok, true);
    assert.equal(commitAuthControlTicket(staleTicket), false);
    assert.equal(stale.snapshot().active, false);

    const expired = control().record; expired.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(expired.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 120_000), null);
    const nearWrap = control('near-max', MAX - BigInt(1)).record;
    nearWrap.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(nearWrap.prepareAuthControlTicket('near-max', 'op', MAX - BigInt(1), 'fp', 'web', 1), null);

    let observed = 0;
    const proxy = new Proxy({}, { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('hostile')); rejected.catch(() => undefined);
    const hostile = [null, undefined, {}, Object.create(null), proxy, accessor, Promise.resolve(), rejected, { then() { observed += 1; } }];
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (let index = 0; index < hostile.length; index += 1) {
        assert.equal(commitAuthControlTicket(hostile[index]), false);
        assert.equal(retireAuthControlTicket(hostile[index], 'lock'), 0);
    }
    const live = control().record; live.begin('login', 'op', 'key', 'fp', 0);
    const ticket = live.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(ticket);
    const clone = Object.assign(Object.create(null), ticket);
    assert.equal(commitAuthControlTicket(clone), false);
    const restarted = await freshModule('web-auth-restart');
    assert.equal(restarted.commitAuthControlTicket(ticket), false);
    assert.equal(commitAuthControlTicket(ticket), true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(unhandled, []);
});

test('keeps the ticket module private to its canonical future server-session importer', () => {
    assert.deepEqual(validateControlImports(repositoryTypeScript()).errors, []);
});

test('entropy collision and same-record reentry deny before ticket publication and permit a clean retry', async () => {
    const original = crypto.randomBytes; let calls = 0; let entered = false; let nested: unknown; let output: unknown;
    let record: ReturnType<typeof createWebAuthControlRecord> | null = null;
    try {
        crypto.randomBytes = (() => {
            calls += 1;
            if (!entered && record) { entered = true; nested = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); }
            if (output !== undefined) { if (output instanceof Error) throw output; return output; }
            return Buffer.alloc(32, calls <= 2 ? 7 : calls);
        }) as unknown as typeof crypto.randomBytes;
        const isolated = await freshModule('web-auth-entropy');
        const isolatedRecord = isolated.createWebAuthControlRecord('f0'); record = isolatedRecord; isolatedRecord.begin('login', 'op', 'key', 'fp', 0);
        assert.equal(isolatedRecord.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1), null);
        assert.equal(nested, null);
        const hostileToString = { toString() { throw new Error('must not encode'); } };
        for (output of [Buffer.alloc(31), Buffer.alloc(33), new Uint8Array(32), new Proxy(Buffer.alloc(32), {}), Promise.resolve(Buffer.alloc(32)), hostileToString, new Error('entropy')]) {
            assert.equal(isolatedRecord.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 2), null);
        }
        output = undefined;
        const retry = isolatedRecord.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 2);
        assert.ok(retry); assert.equal(isolated.commitAuthControlTicket(retry), true); assert.equal(isolated.retireAuthControlTicket(retry, 'lock'), 1);
    } finally { crypto.randomBytes = original; }
});

test('keeps lexical fence tables exact across WeakMap reentry and mutate-then-throw', async () => {
    const entropy = crypto.randomBytes; const weak = { get: WeakMap.prototype.get, set: WeakMap.prototype.set, delete: WeakMap.prototype.delete }; let entropyCalls = 0;
    let target = ''; let nested = () => {}; let failWeakSet = false; let failWeakDelete = false;
    const hook = (name: string, original: (...args: never[]) => unknown) => function (this: unknown, ...args: never[]) {
        if (target === name) { target = ''; nested(); } const result = Reflect.apply(original, this, args);
        if ((name === 'weakSet' && failWeakSet) || (name === 'weakDelete' && failWeakDelete)) throw new Error(`${name} failure`); return result;
    };
    WeakMap.prototype.get = hook('weakGet', weak.get) as typeof weak.get; WeakMap.prototype.set = hook('weakSet', weak.set) as typeof weak.set; WeakMap.prototype.delete = hook('weakDelete', weak.delete) as typeof weak.delete;
    crypto.randomBytes = (() => Buffer.alloc(32, entropyCalls++ % 2 === 0 ? 1 : 2)) as typeof crypto.randomBytes;
    let isolated: typeof import('./web-auth-control-record.ts');
    try { isolated = await freshModule('web-auth-collections'); }
    finally { WeakMap.prototype.get = weak.get; WeakMap.prototype.set = weak.set; WeakMap.prototype.delete = weak.delete; crypto.randomBytes = entropy; }
    const prepared = isolated.createWebAuthControlRecord('prepare'); prepared.begin('login', 'op', 'key', 'fp', 0);
    target = 'weakSet'; nested = () => { prepared.prepareAuthControlTicket('prepare', 'op', BigInt(0), 'fp', 'web', 1); }; assert.equal(prepared.prepareAuthControlTicket('prepare', 'op', BigInt(0), 'fp', 'web', 1), null);
    failWeakSet = true; failWeakDelete = true; assert.equal(prepared.prepareAuthControlTicket('prepare', 'op', BigInt(0), 'fp', 'web', 1), null); failWeakSet = false; failWeakDelete = false;
    assert.deepEqual(prepared.snapshot(), { fence: 'prepare', generation: BigInt(0), pending: true, active: false });
    const active = prepared.prepareAuthControlTicket('prepare', 'op', BigInt(0), 'fp', 'web', 2); assert.ok(active);
    target = 'weakGet'; nested = () => { isolated.commitAuthControlTicket(active); }; assert.equal(isolated.commitAuthControlTicket(active), false); assert.equal(isolated.commitAuthControlTicket(active), true);
    target = 'weakGet'; nested = () => { isolated.retireAuthControlTicket(active, 'lock'); }; assert.equal(isolated.retireAuthControlTicket(active, 'lock'), 0);
    assert.equal(isolated.retireAuthControlTicket(active, 'lock'), 1);
    const moduleUrl = new URL('./web-auth-control-record.ts', import.meta.url).href;
    execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `const m=await import(${JSON.stringify(moduleUrl)});const r=m.createWebAuthControlRecord('f');r.begin('login','op','key','fp',0);const t=r.prepareAuthControlTicket('f','op',0n,'fp','web',1);if(!t||!m.commitAuthControlTicket(t))process.exit(2);const d=Set.prototype.delete;Set.prototype.delete=function(...a){Reflect.apply(d,this,a);throw Error('mutate-then-throw')};let out;try{out=m.retireAuthControlTicket(t,'lock')}finally{Set.prototype.delete=d}if(out!==1)process.exit(3);`]);
    const terminal = prepared.snapshot(); await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(prepared.snapshot(), terminal);
});
