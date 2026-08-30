/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLegacyOcrRetirementSource } from './check-never-regress.mjs';

const canonicalRoute = `
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionOrLocalToken } from '@/lib/security/server-auth';
export async function POST(request: NextRequest) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json({ error: 'OCR extraction endpoint retired', code: 'OCR_EXTRACTION_RETIRED' }, { status: 410, headers: { 'cache-control': 'no-store' } });
}
export async function GET(request: NextRequest) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json({ error: 'OCR extraction endpoint retired', code: 'OCR_EXTRACTION_RETIRED' }, { status: 410, headers: { 'cache-control': 'no-store' } });
}
`;

test('accepts the closed authenticated OCR retirement route', () => {
    assert.deepEqual(validateLegacyOcrRetirementSource(canonicalRoute), []);
});

function injectBeforeRetirement(statement) {
    return canonicalRoute.replaceAll(
        "    return NextResponse.json({ error: 'OCR extraction endpoint retired'",
        `    ${statement}\n    return NextResponse.json({ error: 'OCR extraction endpoint retired'`,
    );
}

test('requires unaliased auth and awaited authentication as the first handler statement', () => {
    const cases = [
        canonicalRoute.replace(
            "import { requireSessionOrLocalToken } from '@/lib/security/server-auth';",
            "import { requireSessionOrLocalToken as auth } from '@/lib/security/server-auth';",
        ),
        canonicalRoute.replace(
            'const session = await requireSessionOrLocalToken(request);',
            'const session = requireSessionOrLocalToken(request);',
        ),
        canonicalRoute.replace('requireSessionOrLocalToken(request)', 'requireSessionOrLocalToken?.(request)'),
        canonicalRoute.replace(
            'const session = await requireSessionOrLocalToken(request);',
            'const observed = request;\n    const session = await requireSessionOrLocalToken(request);',
        ),
    ];
    for (const source of cases) assert.notDeepEqual(validateLegacyOcrRetirementSource(source), []);
});

test('requires exact no-store unauthorized and retired responses for GET and POST', () => {
    for (const [before, after] of [
        ["'Unauthorized'", "'Denied'"],
        ['status: 401', 'status: 403'],
        ["'cache-control': 'no-store'", "'cache-control': 'max-age=60'"],
        ["'OCR_EXTRACTION_RETIRED'", "'OCR_AVAILABLE'"],
        ['status: 410', 'status: 200'],
    ]) assert.notDeepEqual(validateLegacyOcrRetirementSource(canonicalRoute.replace(before, after)), []);
});

test('denies direct, aliased and reflective request body or query observation', () => {
    const statements = [
        'await request.json();',
        'const { body } = request;',
        "request['body'];",
        'request?.nextUrl?.searchParams;',
        "Reflect.get(request, 'body');",
        'const alias = request; await alias.text();',
        'const clone = { ...request }; void clone;',
        'const copy = structuredClone(request); void copy;',
    ];
    for (const statement of statements) {
        assert.notDeepEqual(validateLegacyOcrRetirementSource(injectBeforeRetirement(statement)), []);
    }
});

test('denies loader, provider, OCR, storage, process, network and fallback code', () => {
    const statements = [
        "await import('@firecrawl/anydoc');",
        "require('node:fs');",
        "createRequire(import.meta.url)('node:fs');",
        'await AIService.extract(request);',
        'await extractDocumentWithAI(request);',
        'await dbServer.select();',
        'await fs.readFile(process.env.PATH);',
        "await fetch('http://127.0.0.1:11434');",
        'await appleVisionFallback(request);',
    ];
    for (const statement of statements) {
        assert.notDeepEqual(validateLegacyOcrRetirementSource(injectBeforeRetirement(statement)), []);
    }
});

test('ignores inert comments and string literals that mention forbidden code', () => {
    const inert = canonicalRoute.replace("export async function POST", "// request.body fetch provider fallback\n'createRequire process.env OCR storage';\nexport async function POST");
    assert.deepEqual(validateLegacyOcrRetirementSource(inert), []);
});
