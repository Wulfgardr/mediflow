/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-entry-presentation-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const internal = await import('./headless-soap-entry-presentation-lifecycle-production-internal.ts');
const facade = await import('./headless-soap-entry-presentation-lifecycle-production.ts');

test('shares one H5a owner while exposing only its frozen presentation service', async () => {
    const repeated = await import('./headless-soap-entry-presentation-lifecycle-production-internal.ts');
    const loaderInteropExports = new Set(['__esModule', 'default', ['module', 'exports'].join('.')]);
    assert.deepEqual(Object.keys(internal).filter((key) => !loaderInteropExports.has(key)), [
        'headlessSoapEntryPresentationLifecycleProductionOwner',
    ]);
    assert.deepEqual(Object.keys(facade).filter((key) => !loaderInteropExports.has(key)), [
        'headlessSoapEntryPresentationLifecycleService',
    ]);
    const owner = internal.headlessSoapEntryPresentationLifecycleProductionOwner;
    assert.equal(owner, repeated.headlessSoapEntryPresentationLifecycleProductionOwner);
    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), [
        'lifecycleController', 'presentationBindingController', 'sealBindingController', 'service',
    ]);
    assert.equal(facade.headlessSoapEntryPresentationLifecycleService, owner.service);
    assert.equal(Object.isFrozen(owner.service), true);
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['cancel', 'present']);
    assert.deepEqual([owner.service.present.length, owner.service.cancel.length], [1, 1]);
    assert.equal(Object.isFrozen(owner.lifecycleController), true);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), [
        'confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent', 'withCurrentPresentation',
    ]);
    assert.deepEqual([
        owner.lifecycleController.withCurrentPresentation.length, owner.lifecycleController.registerDependent.length,
        owner.lifecycleController.confirmDependent.length, owner.lifecycleController.unregisterDependent.length,
        owner.lifecycleController.withCurrentDependent.length,
    ], [2, 2, 2, 2, 3]);
    assert.equal(Object.isFrozen(owner.sealBindingController), true);
    assert.deepEqual(Reflect.ownKeys(owner.sealBindingController), ['bindGestureSeal']);
    assert.equal(owner.sealBindingController.bindGestureSeal.length, 2);
    assert.equal(Object.isFrozen(owner.presentationBindingController), true);
    assert.deepEqual(Reflect.ownKeys(owner.presentationBindingController), ['withCurrentDependentBinding']);
});

test('keeps foreign identities inert without exposing the private H5b controller', async () => {
    const service = facade.headlessSoapEntryPresentationLifecycleService;
    const lifecycle = internal.headlessSoapEntryPresentationLifecycleProductionOwner.lifecycleController;
    const foreignRef = Object.freeze(Object.create(null)); const foreignRegistration = Object.freeze(Object.create(null));
    await assert.rejects(service.present(foreignRef));
    assert.equal(service.cancel('A'.repeat(43)), false);
    assert.equal(await lifecycle.withCurrentPresentation('A'.repeat(43), () => undefined), false);
    assert.equal(lifecycle.registerDependent('A'.repeat(43), () => undefined), null);
    assert.equal(lifecycle.confirmDependent('A'.repeat(43), foreignRegistration), false);
    assert.equal(lifecycle.unregisterDependent('A'.repeat(43), foreignRegistration), false);
    assert.equal(await lifecycle.withCurrentDependent('A'.repeat(43), foreignRegistration, () => undefined), false);
    assert.equal(await internal.headlessSoapEntryPresentationLifecycleProductionOwner.sealBindingController
        .bindGestureSeal('A'.repeat(43), Object.freeze(Object.create(null))), false);
    assert.equal(await internal.headlessSoapEntryPresentationLifecycleProductionOwner.presentationBindingController
        .withCurrentDependentBinding('A'.repeat(43), foreignRegistration, () => undefined), false);
    assert.equal('lifecycleController' in facade, false); assert.equal('sealBindingController' in facade, false);
    assert.equal('presentationBindingController' in facade, false);
    assert.equal('headlessSoapEntryPresentationLifecycleProductionOwner' in facade, false);
});

test('uses one internal composition root with captured and copied 32-byte host entropy', () => {
    const internalUrl = new URL('./headless-soap-entry-presentation-lifecycle-production-internal.ts', import.meta.url);
    const ownerSource = fs.readFileSync(internalUrl, 'utf8');
    const facadeSource = fs.readFileSync(new URL('./headless-soap-entry-presentation-lifecycle-production.ts', import.meta.url), 'utf8');
    const importsOf = (source: string) => [...source.matchAll(/^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu)]
        .map((match) => match[1] ?? match[2]).sort();
    assert.deepEqual(importsOf(facadeSource), [
        'server-only', './headless-soap-entry-presentation-lifecycle-production-internal',
    ].sort());
    assert.deepEqual(importsOf(ownerSource), [
        'node:crypto', 'server-only', './headless-soap-entry-field-set-lifecycle-production-internal',
        './headless-soap-entry-presentation-lifecycle',
    ].sort());
    assert.equal(ownerSource.match(/\bcreateHeadlessSoapEntryPresentationLifecycleOwner\s*\(/gu)?.length, 1);
    assert.match(ownerSource, /entryLifecycle\s*:\s*headlessSoapEntryFieldSetLifecycleProductionOwner\.lifecycleController/u);
    assert.match(ownerSource, /entryBinding\s*:\s*headlessSoapEntryFieldSetLifecycleProductionOwner\.bindingController/u);
    assert.match(ownerSource, /entryService\s*:\s*headlessSoapEntryFieldSetLifecycleProductionOwner\.service/u);

    const capture = ownerSource.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*randomBytes\s*;/u);
    assert.ok(capture); const capturedName = capture[1]!.replace(/[$]/gu, '\\$&');
    assert.match(ownerSource, new RegExp(
        `(?:Uint8Array\\.from\\s*\\(|new\\s+Uint8Array\\s*\\()\\s*${capturedName}\\s*\\(\\s*32\\s*\\)\\s*\\)`, 'u',
    ));
    assert.doesNotMatch(ownerSource, /\brandomBytes\s*\(/u);
    assert.doesNotMatch(ownerSource, /\b(?:db|database|schema|route|pin|proof|authorizationProof|approval|writer|fabric)\b/iu);
    assert.doesNotMatch(facadeSource, /lifecycleController|ProductionOwner|createHeadless|randomBytes|node:crypto/u);

    const securityDirectory = path.dirname(internalUrl.pathname);
    const compositionRoots = fs.readdirSync(securityDirectory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .filter((name) => /\bcreateHeadlessSoapEntryPresentationLifecycleOwner\s*\(\s*\{/u.test(
            fs.readFileSync(path.join(securityDirectory, name), 'utf8'),
        ));
    assert.deepEqual(compositionRoots, ['headless-soap-entry-presentation-lifecycle-production-internal.ts']);
    for (const source of [facadeSource, ownerSource]) {
        assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
