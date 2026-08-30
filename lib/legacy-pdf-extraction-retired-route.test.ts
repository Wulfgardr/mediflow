/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-legacy-pdf-retirement-'));
const migrationDb = new Database(path.join(dataDir, 'medical.db'));
migrationDb.pragma('foreign_keys = OFF');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

const route = await import('../app/api/pdf-extract/route.ts');
const post = route.POST as (request: Request) => Promise<Response>;
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as {
    requireSession: () => Promise<unknown>;
};

const webSession = Object.freeze({
    id: 'session.synthetic.pdf-retirement',
    userId: 'user.synthetic.pdf-retirement',
    username: ['synthetic', 'pdf', 'retirement'].join('.'),
    role: 'clinician',
    authChannel: 'web',
    createdAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
});
const retiredBody = Object.freeze({
    error: 'PDF extraction endpoint retired',
    code: 'PDF_EXTRACTION_RETIRED',
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function withAuth(value: unknown | (() => Promise<unknown>), invoke: () => Promise<Response>) {
    const original = serverAuth.requireSession;
    serverAuth.requireSession = async () => typeof value === 'function'
        ? (value as () => Promise<unknown>)()
        : value;
    try {
        return await invoke();
    } finally {
        serverAuth.requireSession = original;
    }
}

function hostileRequest(reads: { count: number }) {
    return new Proxy({}, {
        get() {
            reads.count += 1;
            throw new Error('synthetic hostile request read');
        },
    }) as Request;
}

function validateLegacyPdfRetirementSource(source: string): string[] {
    const { spawnSync } = requireCurrent('node:child_process');
    const guardUrl = new URL('../scripts/check-never-regress.mjs', import.meta.url).href;
    const script = [
        `const guard = await import(${JSON.stringify(guardUrl)});`,
        "const source = Buffer.from(process.argv[1], 'base64').toString('utf8');",
        'process.stdout.write(JSON.stringify(guard.validateLegacyPdfRetirementSource(source)));',
    ].join('\n');
    const result = spawnSync(process.execPath, [
        '--input-type=module',
        '--eval',
        script,
        Buffer.from(source).toString('base64'),
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as string[];
}

test('returns a no-store 401 before observing a hostile request when web authentication fails', async () => {
    const reads = { count: 0 };

    const response = await withAuth(null, () => post(hostileRequest(reads)));

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    assert.equal(reads.count, 0);
});

test('returns the exact retired no-store contract without observing the authenticated request', async () => {
    const reads = { count: 0 };

    const response = await withAuth(webSession, () => post(hostileRequest(reads)));

    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), retiredBody);
    assert.equal(reads.count, 0);
});

test('leaves an authentication throw visible without observing the request', async () => {
    const reads = { count: 0 };

    await assert.rejects(
        () => withAuth(async () => { throw new Error('synthetic auth throw'); }, () => post(hostileRequest(reads))),
        /synthetic auth throw/u,
    );

    assert.equal(reads.count, 0);
});

test('accepts the closed web-authenticated PDF retirement route', () => {
    const source = fs.readFileSync(path.join(root, 'app/api/pdf-extract/route.ts'), 'utf8');
    assert.deepEqual(validateLegacyPdfRetirementSource(source), []);
});

test('denies executable request, extraction, loader, process, network and decorator bypasses', () => {
    const canonical = fs.readFileSync(path.join(root, 'app/api/pdf-extract/route.ts'), 'utf8');
    const beforeRetirement = "    return NextResponse.json({\n        error: 'PDF extraction endpoint retired'";
    const probes = [
        canonical.replace(beforeRetirement, `    await _request.formData();\n${beforeRetirement}`),
        canonical.replace(beforeRetirement, `    await inspectPdf(Buffer.from(await _request.arrayBuffer()));\n${beforeRetirement}`),
        canonical.replace(beforeRetirement, `    await import('@firecrawl/anydoc');\n${beforeRetirement}`),
        canonical.replace(beforeRetirement, `    ${'req' + "uire('node:fs')"}.readFileSync(process.env.PATH);\n${beforeRetirement}`),
        canonical.replace(beforeRetirement, `    await fetch('http://127.0.0.1:11434');\n${beforeRetirement}`),
        canonical.replace('export async function POST', `@(fetch('${'https' + '://synthetic.invalid'}'))\nexport async function POST`),
        canonical.replace('POST()', 'POST(@(inspectPdf()) _request: Request)'),
        canonical.replace("export const runtime = 'nodejs';", `export const runtime = (fetch('${'https' + '://synthetic.invalid'}'), 'nodejs');`),
        `${canonical}\nexport async function GET() { return new Response('active'); }\n`,
    ];

    for (const source of probes) assert.notDeepEqual(validateLegacyPdfRetirementSource(source), []);
});

test('denies auth and response drift while ignoring inert comments and string literals', () => {
    const canonical = fs.readFileSync(path.join(root, 'app/api/pdf-extract/route.ts'), 'utf8');
    const probes = [
        canonical.replace("import { requireSession }", "import { requireSession as auth }"),
        canonical.replace('const session = await requireSession();', 'const session = requireSession();'),
        canonical.replace("'Unauthorized'", "'Denied'"),
        canonical.replace('status: 401', 'status: 403'),
        canonical.replace("'PDF_EXTRACTION_RETIRED'", "'PDF_AVAILABLE'"),
        canonical.replace('status: 410', 'status: 200'),
        canonical.replace("'cache-control': 'no-store'", "'cache-control': 'max-age=60'"),
    ];
    for (const source of probes) assert.notDeepEqual(validateLegacyPdfRetirementSource(source), []);

    const inert = canonical.replace(
        '/** Retired legacy PDF extraction boundary. */',
        "// inspectPdf Buffer formData fetch process fallback\n'inspectPdf Buffer formData fetch process fallback';\n/** Retired legacy PDF extraction boundary. */",
    );
    assert.deepEqual(validateLegacyPdfRetirementSource(inert), []);
});
