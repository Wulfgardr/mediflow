/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const ADAPTER_FILE = 'web-auth-lifecycle-owner-adapter.ts';
const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const parse = (file: string, source: string) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const requireFromHere = createRequire(import.meta.url);
const sourceOwner = requireFromHere('../../packages/web-auth-lifecycle-owner/index.js') as Record<string, (...args: unknown[]) => unknown>;

function runtimeImports(sourceFile: ts.SourceFile): ts.ImportDeclaration[] {
    return sourceFile.statements.filter((statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly !== true);
}

test('loads only server-only and the one external owner package', () => {
    const source = read(ADAPTER_FILE);
    const imports = runtimeImports(parse(ADAPTER_FILE, source));
    assert.deepEqual(imports.map((item) => (item.moduleSpecifier as ts.StringLiteral).text), [
        'server-only', '@mediflow/web-auth-lifecycle-owner',
    ]);
    assert.match(source, /import \* as owner from ['"]@mediflow\/web-auth-lifecycle-owner['"]/u);
    assert.match(source, /lifecycleOwnerAdapterState = ['"]external_owner_active['"]/u);
    assert.doesNotMatch(source, /web-auth-lifecycle-owner-legacy|legacy_bridge|dormant_prepared/u);
    assert.doesNotMatch(source, /\b(?:Map|WeakMap|Set|globalThis|process|generation|cache|selector|native|system)\b/u);
});

test('delegates the complete frozen root surface without local authority state', () => {
    const source = read(ADAPTER_FILE);
    for (const name of [
        'bootstrapControl', 'begin', 'issue', 'abort', 'resolve', 'retire', 'retireForUser',
        'prepareUserRetirement', 'commitUserRetirement', 'abortUserRetirement',
        'prepareAdminReset', 'commitAdminReset', 'abortAdminReset',
        'mintResourcePort', 'releaseResourcePort', 'beginResourceUse', 'commitResourceUse',
        'abortResourceUse', 'withCurrentResourceBinding', 'registerPrivateResource',
        'unregisterPrivateResource',
    ]) {
        const directDelegate = new RegExp(`export function ${name}\\b[\\s\\S]*?owner\\.${name}\\(`, 'u');
        const typedDelegate = new RegExp(`export function ${name}\\b[\\s\\S]*?\\)\\.${name}\\(`, 'u');
        assert.equal(directDelegate.test(source) || typedDelegate.test(source), true, name);
    }
    assert.doesNotMatch(source, /\b(?:let|var|new\s|Object\.create|Object\.freeze)\b/u);
});

function issueSourceSession(userId: string, suffix: string) {
    const control = sourceOwner.bootstrapControl();
    assert.ok(control && typeof control === 'object');
    const transport = control as { controlId: string; etag: string };
    const attempt = sourceOwner.begin('login', {
        controlId: transport.controlId,
        ifMatch: transport.etag,
        idempotencyKey: `synthetic-h6-web-binding-${suffix}`,
    });
    assert.ok(attempt);
    const issued = sourceOwner.issue(attempt, {
        id: userId,
        username: `synthetic-${suffix}`,
        role: 'admin',
    });
    assert.ok(issued && typeof issued === 'object');
    const session = issued as { sessionId: string };
    const resolved = sourceOwner.resolve(session.sessionId, transport.controlId);
    assert.ok(resolved && typeof resolved === 'object');
    const resolution = resolved as { status: string; projection?: object };
    assert.equal(resolution.status, 'active');
    assert.ok(resolution.projection);
    return resolution.projection;
}

test('source owner emits one fieldless authentication generation for the exact active cell', () => {
    const firstSession = issueSourceSession('synthetic-h6-principal', 'first');
    const firstPort = sourceOwner.mintResourcePort(firstSession);
    const siblingPort = sourceOwner.mintResourcePort(firstSession);
    assert.ok(firstPort); assert.ok(siblingPort);

    const bindings: Array<Record<string, unknown>> = [];
    for (const port of [firstPort, siblingPort]) {
        const use = sourceOwner.beginResourceUse(port);
        assert.ok(use);
        assert.equal(sourceOwner.withCurrentResourceBinding(use, (binding: Record<string, unknown>) => {
            bindings.push(binding);
        }), true);
        assert.equal(sourceOwner.commitResourceUse(use), true);
    }

    assert.equal(bindings.length, 2);
    for (const binding of bindings) {
        assert.equal(Object.getPrototypeOf(binding), null);
        assert.equal(Object.isFrozen(binding), true);
        assert.deepEqual(Reflect.ownKeys(binding), ['principalRef', 'authenticationGeneration']);
        assert.equal(binding.principalRef, 'synthetic-h6-principal');
        const identity = binding.authenticationGeneration as object;
        assert.equal(Object.getPrototypeOf(identity), null);
        assert.equal(Object.isFrozen(identity), true);
        assert.deepEqual(Reflect.ownKeys(identity), []);
    }
    assert.equal(bindings[0]!.authenticationGeneration, bindings[1]!.authenticationGeneration);

    const replacementSession = issueSourceSession('synthetic-h6-principal', 'replacement');
    const replacementPort = sourceOwner.mintResourcePort(replacementSession);
    const replacementUse = sourceOwner.beginResourceUse(replacementPort);
    const replacementBindings: Array<Record<string, unknown>> = [];
    assert.equal(sourceOwner.withCurrentResourceBinding(replacementUse, (binding: Record<string, unknown>) => {
        replacementBindings.push(binding);
    }), true);
    assert.equal(sourceOwner.commitResourceUse(replacementUse), true);
    const replacementBinding = replacementBindings[0];
    assert.ok(replacementBinding);
    assert.notEqual(replacementBinding.authenticationGeneration, bindings[0]!.authenticationGeneration);
});

test('source owner binding port denies foreign, asynchronous, and reentrant resource uses', async () => {
    const session = issueSourceSession('synthetic-h6-denial', 'denial');
    const port = sourceOwner.mintResourcePort(session);
    const foreign = Object.freeze(Object.create(null));
    let calls = 0;
    assert.equal(sourceOwner.withCurrentResourceBinding(foreign, () => { calls += 1; }), false);
    assert.equal(calls, 0);

    const asynchronousUse = sourceOwner.beginResourceUse(port);
    assert.ok(asynchronousUse);
    assert.equal(sourceOwner.withCurrentResourceBinding(asynchronousUse, async () => { calls += 1; }), false);
    assert.equal(calls, 0);
    assert.equal(sourceOwner.abortResourceUse(asynchronousUse), true);

    const reentrantUse = sourceOwner.beginResourceUse(port);
    assert.ok(reentrantUse);
    assert.equal(sourceOwner.withCurrentResourceBinding(reentrantUse, () => {
        calls += 1;
        assert.equal(sourceOwner.commitResourceUse(reentrantUse), false);
    }), false);
    assert.equal(calls, 1);
    assert.equal(sourceOwner.abortResourceUse(reentrantUse), true);
    await Promise.resolve();
});
