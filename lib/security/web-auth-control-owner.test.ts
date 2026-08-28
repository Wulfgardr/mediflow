/* @Codex */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

async function fresh(label: string) {
    const directory = mkdtempSync(join(tmpdir(), `mediflow-${label}-`));
    const ownerSource = readFileSync(new URL('./web-auth-control-owner.ts', import.meta.url), 'utf8').replace("from './web-auth-control-record';", "from './web-auth-control-record.ts';");
    writeFileSync(join(directory, 'web-auth-control-owner.ts'), ownerSource); writeFileSync(join(directory, 'web-auth-control-record.ts'), readFileSync(new URL('./web-auth-control-record.ts', import.meta.url)));
    try { return await import(pathToFileURL(join(directory, 'web-auth-control-owner.ts')).href); } finally { rmSync(directory, { recursive: true, force: true }); }
}
function opaque(value: unknown): void { assert.ok(value); assert.equal(Object.getPrototypeOf(value), null); assert.deepEqual(Object.keys(value as object), []); assert.equal(Object.isFrozen(value), true); }

test('mints one opaque owner attempt and serializes login/setup through one record', async () => {
    const owner = await fresh('owner-basic'); const attempt = owner.beginWebAuth('login'); opaque(attempt);
    assert.equal(owner.beginWebAuth('setup'), null);
    const activation = owner.prepareWebAuthActivation(attempt, 'web-synthetic'); opaque(activation);
    assert.equal(owner.finishWebAuth(attempt, activation), true); assert.equal(owner.finishWebAuth(attempt, activation), false); assert.equal(owner.cancelWebAuth(attempt), false);
    assert.equal(owner.beginWebAuth('setup'), null, 'ACTIVE control cannot mint a second attempt');
});

test('cancels pending and prepared attempts without exposing control metadata', async () => {
    const owner = await fresh('owner-cancel'); const first = owner.beginWebAuth('login'); assert.ok(first);
    assert.equal(owner.cancelWebAuth(first), true); assert.equal(owner.cancelWebAuth(first), false); assert.equal(owner.prepareWebAuthActivation(first, 'web'), null);
    const second = owner.beginWebAuth('setup'); assert.ok(second); assert.equal(owner.prepareWebAuthActivation(second, {}), null);
    const ticket = owner.prepareWebAuthActivation(second, 'web-2'); assert.ok(ticket); assert.equal(owner.cancelWebAuth(second), true); assert.equal(owner.finishWebAuth(second, ticket), false);
    assert.ok(owner.beginWebAuth('login'));
});

test('binds finish to the exact attempt, module, session ticket, and restart realm', async () => {
    const owner = await fresh('owner-binding'); const attempt = owner.beginWebAuth('login'); assert.ok(attempt);
    const ticket = owner.prepareWebAuthActivation(attempt, 'web-a'); assert.ok(ticket);
    const foreign = await fresh('owner-foreign'); assert.equal(foreign.finishWebAuth(attempt, ticket), false); assert.equal(foreign.cancelWebAuth(attempt), false);
    assert.equal(owner.finishWebAuth(Object.freeze({}), ticket), false); assert.equal(owner.finishWebAuth(attempt, Object.freeze({})), false);
    assert.equal(owner.finishWebAuth(attempt, ticket), true);
});

test('stale cancellation and ABA cannot finish an old ticket or clear a new attempt', async () => {
    const owner = await fresh('owner-aba'); const oldAttempt = owner.beginWebAuth('login'); assert.ok(oldAttempt);
    const oldTicket = owner.prepareWebAuthActivation(oldAttempt, 'web-old'); assert.ok(oldTicket); assert.equal(owner.cancelWebAuth(oldAttempt), true); assert.equal(owner.finishWebAuth(oldAttempt, oldTicket), false);
    const replacement = owner.beginWebAuth('login'); assert.ok(replacement); assert.equal(owner.finishWebAuth(oldAttempt, oldTicket), false); assert.equal(owner.cancelWebAuth(replacement), true);
});

test('fails closed on hostile values, entropy failure, collision, and unhandled rejection', async (t) => {
    const owner = await fresh('owner-hostile'); const attempt = owner.beginWebAuth('login'); assert.ok(attempt); let observed = 0;
    const proxy = new Proxy({}, { get() { observed += 1; throw new Error('trap'); }, ownKeys() { observed += 1; throw new Error('trap'); } }); const rejected = Promise.reject(new Error('synthetic')); rejected.catch(() => undefined);
    for (const value of [proxy, rejected, { then: proxy }, Symbol('x'), null]) { assert.equal(owner.prepareWebAuthActivation(value, 'web'), null); assert.equal(owner.finishWebAuth(attempt, value), false); assert.equal(owner.cancelWebAuth(value), false); }
    assert.equal(observed, 0);
    const original = crypto.randomBytes; try { crypto.randomBytes = () => { throw new Error('entropy'); }; const denied = await fresh('owner-entropy-failure'); assert.equal(denied.beginWebAuth('login'), null); } finally { crypto.randomBytes = original; }
    try { crypto.randomBytes = () => Buffer.alloc(32, 7); const collision = await fresh('owner-entropy-collision'); const first = collision.beginWebAuth('login'); assert.ok(first); assert.equal(collision.cancelWebAuth(first), true); assert.equal(collision.beginWebAuth('setup'), null); } finally { crypto.randomBytes = original; }
    await new Promise<void>((resolve) => setImmediate(resolve)); t.diagnostic(`hostile observations=${observed}`);
});

