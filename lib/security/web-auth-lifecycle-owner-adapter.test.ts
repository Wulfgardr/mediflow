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
const installedOwner = requireFromHere('@mediflow/web-auth-lifecycle-owner') as Record<string, (...args: unknown[]) => unknown>;

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
    assert.doesNotMatch(source, /owner\s+as\s+typeof|withCurrentResourceBinding\s*:\s*\{/u);
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
    const control = installedOwner.bootstrapControl();
    assert.ok(control && typeof control === 'object');
    const transport = control as { controlId: string; etag: string };
    const attempt = installedOwner.begin('login', {
        controlId: transport.controlId,
        ifMatch: transport.etag,
        idempotencyKey: `synthetic-h6-web-binding-${suffix}`,
    });
    assert.ok(attempt);
    const issued = installedOwner.issue(attempt, {
        id: userId,
        username: `synthetic-${suffix}`,
        role: 'admin',
    });
    assert.ok(issued && typeof issued === 'object');
    const session = issued as { sessionId: string };
    const resolved = installedOwner.resolve(session.sessionId, transport.controlId);
    assert.ok(resolved && typeof resolved === 'object');
    const resolution = resolved as { status: string; projection?: object };
    assert.equal(resolution.status, 'active');
    assert.ok(resolution.projection);
    return resolution.projection;
}

test('installed owner emits one fieldless authentication generation for the exact active cell', () => {
    const firstSession = issueSourceSession('synthetic-h6-principal', 'first');
    const firstPort = installedOwner.mintResourcePort(firstSession);
    const siblingPort = installedOwner.mintResourcePort(firstSession);
    assert.ok(firstPort); assert.ok(siblingPort);

    const bindings: Array<Record<string, unknown>> = [];
    for (const port of [firstPort, siblingPort]) {
        const use = installedOwner.beginResourceUse(port);
        assert.ok(use);
        assert.equal(installedOwner.withCurrentResourceBinding(use, (binding: Record<string, unknown>) => {
            bindings.push(binding);
        }), true);
        assert.equal(installedOwner.commitResourceUse(use), true);
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
    const replacementPort = installedOwner.mintResourcePort(replacementSession);
    const replacementUse = installedOwner.beginResourceUse(replacementPort);
    const replacementBindings: Array<Record<string, unknown>> = [];
    assert.equal(installedOwner.withCurrentResourceBinding(replacementUse, (binding: Record<string, unknown>) => {
        replacementBindings.push(binding);
    }), true);
    assert.equal(installedOwner.commitResourceUse(replacementUse), true);
    const replacementBinding = replacementBindings[0];
    assert.ok(replacementBinding);
    assert.notEqual(replacementBinding.authenticationGeneration, bindings[0]!.authenticationGeneration);
});

test('installed owner binding port denies foreign, asynchronous, and reentrant resource uses', async () => {
    const session = issueSourceSession('synthetic-h6-denial', 'denial');
    const port = installedOwner.mintResourcePort(session);
    const foreign = Object.freeze(Object.create(null));
    let calls = 0;
    assert.equal(installedOwner.withCurrentResourceBinding(foreign, () => { calls += 1; }), false);
    assert.equal(calls, 0);

    const asynchronousUse = installedOwner.beginResourceUse(port);
    assert.ok(asynchronousUse);
    assert.equal(installedOwner.withCurrentResourceBinding(asynchronousUse, async () => { calls += 1; }), false);
    assert.equal(calls, 0);
    assert.equal(installedOwner.abortResourceUse(asynchronousUse), true);

    const reentrantUse = installedOwner.beginResourceUse(port);
    assert.ok(reentrantUse);
    assert.equal(installedOwner.withCurrentResourceBinding(reentrantUse, () => {
        calls += 1;
        assert.equal(installedOwner.commitResourceUse(reentrantUse), false);
    }), false);
    assert.equal(calls, 1);
    assert.equal(installedOwner.abortResourceUse(reentrantUse), true);
    await Promise.resolve();
});
