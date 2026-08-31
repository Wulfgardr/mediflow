/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const ADAPTER_FILE = 'web-auth-lifecycle-owner-adapter.ts';
const BRIDGE_FILE = 'web-auth-lifecycle-owner-legacy.ts';
const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const parse = (file: string, source: string) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function runtimeImports(sourceFile: ts.SourceFile): ts.ImportDeclaration[] {
    return sourceFile.statements.filter((statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly !== true);
}

test('keeps one server-only adapter import and one historical bridge import', () => {
    const source = read(ADAPTER_FILE);
    const imports = runtimeImports(parse(ADAPTER_FILE, source));
    assert.deepEqual(imports.map((item) => (item.moduleSpecifier as ts.StringLiteral).text), [
        'server-only', './web-auth-lifecycle-owner-legacy',
    ]);
    assert.match(source, /import \* as legacy from ['"]\.\/web-auth-lifecycle-owner-legacy['"]/u);
    assert.match(source, /lifecycleOwnerAdapterState = ['"]legacy_bridge_pre_cutover['"]/u);
    assert.doesNotMatch(source, /\b(?:Map|WeakMap|Set|globalThis|process|generation|cache|selector|native|system)\b/u);
});

test('exposes only stateless delegation and explicit pre-cutover denials', () => {
    const source = read(ADAPTER_FILE);
    for (const name of [
        'begin', 'issue', 'abort', 'resolve', 'retire', 'retireForUser',
        'mintResourcePort', 'releaseResourcePort', 'beginResourceUse', 'commitResourceUse',
        'abortResourceUse', 'registerPrivateResource', 'unregisterPrivateResource',
    ]) {
        assert.match(source, new RegExp(`export function ${name}\\b[\\s\\S]*?legacy\\.${name}\\(`, 'u'), name);
    }
    assert.match(source, /export function prepareAdminReset[\s\S]*?return null;/u);
    assert.match(source, /export function commitAdminReset[\s\S]*?return false;/u);
    assert.match(source, /export function abortAdminReset[\s\S]*?return false;/u);
    assert.match(source, /lifecycleOwnerAdapterResolutionGap = ['"][^'"]+['"]/u);
    assert.match(source, /lifecycleOwnerAdapterAdminResetGap = ['"][^'"]+['"]/u);
});

test('keeps the historical bridge free of owner state and native/system imports', () => {
    const source = read(BRIDGE_FILE);
    const imports = runtimeImports(parse(BRIDGE_FILE, source));
    assert.deepEqual(imports.map((item) => (item.moduleSpecifier as ts.StringLiteral).text), [
        'node:util', './web-auth-session-issuer', './server-session',
    ]);
    assert.doesNotMatch(source, /\b(?:Map|WeakMap|Set|globalThis|process|generation|cache)\b/u);
    assert.doesNotMatch(source, /\b(?:createNativeServerSession|isPairedNativeServerSession|nativeOwner|systemOwner)\b/u);
    assert.doesNotMatch(source, /\b(?:let|var)\b/u);
    assert.match(source, /current === value/u);
    assert.match(source, /dispatchActiveWebServerSessionRetirement\(current\.id, reason\)/u);
    assert.match(source, /retireWebP3SessionsForUser\(current\.userId\)/u);
});
