/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-command-binding-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});

const internal = await import('./headless-soap-command-binding-production-internal.ts');
const facade = await import('./headless-soap-command-binding-production.ts');

test('shares one H6 owner while exposing only its frozen approval-binding service', async () => {
    const repeated = await import('./headless-soap-command-binding-production-internal.ts');
    const loaderInteropExports = new Set(['__esModule', 'default', ['module', 'exports'].join('.')]);
    assert.deepEqual(Object.keys(internal).filter((key) => !loaderInteropExports.has(key)), [
        'headlessSoapCommandBindingProductionOwner',
    ]);
    assert.deepEqual(Object.keys(facade).filter((key) => !loaderInteropExports.has(key)), [
        'headlessSoapCommandBindingService',
    ]);
    const owner = internal.headlessSoapCommandBindingProductionOwner;
    assert.equal(owner, repeated.headlessSoapCommandBindingProductionOwner);
    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['approvalController', 'service']);
    assert.equal(facade.headlessSoapCommandBindingService, owner.service);
    assert.equal(Object.isFrozen(owner.service), true);
    assert.deepEqual(Reflect.ownKeys(owner.service), ['bind', 'wipe']);
    assert.deepEqual([owner.service.bind.length, owner.service.wipe.length], [1, 2]);
    assert.equal(Object.isFrozen(owner.approvalController), true);
    assert.deepEqual(Reflect.ownKeys(owner.approvalController), ['withSingleUseApproval']);
});

test('keeps foreign proof and approval identities inert across production surfaces', async () => {
    const owner = internal.headlessSoapCommandBindingProductionOwner;
    const foreignProof = `hsap_${'0'.repeat(64)}`;
    await assert.rejects(owner.service.bind(foreignProof),
        (error: unknown) => (error as { code?: unknown }).code === 'proof_unavailable');
    assert.equal(owner.service.wipe(`hsaa_${'0'.repeat(64)}`, foreignProof), false);
    assert.equal(await owner.approvalController.withSingleUseApproval(
        Object.freeze(Object.create(null)), () => undefined,
    ), false);
    assert.equal('approvalController' in facade, false);
    assert.equal('headlessSoapCommandBindingProductionOwner' in facade, false);
});

test('composes the exact H5b owner and captured 32-byte host entropy once', () => {
    const internalUrl = new URL('./headless-soap-command-binding-production-internal.ts', import.meta.url);
    const ownerSource = fs.readFileSync(internalUrl, 'utf8');
    const facadeSource = fs.readFileSync(new URL('./headless-soap-command-binding-production.ts', import.meta.url), 'utf8');
    const importsOf = (source: string) => [...source.matchAll(/^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu)]
        .map((match) => match[1] ?? match[2]).sort();
    assert.deepEqual(importsOf(facadeSource), [
        'server-only', './headless-soap-command-binding-production-internal',
    ].sort());
    assert.deepEqual(importsOf(ownerSource), [
        'node:crypto', 'server-only', './headless-soap-authorization-proof-production-internal',
        './headless-soap-command-binding-lifecycle',
    ].sort());
    assert.equal(ownerSource.match(/\bcreateHeadlessSoapCommandBindingOwner\s*\(/gu)?.length, 1);
    assert.match(ownerSource, /proofLifecycle\s*:\s*headlessSoapAuthorizationProofProductionOwner\.lifecycleController/u);
    assert.match(ownerSource, /proofBinding\s*:\s*headlessSoapAuthorizationProofProductionOwner\.bindingController/u);
    assert.match(ownerSource, /proofService\s*:\s*headlessSoapAuthorizationProofProductionOwner\.service/u);
    const capture = ownerSource.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*randomBytes\s*;/u);
    assert.ok(capture); const capturedName = capture[1]!.replace(/[$]/gu, '\\$&');
    assert.match(ownerSource, new RegExp(
        `(?:Uint8Array\\.from\\s*\\(|new\\s+Uint8Array\\s*\\()\\s*${capturedName}\\s*\\(\\s*32\\s*\\)\\s*\\)`, 'u',
    ));
    assert.doesNotMatch(ownerSource, /\brandomBytes\s*\(/u);
    assert.doesNotMatch(facadeSource, /approvalController|ProductionOwner|createHeadless|randomBytes|node:crypto/u);
    for (const source of [facadeSource, ownerSource]) {
        assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
        assert.doesNotMatch(source, /physician[_-]terminal[_-]review|writer|transaction|db-server|schema/iu);
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
