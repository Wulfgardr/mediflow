/* source wiring checks. Actual DOM acceptance is the separate .spec.ts. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { PRODUCT_MUTATIONS } = await import('../../lib/chatgpt-product/product-contract.ts');
test('every dedicated route dispatches one fixed operation with Node runtime and no generic RPC bridge', () => {
    for (const operation of ['status', ...PRODUCT_MUTATIONS]) {
        const source = readFileSync(resolve('app/api/settings/ai/chatgpt/synthesis', operation, 'route.ts'), 'utf8');
        assert.ok(source.includes(`handleChatGptProductRequest(request, '${operation}')`));
        assert.ok(source.includes(operation === 'status' ? 'function GET' : 'function POST'));
        assert.doesNotMatch(source, /request\.json|apiKey|\.request\(/);
    }
});
test('dedicated page mounts real product panel independently of account control', () => {
    const panel = readFileSync(resolve('components/settings/chatgpt-synthesis-panel.tsx'), 'utf8');
    assert.doesNotMatch(panel, /dangerouslySetInnerHTML|localStorage|<iframe|<textarea/);
});

test('browser spec stays ESM under the unchanged Node24 loader classification', () => {
    const spec = readFileSync(resolve('e2e/chatgpt-synthesis-product.spec.ts'), 'utf8');
    const usesCommonJs = /\brequire\s*\(/u.test(spec) || /\bmodule\.exports\b/u.test(spec);
    const usesEsm = /\bimport\.meta\b/u.test(spec);
    assert.equal(usesCommonJs, false); assert.equal(usesEsm, true);
    assert.match(spec, /\bimport\s*\{\s*chromium\s*,\s*expect\s*(?:,[^}]+)?\}\s*from\s*['"]@playwright\/test['"]/u);
    assert.match(spec, /\bimport\.meta\.resolve\(['"]next\/dist\/bin\/next['"]\)/u);
    assert.doesNotMatch(spec, /\b(?:createRequire|packageRequire)\b/u);
});
