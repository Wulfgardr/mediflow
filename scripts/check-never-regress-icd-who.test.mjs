/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isExternalUrlLiteralAllowed,
    validateIcd11WhoRouteSource,
} from './check-never-regress.mjs';

const canonicalRoute = `
import type { NextRequest } from 'next/server';

import { createIcd11WhoHttpRoute } from '@/lib/reference-data/icd11-who-http-route';
import { getIcd11WhoProductionRuntime } from '@/lib/reference-data/icd11-who-production';
import { requireSession } from '@/lib/security/server-auth';

const handleIcd11WhoRequest = createIcd11WhoHttpRoute(Object.freeze({
    authorize: async () => (await requireSession()) !== null,
    getRuntime: getIcd11WhoProductionRuntime,
}));

export async function GET(request: NextRequest): Promise<Response> {
    return handleIcd11WhoRequest(request);
}
`;

test('accepts only the thin authenticated server-owned WHO route', () => {
    assert.deepEqual(validateIcd11WhoRouteSource(canonicalRoute), []);
});

test('denies auth, runtime, target and raw-provider regressions in the WHO route', () => {
    const probes = [
        canonicalRoute.replace('requireSession }', 'requireSession as authorize }'),
        canonicalRoute.replace('await requireSession()', 'await authorize()'),
        canonicalRoute.replace('async () => (await requireSession()) !== null', 'async () => true'),
        canonicalRoute.replace('getRuntime: getIcd11WhoProductionRuntime', 'getRuntime: () => ({})'),
        canonicalRoute.replace(
            'const handleIcd11WhoRequest',
            "const ICD_BASE_URL = 'http://127.0.0.1:8888';\nconst handleIcd11WhoRequest",
        ),
        canonicalRoute.replace(
            'return handleIcd11WhoRequest(request);',
            "return fetch('https://id.who.int', { body: JSON.stringify({ destinationEntities: [] }) });",
        ),
    ];
    for (const source of probes) assert.notDeepEqual(validateIcd11WhoRouteSource(source), []);
});

test('keeps external URL exceptions exact to their production or synthetic-test seam', () => {
    const syntheticRoute = 'https://mediflow.local/api/icd/proxy?q=synthetic';
    assert.equal(isExternalUrlLiteralAllowed(
        'lib/reference-data/icd11-who-http-route.test.ts',
        syntheticRoute,
        `new Request('${syntheticRoute}')`,
    ), true);
    assert.equal(isExternalUrlLiteralAllowed('app/api/icd/proxy/route.ts', syntheticRoute, syntheticRoute), false);
    assert.equal(isExternalUrlLiteralAllowed('lib/unrelated.test.ts', syntheticRoute, syntheticRoute), false);
    assert.equal(isExternalUrlLiteralAllowed(
        'lib/reference-data/icd11-who-http-route.test.ts',
        'https://mediflow.local/api/icd/other',
        "new Request('https://mediflow.local/api/icd/other')",
    ), false);

    const tokenEndpoint = 'https://icdaccessmanagement.who.int/connect/token';
    assert.equal(isExternalUrlLiteralAllowed(
        'lib/reference-data/icd11-who-node-https-client.ts',
        tokenEndpoint,
        `const endpoint = '${tokenEndpoint}'`,
    ), true);
    assert.equal(isExternalUrlLiteralAllowed('lib/unrelated.ts', tokenEndpoint, tokenEndpoint), false);
    assert.equal(isExternalUrlLiteralAllowed(
        'lib/reference-data/icd11-who-node-https-client.ts',
        `${tokenEndpoint}?redirect=caller`,
        `const endpoint = '${tokenEndpoint}?redirect=caller'`,
    ), false);

    const hostileEndpoint = 'https://caller.invalid';
    assert.equal(isExternalUrlLiteralAllowed(
        'lib/reference-data/icd11-who-server-owner.test.ts',
        hostileEndpoint,
        `{ endpoint: '${hostileEndpoint}' }`,
    ), true);
    assert.equal(isExternalUrlLiteralAllowed('lib/reference-data/icd11-who-server-owner.ts', hostileEndpoint, hostileEndpoint), false);
    assert.equal(isExternalUrlLiteralAllowed(
        'lib/reference-data/icd11-who-server-owner.test.ts',
        'https://caller.invalid.evil',
        "{ endpoint: 'https://caller.invalid.evil' }",
    ), false);
});
