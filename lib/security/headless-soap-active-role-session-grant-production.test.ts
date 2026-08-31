/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-session-grant-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const production = await import('./headless-soap-active-role-session-grant-production.ts');

test('exposes one frozen process singleton with only issue, recheck, and dispose', async () => {
    const service = production.headlessSoapActiveRoleSessionGrantService;
    assert.equal(service, (await import('./headless-soap-active-role-session-grant-production.ts')).headlessSoapActiveRoleSessionGrantService);
    assert.equal(Object.isFrozen(service), true); assert.deepEqual(Reflect.ownKeys(service).sort(), ['dispose', 'issue', 'recheck']);
    assert.equal(service.issue.length, 0); assert.equal(service.recheck.length, 1); assert.equal(service.dispose.length, 1);
    const hasCode = (code: string) => (error: unknown) => (error as { code?: unknown }).code === code && !/sqlite|database|cookie/iu.test(String((error as Error).message));
    await assert.rejects(service.issue(), hasCode('session_ineligible'));
    await assert.rejects(service.recheck(Object.freeze(Object.create(null))), hasCode('grant_unavailable'));
    assert.equal(service.dispose(Object.freeze(Object.create(null))), false);
});

test('wires only canonical Web auth, SOAP attestation store, and the dedicated grant core', () => {
    const source = fs.readFileSync(new URL('./headless-soap-active-role-session-grant-production.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu)].map((match) => match[1] ?? match[2]).sort();
    assert.deepEqual(imports, ['server-only', './headless-soap-active-role-attestation-store', './headless-soap-active-role-session-grant', './server-auth'].sort());
    for (const required of ['readAuthenticatedWebSession', 'createHeadlessSoapActiveRoleAttestationStore', 'createHeadlessSoapActiveRoleSessionGrantService']) assert.match(source, new RegExp(required, 'u'));
    assert.match(source, /readCurrentSession:\s*readAuthenticatedWebSession/u);
    assert.equal(source.match(/^export\s+(?:const|function|class)\s/gmu)?.length, 1);
    assert.equal(source.match(/\bcreateHeadlessSoapActiveRoleAttestationStore\(\)/gu)?.length, 1);
    assert.equal(source.match(/\bcreateHeadlessSoapActiveRoleSessionGrantService\s*\(/gu)?.length, 1);
    assert.doesNotMatch(source, /enrollment|credential|physician-review|fresh-review|authenticated-review|fabric|route|db-server|schema|patient|proposal|proof|writer/iu);
    assert.doesNotMatch(source, /attestationStore\.(?:activate|createInactive|revoke)\b/u);
    assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
