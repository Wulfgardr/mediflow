/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-enrollment-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const production = await import('./headless-soap-active-role-enrollment-production.ts');

test('composes the PIN-only enrollment boundary as one server-only production function', () => {
    assert.equal(typeof production.enrollHeadlessSoapActiveRoleAttestation, 'function');
    assert.equal(production.enrollHeadlessSoapActiveRoleAttestation.length, 1);
});

test('uses only canonical Web auth, host credentials, SOAP store, and the dedicated adapter', () => {
    const source = fs.readFileSync(new URL('./headless-soap-active-role-enrollment-production.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu)].map((match) => match[1] ?? match[2]).sort();
    assert.deepEqual(imports, [
        'server-only', './headless-soap-active-role-attestation-store', './headless-soap-active-role-enrollment-store-adapter',
        './headless-soap-active-role-enrollment', './host-credential-verification', './server-auth', './server-auth-policy',
    ].sort());
    for (const required of ['readAuthenticatedWebSession', 'isWebAdminSession', 'verifyHostCredentials', 'createHeadlessSoapActiveRoleAttestationStore', 'isHeadlessSoapActiveRoleAttestationStoreError', 'createHeadlessSoapActiveRoleEnrollmentStoreAdapter', 'createHeadlessSoapActiveRoleEnrollmentService']) {
        assert.match(source, new RegExp(required, 'u'));
    }
    assert.equal(source.match(/^export\s/gmu)?.length, 1);
    assert.doesNotMatch(source, /physician-review|fresh-review-pin|authenticated-review|session-physician-review|active-review-binding|fabric|route|clinical-diary-writer/iu);
    assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
