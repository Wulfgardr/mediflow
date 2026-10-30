import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as values from './settings-value';
import { sanitizeAIInsightManualConfig } from './ai-insight-settings';

function route() {
    const writes: unknown[] = [], audits: unknown[] = [];
    const module = { exports: {} as { PUT: (request: Request, context: unknown) => Promise<Response>; GET: (request: Request, context: unknown) => Promise<Response> } };
    const imports: Record<string, unknown> = {
        '@/lib/backup-restore-receipt-contract': { RESTORE_RECEIPT_PREFIX: 'restore.' },
        '@/lib/ai-providers/fabric/function-model-settings-write': { writeSettingWithFunctionModelGeneration: (...args: unknown[]) => writes.push(args) },
        '@/lib/security/archive-write-request': { archiveWriteRequestDenial: () => null },
        'next/server': { NextResponse: Response },
        '@/lib/db-server': { dbServer: { select: () => ({ from: () => ({ where: () => ({ get: () => ({ key: 'aiInsightManualConfig', value: '{"maxDocuments":99}' }) }) }) }) } },
        '@/lib/schema': { settings: { key: 'key' } }, 'drizzle-orm': { eq: () => null },
        '@/lib/security/server-auth': { requireSessionOrLocalToken: async () => ({ role: 'doctor' }) },
        '@/lib/security/audit': { auditContextFromRequest: () => ({}), listChangedFields: () => [], requestIdFromRequest: () => 'synthetic', withAuditContextMetadata: () => ({}), writeAuditEvent: async (value: unknown) => { audits.push(value); } },
        '@/lib/settings-value': values,
        '@/lib/security/settings-write-policy': { evaluateSettingsWrite: () => ({ allowed: true }) },
    };
    const compiled = ts.transpileModule(readFileSync('app/api/settings/[key]/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    runInNewContext(compiled.outputText, { module, exports: module.exports, console, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } });
    return { ...module.exports, writes, audits };
}
const budget = { maxDocuments: 6, maxDocumentSummaryChars: 260, maxDocumentContextChars: 2200, outputMaxTokens: 512 };
const invalid: [string, unknown][] = [
    ...['invalid', '', null, {}, 1].map(value => ['aiInsightMode', value] as [string, unknown]),
    ...['automatic', '', null, {}, false].map(value => ['documentRouterControlFlow', value] as [string, unknown]),
    ...[null, [], {}, 'broken', 'null', { ...budget, extra: 1 }].map(value => ['aiInsightManualConfig', value] as [string, unknown]),
];
for (const [field, min, max] of [['maxDocuments', 2, 12], ['maxDocumentSummaryChars', 120, 480], ['maxDocumentContextChars', 800, 5000], ['outputMaxTokens', 256, 1200]] as const) {
    for (const value of [min - 1, max + 1, min + 0.5, String(min), null]) {
        invalid.push(['aiInsightManualConfig', { ...budget, [field]: value }]);
        invalid.push(['aiInsightManualConfig', JSON.stringify({ ...budget, [field]: value })]);
    }
}
for (const [key, value] of invalid) test(`reject ${key} ${JSON.stringify(value)} before writer and audit`, async () => {
    const f = route();
    const result = await f.PUT(new Request('http://localhost/api/settings/' + key, { method: 'PUT', body: JSON.stringify({ value }) }), { params: Promise.resolve({ key }) });
    assert.equal(result.status, 400);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.audits, []);
});
for (const [key, value] of [ ...['full_auto', 'balanced', 'complete', 'manual'].map(v => ['aiInsightMode', v]), ...['off', 'shadow', 'active'].map(v => ['documentRouterControlFlow', v]), ['aiInsightManualConfig', budget], ['aiInsightManualConfig', JSON.stringify(budget)], ['unrelated', 'unchanged'] ] as [string, unknown][]) test(`accept ${key} ${JSON.stringify(value)}`, async () => {
    const f = route();
    assert.equal((await f.PUT(new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ value }) }), { params: Promise.resolve({ key }) })).status, 200);
    assert.equal(f.writes.length, 1); assert.equal(f.audits.length, 1);
});
test('existing out of range settings remain readable and runtime clamps without writing', async () => {
    const f = route();
    const response = await f.GET(new Request('http://localhost'), { params: Promise.resolve({ key: 'aiInsightManualConfig' }) });
    assert.equal(response.status, 200);
    const row = await response.json();
    assert.equal(row.value, '{"maxDocuments":99}');
    assert.equal(sanitizeAIInsightManualConfig(JSON.parse(row.value)).maxDocuments, 12);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.audits, []);
});
