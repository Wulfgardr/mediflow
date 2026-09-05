/* @Codex */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const CONTROL_RECORD = ['web-auth-control', '-record'].join('');
const USER = Object.freeze({ id: 'synthetic-web-issuer-user', username: ['synthetic', 'clinician'].join('-'), role: 'clinician' });

async function fresh(label: string) {
    const directory = mkdtempSync(join(tmpdir(), `mediflow-${label}-`));
    const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
    writeFileSync(join(directory, `${CONTROL_RECORD}.ts`), read(`${CONTROL_RECORD}.ts`));
    writeFileSync(join(directory, 'server-session.ts'), read('server-session.ts')
        .replace("import 'server-only';", '')
        .replace(`from './${CONTROL_RECORD}';`, `from './${CONTROL_RECORD}.ts';`));
    writeFileSync(join(directory, 'web-auth-control-owner.ts'), read('web-auth-control-owner.ts')
        .replace(`from './${CONTROL_RECORD}';`, `from './${CONTROL_RECORD}.ts';`)
        .replace("from './server-session';", "from './server-session.ts';"));
    writeFileSync(join(directory, 'web-auth-session-issuer.ts'), read('web-auth-session-issuer.ts')
        .replace("from './web-auth-control-owner';", "from './web-auth-control-owner.ts';"));
    try {
        const issuer = await import(pathToFileURL(join(directory, 'web-auth-session-issuer.ts')).href);
        const session = await import(pathToFileURL(join(directory, 'server-session.ts')).href);
        return { ...issuer, session };
    }
    finally { rmSync(directory, { recursive: true, force: true }); }
}

function opaque(value: unknown): void {
    assert.ok(value);
    assert.equal(Object.getPrototypeOf(value), null);
    assert.deepEqual(Object.keys(value as object), []);
    assert.equal(Object.isFrozen(value), true);
}

test('mints one opaque login/setup attempt, burns it once, and leaves no second success', async () => {
    const issuer = await fresh('p3b1-lifecycle');
    assert.equal(issuer.begin('other'), null);
    const attempt = issuer.begin('login');
    opaque(attempt);
    assert.equal(issuer.begin('setup'), null);
    assert.equal(issuer.abort(attempt), true);
    assert.equal(issuer.abort(attempt), false);
    assert.equal(issuer.abort(Object.freeze({})), false);
    const retry = issuer.begin('setup');
    opaque(retry);
    assert.equal(issuer.abort(retry), true);
    assert.equal(typeof (issuer as { issue?: unknown }).issue, 'function');
});

test('burns an exact data-only issue at the historical fail-closed activation splice', async () => {
    const stack = await fresh('p3b2-issue'); const attempt = stack.begin('login'); assert.ok(attempt);
    const result = stack.issue(attempt, USER); assert.equal(result, null);
    assert.equal(stack.issue(attempt, USER), null);
    const retry = stack.begin('setup'); assert.ok(retry, 'terminal historical denial leaves the dormant island retryable');
    assert.equal(stack.abort(retry), true);
});

test('burns issue before hostile input and leaves owner control retryable', async () => {
    const stack = await fresh('p3b2-hostile'); const attempt = stack.begin('login'); assert.ok(attempt); let reads = 0;
    const hostile = new Proxy({}, { get() { reads += 1; throw new Error('synthetic'); }, ownKeys() { reads += 1; throw new Error('synthetic'); } });
    assert.equal(stack.issue(attempt, hostile), null); assert.equal(reads, 0);
    const retry = stack.begin('setup'); assert.ok(retry); assert.equal(stack.abort(retry), true);
});

test('rejects hostile, cloned, foreign, and cross-module capabilities without publishing authority', async () => {
    const first = await fresh('p3b1-first');
    const second = await fresh('p3b1-second');
    const attempt = first.begin('login');
    assert.ok(attempt);
    const traps = { count: 0 };
    const hostile = new Proxy({}, { get() { traps.count += 1; throw new Error('synthetic trap'); }, ownKeys() { traps.count += 1; throw new Error('synthetic trap'); } });
    for (const value of [null, Symbol('synthetic'), Object.freeze({}), Object.freeze({ ...attempt }), hostile]) {
        assert.equal(first.abort(value), false);
        assert.equal(second.abort(value), false);
    }
    assert.equal(traps.count, 0);
    assert.equal(second.abort(attempt), false);
    assert.equal(second.issue(attempt, USER), null); assert.equal(first.issue(attempt, USER), null);
    const retry = first.begin('setup'); assert.ok(retry); assert.equal(first.abort(retry), true);
});

