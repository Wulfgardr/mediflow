/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const ADAPTER_FILE = 'web-auth-lifecycle-owner-adapter.ts';
const EXPECTED_SOURCE = "import 'server-only';\nexport const lifecycleOwnerAdapterState = 'dormant_prepared' as const;\nexport type LifecycleOwnerAdapterState = typeof lifecycleOwnerAdapterState;";
const printAst = (source: string) => ts.createPrinter({ removeComments: true }).printFile(
    ts.createSourceFile(ADAPTER_FILE, source, ts.ScriptTarget.Latest, true),
);

test('keeps the lifecycle owner adapter at the exact dormant server-only boundary', () => {
    const source = readFileSync(new URL(`./${ADAPTER_FILE}`, import.meta.url), 'utf8');
    assert.equal(printAst(source), printAst(EXPECTED_SOURCE));
});
