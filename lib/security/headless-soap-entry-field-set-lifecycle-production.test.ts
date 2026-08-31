/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-entry-field-set-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const internal = await import('./headless-soap-entry-field-set-lifecycle-production-internal.ts');
const facade = await import('./headless-soap-entry-field-set-lifecycle-production.ts');

test('shares one exact H4 host owner while exposing only the public field-set service', async () => {
    const repeated = await import('./headless-soap-entry-field-set-lifecycle-production-internal.ts');
    const loaderInteropExports = new Set(['__esModule', 'default', ['module', 'exports'].join('.')]);
    assert.deepEqual(Object.keys(internal).filter((key) => !loaderInteropExports.has(key)), ['headlessSoapEntryFieldSetLifecycleProductionOwner']);
    assert.deepEqual(Object.keys(facade).filter((key) => !loaderInteropExports.has(key)), ['headlessSoapEntryFieldSetLifecycleService']);
    const owner = internal.headlessSoapEntryFieldSetLifecycleProductionOwner;
    assert.equal(owner, repeated.headlessSoapEntryFieldSetLifecycleProductionOwner); assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['lifecycleController', 'service']);
    assert.equal(facade.headlessSoapEntryFieldSetLifecycleService, owner.service); assert.equal(Object.isFrozen(owner.service), true);
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['materialize', 'wipe']);
    assert.deepEqual([owner.service.materialize.length, owner.service.wipe.length], [1, 1]);
    assert.equal(Object.isFrozen(owner.lifecycleController), true);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), [
        'confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent', 'withCurrentEntry',
    ]);
    assert.deepEqual([
        owner.lifecycleController.withCurrentEntry.length, owner.lifecycleController.registerDependent.length,
        owner.lifecycleController.confirmDependent.length, owner.lifecycleController.unregisterDependent.length,
        owner.lifecycleController.withCurrentDependent.length,
    ], [2, 2, 2, 2, 3]);
});

test('keeps foreign H4 identities inert across public and private production surfaces', async () => {
    const service = facade.headlessSoapEntryFieldSetLifecycleService;
    const lifecycle = internal.headlessSoapEntryFieldSetLifecycleProductionOwner.lifecycleController;
    const foreignRef = Object.freeze(Object.create(null)); const foreignRegistration = Object.freeze(Object.create(null));
    await assert.rejects(service.materialize(foreignRef), (error: unknown) => (error as { code?: unknown }).code === 'proposal_unavailable');
    assert.equal(service.wipe(foreignRef), false); assert.equal(await lifecycle.withCurrentEntry(foreignRef, () => undefined), false);
    assert.equal(lifecycle.registerDependent(foreignRef, () => undefined), null);
    assert.equal(lifecycle.confirmDependent(foreignRef, foreignRegistration), false);
    assert.equal(lifecycle.unregisterDependent(foreignRef, foreignRegistration), false);
    assert.equal(await lifecycle.withCurrentDependent(foreignRef, foreignRegistration, () => undefined), false);
});

test('composition root binds the exact H3 owner and captured host clock without route or storage imports', () => {
    const ownerSource = fs.readFileSync(new URL('./headless-soap-entry-field-set-lifecycle-production-internal.ts', import.meta.url), 'utf8');
    const facadeSource = fs.readFileSync(new URL('./headless-soap-entry-field-set-lifecycle-production.ts', import.meta.url), 'utf8');
    const importsOf = (source: string) => [...source.matchAll(/^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu)]
        .map((match) => match[1] ?? match[2]).sort();
    assert.deepEqual(importsOf(facadeSource), ['server-only', './headless-soap-entry-field-set-lifecycle-production-internal'].sort());
    assert.deepEqual(importsOf(ownerSource), [
        'server-only', './headless-soap-entry-field-set-lifecycle', './headless-soap-proposal-lifecycle-production-internal',
    ].sort());
    assert.equal(ownerSource.match(/\bcreateHeadlessSoapEntryFieldSetLifecycleOwner\s*\(/gu)?.length, 1);
    assert.match(ownerSource, /headlessSoapProposalLifecycleProductionOwner\.lifecycleController/u);
    assert.match(ownerSource, /headlessSoapProposalLifecycleProductionOwner\.service/u);
    assert.match(ownerSource, /const hostDateNow = Date\.now/u);
    assert.doesNotMatch(ownerSource, /db-server|schema|route|approval|proof|writer|fabric/iu);
    assert.doesNotMatch(facadeSource, /lifecycleController|createHeadless|Date\.now/u);
    for (const source of [facadeSource, ownerSource]) {
        assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
