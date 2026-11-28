import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { settings } from '@/lib/schema';
import { installNetworkPatientCookieFixture } from '@/lib/network-patient-authority-test-fixture';
import { syntheticWebClientRequest as localRequest } from '@/lib/security/loopback-ingress-test-fixture';
import {
    PERSONAL_CANDIDATE_REVIEW_SETTING_KEY,
    PERSONAL_SERVICE_CANDIDATE_KIND,
    emptyPersonalCandidateReviewStore,
    keepCandidateDecision,
    serializePersonalCandidateReviewStore,
    type RecurringServiceGroupCandidate,
} from './index';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-candidate-review-cas-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
process.env.MEDIFLOW_LOCAL_API_TOKEN = randomBytes(32).toString('hex');

const cookieState = { cookies: new Map<string, string>(), headers: localRequest('http://127.0.0.1').headers };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('../db-server.ts') as typeof import('../db-server');
openDbServer();

const checkRoute = load('../../app/api/auth/check/route.ts') as typeof import('../../app/api/auth/check/route');
const setupRoute = load('../../app/api/auth/setup/route.ts') as typeof import('../../app/api/auth/setup/route');
const settingRoute = load('../../app/api/settings/[key]/route.ts') as typeof import('../../app/api/settings/[key]/route');
const bulkSettingsRoute = load('../../app/api/settings/route.ts') as typeof import('../../app/api/settings/route');

test.after(() => {
    cleanupCookies();
    rmSync(dataDir, { recursive: true, force: true });
});

function cookieValue(response: Response, name: string): string {
    const fields = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie') ?? ''];
    for (const field of fields) {
        const match = field.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`, 'u'));
        if (match) return match[1]!;
    }
    throw new Error(`missing ${name} cookie`);
}

function makeCandidate(id: string, codeA: string, codeB: string): RecurringServiceGroupCandidate {
    return {
        kind: PERSONAL_SERVICE_CANDIDATE_KIND,
        id,
        signature: id,
        services: [
            { key: `code:regional:${codeA}`, codeSystem: 'REGIONAL', serviceCode: codeA, serviceName: `Prestazione ${codeA}`, category: 'lab' },
            { key: `code:regional:${codeB}`, codeSystem: 'REGIONAL', serviceCode: codeB, serviceName: `Prestazione ${codeB}`, category: 'lab' },
        ],
        prescriptionCount: 5,
        patientCount: 3,
        diagnoses: [],
        primaryDiagnosis: null,
        sufficiency: 'sufficient',
    };
}

const context = { params: Promise.resolve({ key: PERSONAL_CANDIDATE_REVIEW_SETTING_KEY }) };

test('WUL-923: revisione candidati richiede sessione web, precondizione CAS e rifiuta scritture stale o bulk', async () => {
    const check = await checkRoute.GET(localRequest('http://127.0.0.1/api/auth/check'));
    assert.equal(check.status, 200);
    const control = cookieValue(check, 'mediflow_auth_control');
    const etag = check.headers.get('etag');
    assert.ok(etag);
    const username = ['synthetic', 'review', 'web'].join('-');
    const password = createHash('sha256').update(`${username}-pin`).digest('hex').slice(0, 16);
    const setup = await setupRoute.POST(localRequest('http://127.0.0.1/api/auth/setup', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mediflow_auth_control=${control}`,
            'if-match': etag,
            'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
            username,
            password,
            encryptedMasterKey: 'synthetic-wrapped-key',
            salt: 'synthetic-salt',
            displayName: 'Dott. Test',
            ambulatoryName: 'Studio Test',
        }),
    }));
    assert.equal(setup.status, 200);
    const setupBody = (await setup.json()) as { archiveGeneration: string };
    const sessionCookie = cookieValue(setup, 'mediflow_session');
    cookieState.cookies.set('mediflow_auth_control', control);
    cookieState.cookies.set('mediflow_session', sessionCookie);

    const candA = makeCandidate('cand-a', '90.10.1', '90.10.2');
    const candB = makeCandidate('cand-b', '90.20.1', '90.20.2');
    const now = new Date('2026-11-28T16:00:00.000Z');
    const storeA = serializePersonalCandidateReviewStore(keepCandidateDecision(emptyPersonalCandidateReviewStore(), candA, now));
    const storeBOnly = serializePersonalCandidateReviewStore(keepCandidateDecision(emptyPersonalCandidateReviewStore(), candB, now));
    const storeAB = serializePersonalCandidateReviewStore(
        keepCandidateDecision(keepCandidateDecision(emptyPersonalCandidateReviewStore(), candA, now), candB, now),
    );

    const webPut = (body: unknown) => settingRoute.PUT(localRequest(`http://127.0.0.1/api/settings/${PERSONAL_CANDIDATE_REVIEW_SETTING_KEY}`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            cookie: `mediflow_session=${sessionCookie}; mediflow_auth_control=${control}`,
            'x-mediflow-archive-generation': setupBody.archiveGeneration,
        },
        body: JSON.stringify(body),
    }), context);

    const bulkAttempt = await bulkSettingsRoute.POST(localRequest('http://127.0.0.1/api/settings', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mediflow_session=${sessionCookie}; mediflow_auth_control=${control}`,
            'x-mediflow-archive-generation': setupBody.archiveGeneration,
        },
        body: JSON.stringify({ key: PERSONAL_CANDIDATE_REVIEW_SETTING_KEY, value: storeA }),
    }));
    assert.equal(bulkAttempt.status, 400);

    cookieState.cookies.clear();
    const localTokenAttempt = await settingRoute.PUT(new Request(`http://127.0.0.1/api/settings/${PERSONAL_CANDIDATE_REVIEW_SETTING_KEY}`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${process.env.MEDIFLOW_LOCAL_API_TOKEN}`,
        },
        body: JSON.stringify({ value: storeA, expectedValue: null }),
    }), context);
    assert.equal(localTokenAttempt.status, 403);

    cookieState.cookies.set('mediflow_auth_control', control);
    cookieState.cookies.set('mediflow_session', sessionCookie);

    assert.equal((await webPut({ value: storeA })).status, 400);
    assert.equal((await webPut({ value: '{invalid-json', expectedValue: null })).status, 400);

    const firstWrite = await webPut({ value: storeA, expectedValue: null });
    assert.equal(firstWrite.status, 200);

    const staleWrite = await webPut({ value: storeBOnly, expectedValue: null });
    assert.equal(staleWrite.status, 409);
    const conflictBody = (await staleWrite.json()) as { code: string; value: string };
    assert.equal(conflictBody.code, 'PERSONAL_CANDIDATE_REVIEW_CONFLICT');
    assert.equal(conflictBody.value, storeA);

    const mergedWrite = await webPut({ value: storeAB, expectedValue: conflictBody.value });
    assert.equal(mergedWrite.status, 200);

    const stored = dbServer.select().from(settings).where(eq(settings.key, PERSONAL_CANDIDATE_REVIEW_SETTING_KEY)).get()?.value;
    assert.equal(stored, storeAB);
});
