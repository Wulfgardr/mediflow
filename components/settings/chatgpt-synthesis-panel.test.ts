/* @Codex — source wiring checks. Actual DOM acceptance is the separate .spec.ts. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { PRODUCT_MUTATIONS } = await import('../../lib/chatgpt-product/product-contract.ts');
test('every dedicated route dispatches one fixed operation with Node runtime and no generic RPC bridge', () => {
    for (const operation of ['status', ...PRODUCT_MUTATIONS]) {
        const source = readFileSync(resolve('app/api/settings/ai/chatgpt/synthesis', operation, 'route.ts'), 'utf8');
        assert.match(source, /runtime = 'nodejs'/); assert.match(source, /dynamic = 'force-dynamic'/);
        assert.ok(source.includes(`handleChatGptProductRequest(request, '${operation}')`));
        assert.ok(source.includes(operation === 'status' ? 'function GET' : 'function POST'));
        assert.doesNotMatch(source, /request\.json|apiKey|\.request\(/);
    }
});
test('dedicated page mounts real product panel independently of account control', () => {
    const page = readFileSync(resolve('app/settings/ai/chatgpt/page.tsx'), 'utf8');
    assert.match(page, /<ChatGptSynthesisPanel/); assert.match(page, /<ChatGptAccountPanel/);
    const panel = readFileSync(resolve('components/settings/chatgpt-synthesis-panel.tsx'), 'utf8');
    assert.match(panel, /createProductBrowser/); assert.match(panel, /useSecurity/); assert.match(panel, /!isLocked/);
    assert.match(panel, /Gen[e]?ra sintesi DEMO/); assert.match(panel, /Fonte|Fonti/); assert.match(panel, /synthesis-receipt/);
    assert.doesNotMatch(panel, /dangerouslySetInnerHTML|localStorage|<iframe|<textarea/);
});

test('browser spec stays ESM under the unchanged Node24 loader classification', () => {
    const spec = readFileSync(resolve('e2e/chatgpt-synthesis-product.spec.ts'), 'utf8');
    const usesCommonJs = /\brequire\s*\(/u.test(spec) || /\bmodule\.exports\b/u.test(spec);
    const usesEsm = /\bimport\.meta\b/u.test(spec);
    assert.equal(usesCommonJs, false); assert.equal(usesEsm, true);
    assert.match(spec, /packageRequire\('@playwright\/test'\)/u);
    assert.match(spec, /409 pending challenge survives local polls/u);
    assert.match(spec, /\[1280, 390\]/u);
});
