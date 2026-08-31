#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3200';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-network-smoke-local-token';
const USERNAME = process.env.E2E_USERNAME || 'admin';
const PIN = process.env.E2E_PIN || '1234';
const CATALOG_READ_CAPABILITY = 'network.catalogs.readonly';
const REPORT_PATH = resolveReportPath();
const TERMINOLOGY_PARITY = JSON.parse(fs.readFileSync(
    new URL('../native/contracts/terminology-parity.v1.json', import.meta.url),
    'utf8',
));

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-catalog-read] Report written to ${REPORT_PATH}`);
});

test('home-base catalog read is paired, capability-gated and response-compatible', async () => {
    await assertServerReady();
    await enableHomeBaseMode();
    await seedCatalogs();

    const catalogClient = await pairClient([CATALOG_READ_CAPABILITY], 'Desk iPad catalog');
    const noCatalogClient = await pairClient(['network.replica.readonly-patients'], 'Desk iPad patients-only');

    const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(login.response.status, 200);
    const sessionCookie = extractSessionCookie(login.response);
    assert.ok(sessionCookie);

    const catalogHeaders = pairedHeaders(catalogClient);

    const missingSession = await request('GET', '/api/v1/network/drugs?q=amoxi', {
        headers: catalogHeaders,
    });
    assert.equal(missingSession.response.status, 401);

    const missingCapability = await request('GET', '/api/v1/network/drugs?q=amoxi', {
        headers: {
            ...pairedHeaders(noCatalogClient),
            Cookie: sessionCookie,
        },
    });
    assert.equal(missingCapability.response.status, 403);

    const authenticatedHeaders = {
        ...catalogHeaders,
        Cookie: sessionCookie,
    };

    const drugsHost = await request('GET', '/api/v1/drugs?q=amoxi&limit=10', {
        headers: localApiHeaders(),
    });
    const drugsNetwork = await request('GET', '/api/v1/network/drugs?q=amoxi&limit=10', {
        headers: authenticatedHeaders,
    });
    assert.equal(drugsHost.response.status, 200);
    assert.equal(drugsNetwork.response.status, 200);
    assert.deepEqual(drugsNetwork.json, drugsHost.json);
    assert.ok(Array.isArray(drugsNetwork.json));
    assert.deepEqual(drugsNetwork.json[0], TERMINOLOGY_PARITY.webDrug);
    assertDrugSummary(drugsNetwork.json[0]);

    const exemptionsHost = await request('GET', '/api/v1/exemptions?q=E01&limit=10', {
        headers: localApiHeaders(),
    });
    const exemptionsNetwork = await request('GET', '/api/v1/network/exemptions?q=E01&limit=10', {
        headers: authenticatedHeaders,
    });
    assert.equal(exemptionsHost.response.status, 200);
    assert.equal(exemptionsNetwork.response.status, 200);
    assert.deepEqual(exemptionsNetwork.json, exemptionsHost.json);
    assert.ok(Array.isArray(exemptionsNetwork.json));
    assertExemptionSummary(exemptionsNetwork.json[0]);

    const terminologyCounts = {};
    for (const expected of TERMINOLOGY_PARITY.items) {
        const searchParams = new URLSearchParams({
            system: expected.system,
            q: TERMINOLOGY_PARITY.searchQueries[expected.system],
            limit: '10',
        });
        const searchPath = `/terminology/search?${searchParams}`;
        const terminologySearchHost = await request('GET', `/api/v1${searchPath}`, {
            headers: localApiHeaders(),
        });
        const terminologySearchNetwork = await request('GET', `/api/v1/network${searchPath}`, {
            headers: authenticatedHeaders,
        });
        assert.equal(terminologySearchHost.response.status, 200);
        assert.equal(terminologySearchNetwork.response.status, 200);
        assert.deepEqual(terminologySearchNetwork.json, terminologySearchHost.json);
        assert.ok(Array.isArray(terminologySearchNetwork.json));
        const matched = terminologySearchNetwork.json.find((item) => item.code === expected.code);
        assert.deepEqual(matched, expected);
        assertTerminologyItem(matched);
        terminologyCounts[expected.system] = terminologySearchNetwork.json.length;

        const resolveParams = new URLSearchParams({ system: expected.system, code: expected.code });
        const resolvePath = `/terminology/resolve?${resolveParams}`;
        const terminologyResolveHost = await request('GET', `/api/v1${resolvePath}`, {
            headers: localApiHeaders(),
        });
        const terminologyResolveNetwork = await request('GET', `/api/v1/network${resolvePath}`, {
            headers: authenticatedHeaders,
        });
        assert.equal(terminologyResolveHost.response.status, 200);
        assert.equal(terminologyResolveNetwork.response.status, 200);
        assert.deepEqual(terminologyResolveNetwork.json, terminologyResolveHost.json);
        assert.deepEqual(terminologyResolveNetwork.json, expected);
    }

    const terminologySystemsHost = await request('GET', '/api/v1/terminology/systems', {
        headers: localApiHeaders(),
    });
    const terminologySystemsNetwork = await request('GET', '/api/v1/network/terminology/systems', {
        headers: authenticatedHeaders,
    });
    assert.equal(terminologySystemsHost.response.status, 200);
    assert.equal(terminologySystemsNetwork.response.status, 200);
    assert.deepEqual(terminologySystemsNetwork.json, terminologySystemsHost.json);
    assert.ok(Array.isArray(terminologySystemsNetwork.json));
    const focusedSystems = terminologySystemsNetwork.json
        .filter((item) => TERMINOLOGY_PARITY.systems.includes(item.system));
    assert.deepEqual(focusedSystems, TERMINOLOGY_PARITY.registry);

    const resolveMissing = await request('GET', '/api/v1/network/terminology/resolve?system=ATC&code=J99ZZ99', {
        headers: authenticatedHeaders,
    });
    assert.equal(resolveMissing.response.status, 404);
    assert.equal(resolveMissing.json?.error, 'Not found');

    scenarioResults.push({
        name: 'home-base catalog read pairing flow',
        catalogClientId: catalogClient.clientId,
        missingSessionStatus: missingSession.response.status,
        missingCapabilityStatus: missingCapability.response.status,
        drugsCount: drugsNetwork.json.length,
        exemptionsCount: exemptionsNetwork.json.length,
        terminologyCount: terminologyCounts.ATC,
        terminologyCounts,
    });
});

async function assertServerReady() {
    const response = await request('GET', '/api/v1/ambulatories', {
        headers: localApiHeaders(),
    });
    assert.equal(response.response.status, 200, `Expected ${BASE_URL}/api/v1/ambulatories to be reachable`);
}

async function enableHomeBaseMode() {
    const networkMode = await request('PUT', '/api/settings/network.mode', {
        headers: localApiHeaders(),
        body: { value: 'network-home-base' },
    });
    assert.equal(networkMode.response.status, 200);

    const clinicName = await request('PUT', '/api/settings/clinicName', {
        headers: localApiHeaders(),
        body: { value: 'MediFlow Catalog Smoke' },
    });
    assert.equal(clinicName.response.status, 200);
}

async function seedCatalogs() {
    const drugs = await request('POST', '/api/v1/drugs', {
        headers: localApiHeaders(),
        body: [TERMINOLOGY_PARITY.webDrug],
    });
    assert.equal(drugs.response.status, 200);
    assert.equal(drugs.json?.success, true);

    const exemptions = await request('POST', '/api/v1/exemptions', {
        headers: localApiHeaders(),
        body: [
            {
                code: 'E01',
                description: 'Esenzione catalog smoke',
                type: 'chronic',
                source: 'network-home-base-catalog-read-smoke',
                isPharma: true,
                isSpecialist: true,
                isNational: true,
            },
        ],
    });
    assert.equal(exemptions.response.status, 200);
    assert.equal(exemptions.json?.success, true);
}

async function pairClient(requestedCapabilities, deviceName) {
    const pairingIntent = await request('POST', '/api/v1/network/pairing-intents', {
        body: {
            deviceName,
            clientPlatform: 'ipados',
            appVersion: '0.7.1-catalog-smoke',
            requestedCapabilities,
        },
    });
    assert.equal(pairingIntent.response.status, 201);
    assert.equal(pairingIntent.json?.status, 'pending-home-base-confirmation');
    const intentId = pairingIntent.json?.intentId;
    assert.ok(typeof intentId === 'string' && intentId.length > 0);

    const pairingConfirmation = await request(
        'POST',
        `/api/v1/network/pairing-intents/${intentId}/confirm`,
        {
            headers: localApiHeaders(),
        },
    );
    assert.equal(pairingConfirmation.response.status, 201);
    assert.equal(pairingConfirmation.json?.status, 'paired');
    const clientId = pairingConfirmation.json?.pairedClient?.clientId;
    const token = pairingConfirmation.json?.pairedClientToken;
    assert.ok(typeof clientId === 'string' && clientId.length > 0);
    assert.ok(typeof token === 'string' && token.length > 0);

    return { clientId, token, intentId };
}

function assertDrugSummary(item) {
    assert.ok(item);
    assert.equal(typeof item.aic, 'string');
    assert.equal(typeof item.name, 'string');
    assert.ok(Object.hasOwn(item, 'activePrinciple'));
    assert.ok(Object.hasOwn(item, 'company'));
    assert.ok(Object.hasOwn(item, 'packaging'));
    assert.ok(Object.hasOwn(item, 'class'));
    assert.ok(Object.hasOwn(item, 'price'));
    assert.ok(Object.hasOwn(item, 'atc'));
}

function assertExemptionSummary(item) {
    assert.ok(item);
    assert.equal(typeof item.code, 'string');
    assert.equal(typeof item.description, 'string');
    assert.ok(Object.hasOwn(item, 'type'));
    assert.ok(Object.hasOwn(item, 'source'));
    assert.ok(Object.hasOwn(item, 'startDate'));
    assert.ok(Object.hasOwn(item, 'endDate'));
    assert.ok(Object.hasOwn(item, 'isPharma'));
    assert.ok(Object.hasOwn(item, 'isSpecialist'));
    assert.ok(Object.hasOwn(item, 'isNational'));
    assert.ok(Object.hasOwn(item, 'updatedAt'));
}

function assertTerminologyItem(item) {
    assert.ok(item);
    assert.equal(typeof item.system, 'string');
    assert.equal(typeof item.code, 'string');
    assert.equal(typeof item.display, 'string');
    assert.equal(typeof item.source, 'string');
    assert.ok(Object.hasOwn(item, 'version'));
}

function localApiHeaders() {
    return {
        Authorization: `Bearer ${LOCAL_API_TOKEN}`,
        'Cache-Control': 'no-store',
    };
}

function pairedHeaders(client) {
    return {
        'x-mediflow-paired-client-id': client.clientId,
        'x-mediflow-paired-client-token': client.token,
    };
}

function extractSessionCookie(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const cookieSource = setCookies.find((cookie) => cookie.startsWith('mediflow_session='))
        ?? response.headers.get('set-cookie');
    if (!cookieSource) {
        throw new Error('mediflow_session cookie was not returned by /api/auth/login');
    }

    return cookieSource.split(';')[0];
}

async function request(method, pathname, { headers = {}, body } = {}) {
    const url = new URL(pathname, BASE_URL);
    const finalHeaders = { ...headers };
    let payload;

    if (body !== undefined) {
        finalHeaders['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }

    const response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: payload,
    });

    const text = await response.text();
    let json = null;
    if (text.length > 0) {
        try {
            json = JSON.parse(text);
        } catch {
            json = text;
        }
    }

    return { response, json, text };
}

function resolveReportPath() {
    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_E2E_DATA_DIR;
    if (dataDir) {
        return path.join(dataDir, 'reports', 'network-home-base-catalog-read-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-catalog-read-report.json');
}
