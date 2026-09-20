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

test('canonical URI data exception is confined to the exact native codec fixture', () => {
    const fixture = 'native/MediFlowMac/Tests/MediFlowCoreTests/DiagnosesCodecProvenanceTests.swift';
    const uri = 'http://id.who.int/icd/release/11/2026-01/mms/1000000001';
    assert.equal(isExternalUrlLiteralAllowed(fixture, uri, `let uri = "${uri}"`), true);
    assert.equal(isExternalUrlLiteralAllowed(fixture, uri + '?q=other', `let uri = "${uri}?q=other"`), false);
    assert.equal(isExternalUrlLiteralAllowed(fixture, uri.replace('1000000001', '1000000002'),
        `let uri = "${uri.replace('1000000001', '1000000002')}"`), false);
    assert.equal(isExternalUrlLiteralAllowed('native/MediFlowMac/Sources/MediFlowCore/DiagnosesCodec.swift',
        uri, `let uri = "${uri}"`), false);
});

/* @Codex: pin each new exception to its exact source line and file. */
const pairedWhoUrlSeams = [
  [
    "lib/reference-data/icd11-who-network-route.test.ts",
    "const URI = 'http://id.who.int/icd/release/11/2026-01/mms/1000000001';"
  ],
  [
    "lib/reference-data/icd11-who-network-route.test.ts",
    "        new Request(`https://synthetic.invalid/api/v1/network/terminology/who/${op}${suffix}`, { signal });"
  ],
  [
    "lib/reference-data/icd11-who-network-route.test.ts",
    "        { ...valid, entries: [{ ...valid.entries[0], canonicalUri: 'https://example.invalid/' }] },"
  ],
  [
    "native/MediFlowMac/Sources/MediFlowAppleShared/HomeBaseWHOModels.swift",
    "    private static let mms = \"http://id.who.int/icd/release/11/2026-01/mms/\""
  ],
  [
    "native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBaseWHOContractTests.swift",
    "    static let uri = \"http://id.who.int/icd/release/11/2026-01/mms/1000000001\""
  ],
  [
    "native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBaseWHOContractTests.swift",
    "        \"http://id.who.int/icd/release/11/2026-01/mms/codeinfo/\" + code.replacingOccurrences(of: \"&\", with: \"%26\").replacingOccurrences(of: \"/\", with: \"%2F\")"
  ],
  [
    "native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBaseWHOContractTests.swift",
    "        for (key, value) in [(\"code\", \"N/A\"), (\"code\", \"AA00&&XA00\"), (\"canonicalUri\", \"https://example.invalid/\"), (\"canonicalUri\", WHOSyntheticFixtures.uri.replacingOccurrences(of: \"2026-01\", with: \"2025-01\")), (\"description\", \"<b>term</b>\"), (\"description\", \" term\"), (\"description\", \"term\\u{200f}\"), (\"system\", \"ICD-10\"), (\"vendor\", \"unexpected\")] {"
  ],
  [
    "native/MediFlowMac/Tests/MediFlowAppleSharedTests/RepertoriWHOStoreTests.swift",
    "                            token: String = \"synthetic-token\", server: String = \"https://synthetic.invalid\","
  ],
  [
    "native/MediFlowMac/Tests/MediFlowAppleSharedTests/RepertoriWHOStoreTests.swift",
    "            case \"server\": current = connection(source, server: \"https://new-synthetic.invalid\")"
  ]
];
test('paired WHO exceptions reject changed URLs, extra URLs and other paths', () => {
    for (const [path, line] of pairedWhoUrlSeams) {
        const url = line.match(/https?:\/\/[^"'`\s]+/u)[0];
        assert.equal(isExternalUrlLiteralAllowed(path, url, line), true, path);
        assert.equal(isExternalUrlLiteralAllowed('lib/unrelated.ts', url, line), false);
        assert.equal(isExternalUrlLiteralAllowed(path, url + '?changed', line.replace(url, url + '?changed')), false);
        assert.equal(isExternalUrlLiteralAllowed(path, url, line + ' https://unapproved.invalid'), false);
    }
});
