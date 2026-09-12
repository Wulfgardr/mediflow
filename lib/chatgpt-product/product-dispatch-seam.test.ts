/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { CHATGPT_PRODUCT_ENTRY, selectProductOption, admitClinicalChatGptContext } = await import('./product-dispatch-seam.ts');
const { createProductFixture } = await import('./product-production.test.ts');
test('dedicated seam cannot enable clinical dispatch or persist a model default', async t => {
    assert.equal(CHATGPT_PRODUCT_ENTRY.sharedClinicalPicker, 'excluded'); assert.equal(CHATGPT_PRODUCT_ENTRY.persistence, 'none');
    assert.throws(() => admitClinicalChatGptContext({ selectionRevision: 'synthetic', sourceIdsAndDigests: [], dataGovernanceDecisionId: 'not-a-real-admission', current: () => true }));
    const f = createProductFixture(t); const snapshot = await f.ready();
    const choice = snapshot.catalog!.choices[0]; const request = selectProductOption(snapshot, choice.optionId);
    assert.deepEqual(request, { modelOptionId: choice.optionId, expectedCatalogRevision: snapshot.catalog!.revision });
    assert.throws(() => selectProductOption({ ...snapshot, state: 'held' }, choice.optionId));
    assert.throws(() => selectProductOption(snapshot, 'arbitrary-model'));
});
