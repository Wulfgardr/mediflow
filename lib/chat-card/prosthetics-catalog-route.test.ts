import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../../app/api/v1/network/prosthetics-catalog/route.ts', import.meta.url), 'utf8');
function fixture(options: { denied?: boolean; count?: number; broken?: boolean } = {}) {
    let reads = 0;
    const exports: { GET?: (request: Request) => Promise<Response> } = {};
    const modules: Record<string, object> = {
        '@/lib/network-write-context': { requireNetworkCapabilityContext: async (_request: Request, capability: string) => {
            assert.equal(capability, 'network.replica.readonly-prosthetic-prescriptions');
            return options.denied ? { ok: false, response: new Response(null, { status: 403 }) } : { ok: true, context: { scopeAmbulatoryId: 'synthetic' } };
        } },
        '@/lib/prosthetic-prescription-write': {
            NETWORK_PROSTHETIC_PRESCRIPTION_READ_CAPABILITY: 'network.replica.readonly-prosthetic-prescriptions',
            readProstheticsCatalog: (query: string) => {
                reads++; assert.equal(query, 'demo');
                if (options.broken) throw new Error('PRIVATE_SENTINEL');
                if (options.count === 0) return null;
                return { rows: [], truncated: false };
            },
        },
    };
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
        { exports, require: (id: string) => { assert.ok(Object.hasOwn(modules, id)); return modules[id]; }, Response, URL });
    return { get: (query = 'q=demo') => exports.GET!(new Request('http://127.0.0.1:19439/api/v1/network/prosthetics-catalog?' + query)), reads: () => reads };
}
test('prosthetics catalog denies before reading and rejects invalid query shapes', async () => {
    const denied = fixture({ denied: true }); assert.equal((await denied.get()).status, 403); assert.equal(denied.reads(), 0);
    for (const query of ['', 'q=a', 'q=demo&q=other', 'q=demo&patientId=private', 'q=%00demo']) {
        const f = fixture(); assert.equal((await f.get(query)).status, 400); assert.equal(f.reads(), 0);
    }
});
test('prosthetics catalog reports explicit unavailability without diagnostics', async () => {
    const response = await fixture().get(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { rows: [], truncated: false });
    assert.equal((await fixture({ count: 0 }).get()).status, 409);
    const broken = await fixture({ broken: true }).get(); assert.equal(broken.status, 503); assert.ok(!(await broken.text()).includes('PRIVATE_SENTINEL'));
});
