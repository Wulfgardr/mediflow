import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OWNED_HTTP_FILES, SUPERVISOR_HTTP_FILE, ownedHttpInvocations } from './run-owned-synthetic-http-suite.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
test('owned HTTP recipes cover nineteen files once in seventeen real wrapper invocations', () => {
    const recipes = ownedHttpInvocations(root);
    assert.equal(recipes.length, 17);
    const files = recipes.flatMap(recipe => recipe.coveredFiles);
    assert.equal(files.length, 19);
    assert.equal(new Set(files).size, files.length);
    assert.deepEqual([...files].sort(), OWNED_HTTP_FILES.filter(file => file !== SUPERVISOR_HTTP_FILE).sort());
    for (const recipe of recipes) {
        assert.equal(recipe.executable, 'bash');
        assert.equal(recipe.args.length, 1);
        assert.ok(recipe.args[0].endsWith('.sh'));
    }
    const documents = recipes.find(recipe => recipe.id.endsWith('documents-write.test.mjs'));
    assert.equal(documents.env.MEDIFLOW_ATTACHMENT_MAX_BYTES, '1024');
});
test('standalone mode selects only the existing supervisor entrypoint, without a dev fallback', () => {
    const recipes = ownedHttpInvocations(root, true);
    assert.equal(recipes.length, 1);
    assert.equal(recipes[0].executable, process.execPath);
    assert.deepEqual(recipes[0].args, [SUPERVISOR_HTTP_FILE]);
    assert.deepEqual(recipes[0].coveredFiles, [SUPERVISOR_HTTP_FILE]);
});
