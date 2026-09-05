/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-selection-lifecycle-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const internal = await import('./server-session-projection-owner-production-internal.ts');
const facade = await import('./server-session-projection-owner-production.ts');

test('production facade and private lifecycle share one exact process owner', async () => {
    const repeated = await import('./server-session-projection-owner-production-internal.ts');
    const owner = internal.serverSessionProjectionOwnerProductionOwner;
    assert.equal(owner, repeated.serverSessionProjectionOwnerProductionOwner);
    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), [
        'registry', 'selectionBindingController', 'selectionCommitBindingController', 'selectionLifecycleController',
    ]);
    assert.equal(facade.serverSessionProjectionOwnerRegistry, owner.registry);
    assert.deepEqual(Reflect.ownKeys(owner.selectionLifecycleController).sort(), [
        'confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent', 'withCurrentSelection',
    ]);
    assert.deepEqual(Reflect.ownKeys(owner.selectionBindingController), ['withCurrentDependentBinding']);
    assert.deepEqual(Reflect.ownKeys(owner.selectionCommitBindingController), ['withCurrentCommitBinding']);
    assert.equal(Reflect.get(owner.registry, 'selectionLifecycleController'), undefined);
    assert.equal(Reflect.get(owner.registry, 'selectionBindingController'), undefined);
    assert.equal(Reflect.get(owner.registry, 'selectionCommitBindingController'), undefined);
});

test('production facade imports only the internal singleton and exports no lifecycle authority', () => {
    const internalSource = fs.readFileSync(new URL('./server-session-projection-owner-production-internal.ts', import.meta.url), 'utf8');
    const facadeSource = fs.readFileSync(new URL('./server-session-projection-owner-production.ts', import.meta.url), 'utf8');
    assert.match(internalSource, /serverSessionProjectionOwnerProductionOwner = createFullPortProjectionOwnerProcessOwner/u);
    assert.match(facadeSource, /serverSessionProjectionOwnerRegistry = serverSessionProjectionOwnerProductionOwner\.registry/u);
    assert.doesNotMatch(facadeSource,
        /selection(?:Lifecycle|Binding|CommitBinding)Controller|createFullPortProjectionOwner/u);
    assert.equal(facadeSource.match(/^export\s+(?:const|function|class)\s/gmu)?.length, 1);
    assert.doesNotMatch(facadeSource, /^export\s+(?:const|function|class)\s+\w*(?:Owner|Controller)\b/gmu);
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
