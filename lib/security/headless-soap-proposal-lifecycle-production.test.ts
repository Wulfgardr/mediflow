/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-proposal-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const internal = await import('./headless-soap-proposal-lifecycle-production-internal.ts');
const facade = await import('./headless-soap-proposal-lifecycle-production.ts');

test('shares one exact H3 process owner while exposing only the public service', async () => {
    const repeated = await import('./headless-soap-proposal-lifecycle-production-internal.ts');
    const loaderInteropExports = new Set(['__esModule', 'default', ['module', 'exports'].join('.')]);
    assert.deepEqual(Object.keys(internal).filter((key) => !loaderInteropExports.has(key)), ['headlessSoapProposalLifecycleProductionOwner']);
    assert.deepEqual(Object.keys(facade).filter((key) => !loaderInteropExports.has(key)), ['headlessSoapProposalLifecycleService']);
    const owner = internal.headlessSoapProposalLifecycleProductionOwner;
    assert.equal(owner, repeated.headlessSoapProposalLifecycleProductionOwner); assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['bindingController', 'lifecycleController', 'service']);
    assert.equal(facade.headlessSoapProposalLifecycleService, owner.service); assert.equal(Object.isFrozen(owner.service), true);
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['inspect', 'preview', 'proposal', 'wipe']);
    assert.deepEqual([owner.service.inspect.length, owner.service.preview.length, owner.service.proposal.length, owner.service.wipe.length], [2, 1, 1, 1]);
    assert.equal(Object.isFrozen(owner.lifecycleController), true);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), [
        'confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent', 'withCurrentProposal',
    ]);
    assert.equal(Object.isFrozen(owner.bindingController), true);
    assert.deepEqual(Reflect.ownKeys(owner.bindingController), ['withCurrentDependentBinding']);
});

test('keeps foreign H3 identities inert across public and private production surfaces', async () => {
    const service = facade.headlessSoapProposalLifecycleService;
    const lifecycle = internal.headlessSoapProposalLifecycleProductionOwner.lifecycleController;
    const foreignRef = Object.freeze(Object.create(null)); const foreignRegistration = Object.freeze(Object.create(null));
    const hasCode = (error: unknown) => (error as { code?: unknown }).code === 'stage_unavailable'
        && !/sqlite|database|cookie|patient|actor|session id|synthetic SOAP/iu.test(String((error as { message?: unknown }).message));
    await assert.rejects(service.preview(foreignRef), hasCode); await assert.rejects(service.proposal(foreignRef), hasCode);
    assert.equal(service.wipe(foreignRef), false); assert.equal(lifecycle.registerDependent(foreignRef, () => undefined), null);
    assert.equal(lifecycle.confirmDependent(foreignRef, foreignRegistration), false);
    assert.equal(lifecycle.unregisterDependent(foreignRef, foreignRegistration), false);
    assert.equal(await lifecycle.withCurrentProposal(foreignRef, () => undefined), false);
    assert.equal(await lifecycle.withCurrentDependent(foreignRef, foreignRegistration, () => undefined), false);
    assert.equal(await internal.headlessSoapProposalLifecycleProductionOwner.bindingController
        .withCurrentDependentBinding(foreignRef, foreignRegistration, () => undefined), false);
});

test('composition root binds request session, existing owners, and cancellable host intrinsics only', () => {
    const ownerSource = fs.readFileSync(new URL('./headless-soap-proposal-lifecycle-production-internal.ts', import.meta.url), 'utf8');
    const facadeSource = fs.readFileSync(new URL('./headless-soap-proposal-lifecycle-production.ts', import.meta.url), 'utf8');
    const importsOf = (source: string) => [...source.matchAll(/^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu)]
        .map((match) => match[1] ?? match[2]).sort();
    assert.deepEqual(importsOf(facadeSource), ['server-only', './headless-soap-proposal-lifecycle-production-internal'].sort());
    assert.deepEqual(importsOf(ownerSource), [
        'server-only', './headless-soap-child-session-lease-production-internal', './headless-soap-proposal-lifecycle',
        './server-auth', './server-session-projection-owner-production-internal',
    ].sort());
    assert.equal(ownerSource.match(/\bcreateHeadlessSoapProposalLifecycleOwner\s*\(/gu)?.length, 1);
    assert.match(ownerSource, /readCurrentSelectionSession:\s*readAuthenticatedWebSession/u);
    assert.match(ownerSource, /headlessSoapChildSessionLeaseProductionOwner\.lifecycleController/u);
    assert.match(ownerSource, /headlessSoapChildSessionLeaseProductionOwner\.bindingController/u);
    assert.match(ownerSource, /serverSessionProjectionOwnerProductionOwner\.selectionLifecycleController/u);
    assert.match(ownerSource, /serverSessionProjectionOwnerProductionOwner\.selectionBindingController/u);
    assert.match(ownerSource, /const hostDateNow = Date\.now/u); assert.match(ownerSource, /const hostSetTimeout = setTimeout/u);
    assert.match(ownerSource, /const hostClearTimeout = clearTimeout/u);
    assert.doesNotMatch(ownerSource, /db-server|schema|route|approval|proof|writer|fabric/iu);
    assert.doesNotMatch(facadeSource, /lifecycleController|createHeadless|readAuthenticated|setTimeout|Date\.now/u);
    for (const source of [facadeSource, ownerSource]) {
        assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
