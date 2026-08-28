/* @Codex */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const CONTROL_RECORD = ['web-auth-control', '-record'].join('');

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
    try { return await import(pathToFileURL(join(directory, 'web-auth-session-issuer.ts')).href); }
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
    assert.equal(typeof (issuer as { issue?: unknown }).issue, 'undefined');
});

test('rejects hostile, cloned, foreign, and cross-module capabilities without traps', async () => {
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
    assert.equal(first.abort(attempt), true);
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
    } finally { Date.now = originalNow; }

    const originalSet = WeakMap.prototype.set;
    let calls = 0;
    let throwAfterApply = false;
    WeakMap.prototype.set = function (...args: Parameters<typeof originalSet>) {
        const result = Reflect.apply(originalSet, this, args);
        if (throwAfterApply && ++calls === 2) throw new Error('synthetic apply then throw');
        return result;
    };
    try {
        issuer = await fresh('p3b1-weakmap');
        calls = 0; throwAfterApply = true;
        assert.equal(issuer.begin('login'), null);
        throwAfterApply = false;
        const retry = issuer.begin('setup');
        assert.ok(retry);
        assert.equal(issuer.abort(retry), true);
    } finally { WeakMap.prototype.set = originalSet; }
});

test('keeps P3b1 below the boundary: opaque lifecycle only, no session activation imports', () => {
    const source = readFileSync(new URL('./web-auth-session-issuer.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /server-session|stageWebServerSession|prepareStaged|armPrepared|activatePrepared|sessionId|route|cookie|provider|native|database|globalThis/iu);
    assert.doesNotMatch(source, /\bawait\b|\bPromise\b|export function issue\b/u);
    assert.match(source, /beginWebAuth/u);
    assert.match(source, /cancelWebAuth/u);
});
