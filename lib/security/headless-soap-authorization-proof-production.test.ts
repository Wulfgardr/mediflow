/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-authorization-proof-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});

const internal = await import('./headless-soap-authorization-proof-production-internal.ts');
const facade = await import('./headless-soap-authorization-proof-production.ts');

test('shares one H5b owner while exposing only its frozen proof service', async () => {
    const repeated = await import('./headless-soap-authorization-proof-production-internal.ts');
    const loaderInteropExports = new Set(['__esModule', 'default', ['module', 'exports'].join('.')]);
    assert.deepEqual(Object.keys(internal).filter((key) => !loaderInteropExports.has(key)), [
        'headlessSoapAuthorizationProofProductionOwner',
    ]);
    assert.deepEqual(Object.keys(facade).filter((key) => !loaderInteropExports.has(key)), [
        'headlessSoapAuthorizationProofService',
    ]);
    const owner = internal.headlessSoapAuthorizationProofProductionOwner;
    assert.equal(owner, repeated.headlessSoapAuthorizationProofProductionOwner);
    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['bindingController', 'lifecycleController', 'service']);
    assert.equal(facade.headlessSoapAuthorizationProofService, owner.service);
    assert.equal(Object.isFrozen(owner.service), true);
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['issue', 'wipe']);
    assert.deepEqual([owner.service.issue.length, owner.service.wipe.length], [2, 1]);
    assert.equal(Object.isFrozen(owner.lifecycleController), true);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), [
        'confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent',
        'withCurrentProof', 'withSingleUseProof',
    ]);
    assert.equal(Object.isFrozen(owner.bindingController), true);
    assert.deepEqual(Reflect.ownKeys(owner.bindingController), [
        'withCurrentDependentBinding', 'withSingleUseDependentBinding',
    ]);
});

test('keeps foreign proof identities inert without exposing the private H6 controller', async () => {
    const service = facade.headlessSoapAuthorizationProofService;
    const lifecycle = internal.headlessSoapAuthorizationProofProductionOwner.lifecycleController;
    const foreignProof = `hsap_${'0'.repeat(64)}`;
    const foreignRegistration = Object.freeze(Object.create(null));
    assert.equal(service.wipe(foreignProof), false);
    assert.equal(await lifecycle.withCurrentProof(foreignProof, () => undefined), false);
    assert.equal(lifecycle.registerDependent(foreignProof, () => undefined), null);
    assert.equal(lifecycle.confirmDependent(foreignProof, foreignRegistration), false);
    assert.equal(lifecycle.unregisterDependent(foreignProof, foreignRegistration), false);
    assert.equal(await lifecycle.withCurrentDependent(foreignProof, foreignRegistration, () => undefined), false);
    assert.equal(await lifecycle.withSingleUseProof(foreignProof, () => undefined), false);
    assert.equal(await internal.headlessSoapAuthorizationProofProductionOwner.bindingController
        .withCurrentDependentBinding(foreignProof, foreignRegistration, () => undefined), false);
    assert.equal(await internal.headlessSoapAuthorizationProofProductionOwner.bindingController
        .withSingleUseDependentBinding(foreignProof, foreignRegistration, () => undefined), false);
    assert.equal('lifecycleController' in facade, false);
    assert.equal('bindingController' in facade, false);
    assert.equal('headlessSoapAuthorizationProofProductionOwner' in facade, false);
});

test('composes H5a, fresh host PIN verification and captured process primitives once', () => {
    const internalUrl = new URL('./headless-soap-authorization-proof-production-internal.ts', import.meta.url);
    const ownerSource = fs.readFileSync(internalUrl, 'utf8');
    const facadeSource = fs.readFileSync(new URL('./headless-soap-authorization-proof-production.ts', import.meta.url), 'utf8');
    const importsOf = (source: string) => [...source.matchAll(/^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu)]
        .map((match) => match[1] ?? match[2]).sort();
    assert.deepEqual(importsOf(facadeSource), [
        'server-only', './headless-soap-authorization-proof-production-internal',
    ].sort());
    assert.deepEqual(importsOf(ownerSource), [
        'node:crypto', 'server-only', './headless-soap-authorization-proof-lifecycle',
        './headless-soap-entry-presentation-lifecycle-production-internal',
        './headless-soap-fresh-pin-verification', './host-credential-verification',
        './server-auth', './server-auth-policy', './web-auth-lifecycle-owner-adapter',
    ].sort());
    assert.equal(ownerSource.match(/\bcreateHeadlessSoapAuthorizationProofLifecycleOwner\s*\(/gu)?.length, 1);
    assert.equal(ownerSource.match(/\bcreateHeadlessSoapFreshPinVerifier\s*\(/gu)?.length, 1);
    assert.match(ownerSource, /presentationLifecycle\s*:\s*headlessSoapEntryPresentationLifecycleProductionOwner\.lifecycleController/u);
    assert.match(ownerSource, /presentationBinding\s*:\s*headlessSoapEntryPresentationLifecycleProductionOwner\.presentationBindingController/u);
    assert.match(ownerSource, /presentationService\s*:\s*headlessSoapEntryPresentationLifecycleProductionOwner\.service/u);
    assert.match(ownerSource, /verifyFreshPin\s*:\s*freshPinVerifier\.verify/u);
    assert.match(ownerSource, /resolveCurrentWebAdmin/u);
    assert.match(ownerSource, /verifyCredentials\s*:\s*verifyHostCredentials/u);
    assert.match(ownerSource, /isWebAdminSession/u);
    assert.match(ownerSource, /withCurrentWebSessionBinding\s*:\s*withCurrentVerifiedWebSessionBinding/u);
    for (const method of [
        'mintResourcePort', 'beginResourceUse', 'withCurrentResourceBinding',
        'commitResourceUse', 'abortResourceUse', 'releaseResourcePort',
    ]) assert.match(ownerSource, new RegExp(`\\b${method}\\b`, 'u'));
    assert.match(ownerSource, /hostUint8ArrayFrom/u);
    assert.match(ownerSource, /reflectApply\s*\(\s*hostUint8ArrayFrom\s*,\s*hostUint8Array/u);
    assert.doesNotMatch(ownerSource, /\bUint8Array\.from\s*\(/u);
    assert.doesNotMatch(facadeSource, /lifecycleController|ProductionOwner|verifyHostCredentials|randomBytes|node:crypto/u);
    for (const source of [facadeSource, ownerSource]) {
        assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
        assert.doesNotMatch(source, /physician[_-]terminal[_-]review|approvalRef|commandId|idempotencyKey|writer|transaction/iu);
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