test('serializes entropy reentry and recovers after WeakMap apply-then-throw', async () => {
    const random = crypto.randomBytes; let owner: Awaited<ReturnType<typeof fresh>>; let entered = false; let nested: unknown;
    crypto.randomBytes = ((...args: Parameters<typeof random>) => { if (!entered && owner) { entered = true; nested = owner.beginWebAuth('setup'); } return Reflect.apply(random, crypto, args); }) as typeof random;
    try { owner = await fresh('owner-reentry'); assert.equal(owner.beginWebAuth('login'), null); assert.equal(nested, null); } finally { crypto.randomBytes = random; }
    assert.ok(owner!.beginWebAuth('login'));

    const set = WeakMap.prototype.set; let throwAfter = false;
    WeakMap.prototype.set = function (...args: Parameters<typeof set>) { const result = Reflect.apply(set, this, args); if (throwAfter) throw new Error('apply then throw'); return result; };
    try { const isolated = await fresh('owner-weakmap-set'); throwAfter = true; assert.equal(isolated.beginWebAuth('login'), null); throwAfter = false; assert.ok(isolated.beginWebAuth('login')); } finally { WeakMap.prototype.set = set; }
});

test('cancels record begin publication when captured Map hooks poison the owner turn', async (t) => {
    const originalGet = Map.prototype.get; const originalSet = Map.prototype.set;
    let owner: Awaited<ReturnType<typeof fresh>>; let armed: 'get' | 'set' | '' = ''; let nested: unknown;
    const reenter = (): void => { const mode = armed; if (!mode) return; armed = ''; nested = owner.beginWebAuth('setup'); };
    Map.prototype.get = function (...args: Parameters<typeof originalGet>) {
        const result = Reflect.apply(originalGet, this, args); if (armed === 'get') reenter(); return result;
    };
    Map.prototype.set = function (...args: Parameters<typeof originalSet>) {
        const result = Reflect.apply(originalSet, this, args); if (armed === 'set') reenter(); return result;
    };
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    try {
        owner = await fresh('owner-map-reentry');
        const baseline = owner.beginWebAuth('login'); assert.ok(baseline); assert.equal(owner.cancelWebAuth(baseline), true);
        for (let index = 0; index < 64; index += 1) {
            armed = index % 2 === 0 ? 'get' : 'set'; nested = undefined;
            assert.equal(owner.beginWebAuth('login'), null); assert.equal(nested, null, `nested denial missing at iteration ${index}`);
        }
        const clean = owner.beginWebAuth('login'); assert.ok(clean, 'failed owner turns cannot strand pending or idempotency capacity');
        assert.equal(owner.cancelWebAuth(clean), true);
    } finally { Map.prototype.get = originalGet; Map.prototype.set = originalSet; }
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
});

test('retries owner WeakMap get after reentry or apply-then-throw without residue', async () => {
    const get = WeakMap.prototype.get; let mode: 'reenter' | 'throw' | '' = ''; let owner: Awaited<ReturnType<typeof fresh>>; let attempt: unknown; let nested: unknown;
    WeakMap.prototype.get = function (...args: Parameters<typeof get>) { const result = Reflect.apply(get, this, args); if (mode === 'reenter') { mode = ''; nested = owner.prepareWebAuthActivation(attempt, 'nested'); } else if (mode === 'throw') throw new Error('apply then throw'); return result; };
    try {
        owner = await fresh('owner-weakmap-get'); attempt = owner.beginWebAuth('login'); assert.ok(attempt); mode = 'reenter'; assert.equal(owner.prepareWebAuthActivation(attempt, 'web'), null); assert.equal(nested, null); mode = ''; const ticket = owner.prepareWebAuthActivation(attempt, 'web'); assert.ok(ticket); assert.equal(owner.cancelWebAuth(attempt), true);
        const retry = owner.beginWebAuth('login'); assert.ok(retry); mode = 'throw'; assert.equal(owner.cancelWebAuth(retry), false); mode = ''; assert.equal(owner.cancelWebAuth(retry), true);
    } finally { WeakMap.prototype.get = get; }
});

test('keeps the owner import ceiling and zero-field output explicit', async () => {
    const source = readFileSync(fileURLToPath(new URL('./web-auth-control-owner.ts', import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /server-session|route|cookie|database|provider|native|resolver|createServerSessionProjectionOwnerRegistry|\bMap\b/u);
    assert.match(source, /createWebAuthControlRecord/u); assert.match(source, /abortPreparedAuthControlTicket/u); assert.match(source, /commitAuthControlTicket/u);
});
