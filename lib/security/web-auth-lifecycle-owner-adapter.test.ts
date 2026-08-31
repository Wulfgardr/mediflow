/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const ADAPTER_FILE = 'web-auth-lifecycle-owner-adapter.ts';
const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const parse = (file: string, source: string) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

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
        'abortResourceUse', 'registerPrivateResource', 'unregisterPrivateResource',
    ]) {
        assert.match(source, new RegExp(`export function ${name}\\b[\\s\\S]*?owner\\.${name}\\(`, 'u'), name);
    }
    assert.doesNotMatch(source, /\b(?:let|var|new\s|Object\.create|Object\.freeze)\b/u);
});