test('poisons owner reentry and rolls back an issuer WeakMap apply-then-throw', async () => {
    const originalNow = Date.now;
    let issuer: Awaited<ReturnType<typeof fresh>>;
    let nested: unknown;
    let trigger = false;
    Date.now = (() => {
        const value = originalNow();
        if (trigger) { trigger = false; nested = issuer.begin('setup'); }
        return value;
    }) as typeof Date.now;
    try {
        issuer = await fresh('p3b1-reentry');
        trigger = true;
        assert.equal(issuer.begin('login'), null);
        assert.equal(nested, null);
        const retry = issuer.begin('setup');
        assert.ok(retry);
        assert.equal(issuer.abort(retry), true);

        const stack = await fresh('p3b2-issue-reentry'); issuer = stack; const attempt = issuer.begin('login'); assert.ok(attempt);
        trigger = true; assert.equal(issuer.issue(attempt, USER), null); assert.equal(nested, null); trigger = false;
        const clean = issuer.begin('setup'); assert.ok(clean); assert.equal(issuer.abort(clean), true);
    } finally { Date.now = originalNow; }

    const originalSet = WeakMap.prototype.set;
    let beginCalls = 0;
    let throwAfterApply = false;
    WeakMap.prototype.set = function (...args: Parameters<typeof originalSet>) {
        const result = Reflect.apply(originalSet, this, args);
        if (throwAfterApply && ++beginCalls === 2) throw new Error('synthetic apply then throw');
        return result;
    };
    try {
        issuer = await fresh('p3b1-weakmap');
        beginCalls = 0; throwAfterApply = true;
        assert.equal(issuer.begin('login'), null);
        throwAfterApply = false;
        const retry = issuer.begin('setup');
        assert.ok(retry);
        assert.equal(issuer.abort(retry), true);
    } finally { WeakMap.prototype.set = originalSet; }

    const originalDelete = WeakMap.prototype.delete; let failDelete = false;
    WeakMap.prototype.delete = function (...args: Parameters<typeof originalDelete>) {
        const result = Reflect.apply(originalDelete, this, args); if (failDelete) { failDelete = false; throw new Error('synthetic apply then throw'); } return result;
    };
    try {
        const stack = await fresh('p3b2-weakmap-delete'); failDelete = true; const attempt = stack.begin('login'); assert.ok(attempt);
        assert.equal(stack.issue(attempt, USER), null); const retry = stack.begin('setup'); assert.ok(retry); assert.equal(stack.abort(retry), true);
    } finally { WeakMap.prototype.delete = originalDelete; }

    const stageSet = WeakMap.prototype.set; let calls = 0; let target = 0; let failSet = false;
    WeakMap.prototype.set = function (...args: Parameters<typeof stageSet>) {
        const result = Reflect.apply(stageSet, this, args); if (failSet && ++calls === target) throw new Error('synthetic apply then throw'); return result;
    };
    try {
        for (target of [3, 4, 5, 6, 7]) { const stack = await fresh(`p3b2-set-${target}`); calls = 0; failSet = true; const attempt = stack.begin('login'); assert.ok(attempt); assert.equal(stack.issue(attempt, USER), null); failSet = false; const retry = stack.begin('setup'); assert.ok(retry); assert.equal(stack.abort(retry), true); }
    } finally { WeakMap.prototype.set = stageSet; }
});

test('keeps P3b2 synchronous and outside route, cookie, and provider authority', () => {
    const source = readFileSync(new URL('./web-auth-session-issuer.ts', import.meta.url), 'utf8');
    assert.match(source, /stageWebServerSession|prepareStaged|armPrepared|activatePrepared/u);
    assert.doesNotMatch(source, /route|cookie|provider|native|database|globalThis|\bawait\b|\bPromise\b/iu);
    assert.match(source, /export function issue\b/u);
});
