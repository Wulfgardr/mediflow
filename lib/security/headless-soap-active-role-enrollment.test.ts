/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import {
    createHeadlessSoapActiveRoleEnrollmentService,
    HeadlessSoapActiveRoleEnrollmentError,
    type HeadlessSoapActiveRoleEnrollmentSources,
} from './headless-soap-active-role-enrollment.ts';

const PIN = '2468';
const ACTOR = 'synthetic-soap-enrollment-actor';
const USERNAME = 'synthetic-soap-admin';
const SESSION_ID = 'a'.repeat(64);
const NOW = Math.floor(Date.now() / 1_000) * 1_000;
const TTL_MS = 8 * 60 * 60 * 1_000;
// @Codex: future fixtures must remain future under full-suite CI scheduling.
const FUTURE = NOW + TTL_MS;
const baseSession = { id: SESSION_ID, userId: ACTOR, username: USERNAME, role: 'admin', authChannel: 'web', createdAt: NOW - 2_000, expiresAt: NOW + TTL_MS };
function session(change: Record<string, unknown> = {}): unknown {
    return Object.freeze(Object.assign(Object.create(null), baseSession, change));
}
function attestation(change: Record<string, unknown> = {}): unknown {
    return Object.freeze(Object.assign(Object.create(null), {
        attestationRef: `hsar_${'b'.repeat(32)}`, actorRef: ACTOR,
        schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1', role: 'physician',
        operationId: 'mediflow.clinical_diary.append_soap.v1', policyVersion: 'clinician_confirmed_single_use.v1',
        status: 'active', attestationVersion: 1, issuerRef: `hsari_${'c'.repeat(32)}`,
        activatedAt: new Date(NOW - 1_000), expiresAt: new Date(NOW - 1_000 + TTL_MS),
        revocationGeneration: 0, revokedAt: null, createdAt: new Date(NOW - 2_000), updatedAt: new Date(NOW - 1_000),
    }, change));
}
function sources(overrides: Partial<HeadlessSoapActiveRoleEnrollmentSources> = {}): HeadlessSoapActiveRoleEnrollmentSources {
    return {
        resolveCurrentWebAdmin: async () => session(),
        verifyCredentials: async () => ({ kind: 'verified', account: { id: ACTOR, username: USERNAME, role: 'admin', encryptedMasterKey: 'ignored' } }),
        readAttestation: () => ({ kind: 'missing' }),
        createInactive: () => ({ kind: 'ok', value: attestation({ status: 'inactive', issuerRef: null, activatedAt: null, expiresAt: null }) }),
        activate: () => ({ kind: 'ok', value: attestation() }),
        ...overrides,
    };
}
function hasCode(code: string) {
    return (error: unknown) => error instanceof HeadlessSoapActiveRoleEnrollmentError
        && error.code === code && !error.message.includes(PIN) && !error.message.includes(ACTOR);
}

test('enrolls only the current Web admin with host username and a three-field non-authority projection', async () => {
    const trace: string[] = [];
    const service = createHeadlessSoapActiveRoleEnrollmentService(sources({
        resolveCurrentWebAdmin: async () => { trace.push(trace.length === 0 ? 'resolve-before' : 'resolve-after'); return session(); },
        verifyCredentials: async (input) => { trace.push('verify'); assert.deepEqual(input, { username: USERNAME, pin: PIN }); return { kind: 'verified', account: { id: ACTOR, username: USERNAME, role: 'admin' } }; },
        readAttestation: (actorRef) => { trace.push(`read:${actorRef}`); return { kind: 'missing' }; },
        createInactive: (actorRef) => { trace.push(`create:${actorRef}`); return { kind: 'ok', value: attestation({ status: 'inactive', issuerRef: null, activatedAt: null, expiresAt: null }) }; },
        activate: (actorRef) => { trace.push(`activate:${actorRef}`); return { kind: 'ok', value: attestation() }; },
    }));
    const projection = await service.enroll(PIN);
    assert.deepEqual(trace, ['resolve-before', 'verify', 'resolve-after', `read:${ACTOR}`, `create:${ACTOR}`, `activate:${ACTOR}`]);
    assert.deepEqual({ ...projection }, { schemaVersion: 'mediflow.headless-soap-active-role-enrollment.v1', status: 'active', attestationVersion: 1 });
    assert.equal(Object.getPrototypeOf(projection), null); assert.equal(Object.isFrozen(projection), true); assert.equal(service.enroll.length, 1);
    assert.equal(JSON.stringify(projection).includes(PIN) || JSON.stringify(projection).includes(ACTOR), false);
});

test('activates an existing attestation without recreating it and preserves store conflicts', async () => {
    let creates = 0;
    const service = createHeadlessSoapActiveRoleEnrollmentService(sources({
        readAttestation: () => ({ kind: 'ok', value: attestation({ status: 'inactive', issuerRef: null, activatedAt: null, expiresAt: null }) }),
        createInactive: () => { creates++; return { kind: 'unavailable' }; },
    }));
    assert.equal((await service.enroll(PIN)).status, 'active'); assert.equal(creates, 0);
    await assert.rejects(createHeadlessSoapActiveRoleEnrollmentService(sources({ activate: () => ({ kind: 'conflict' }) })).enroll(PIN), hasCode('enrollment_conflict'));
});

test('denies invalid PIN, non-current session, credential mismatch, and every session drift before storage', async () => {
    for (const invalid of [null, '123', '123456789']) {
        let observed = 0;
        await assert.rejects(createHeadlessSoapActiveRoleEnrollmentService(sources({ resolveCurrentWebAdmin: async () => { observed++; return session(); } })).enroll(invalid as never), hasCode('enrollment_denied'));
        assert.equal(observed, 0);
    }
    for (const current of [null, session({ role: 'doctor' }), session({ authChannel: 'native' }), session({ createdAt: NOW - 2_000, expiresAt: NOW - 1_000 }), session({ createdAt: FUTURE, expiresAt: FUTURE + TTL_MS })]) {
        let verified = 0;
        await assert.rejects(createHeadlessSoapActiveRoleEnrollmentService(sources({ resolveCurrentWebAdmin: async () => current, verifyCredentials: async () => { verified++; return { kind: 'denied' }; } })).enroll(PIN), hasCode('enrollment_denied'));
        assert.equal(verified, 0);
    }
    for (const account of [{ id: 'other', username: USERNAME, role: 'admin' }, { id: ACTOR, username: 'other', role: 'admin' }, { id: ACTOR, username: USERNAME, role: 'doctor' }]) {
        let stores = 0;
        await assert.rejects(createHeadlessSoapActiveRoleEnrollmentService(sources({ verifyCredentials: async () => ({ kind: 'verified', account }), readAttestation: () => { stores++; return { kind: 'missing' }; } })).enroll(PIN), hasCode('enrollment_denied'));
        assert.equal(stores, 0);
    }
    for (const [key, value] of [['id', 'd'.repeat(64)], ['userId', 'other'], ['username', 'other'], ['role', 'doctor'], ['authChannel', 'native'], ['createdAt', 2_000], ['expiresAt', 9_000_000_000_000]] as const) {
        let calls = 0;
        await assert.rejects(createHeadlessSoapActiveRoleEnrollmentService(sources({ resolveCurrentWebAdmin: async () => (++calls === 1 ? session() : session({ [key]: value })) })).enroll(PIN), hasCode('enrollment_denied'));
    }
});

test('maps dependency and forged lifecycle failures to sanitized fail-closed errors', async () => {
    await assert.rejects(createHeadlessSoapActiveRoleEnrollmentService(sources({ readAttestation: () => { throw new Error(`${PIN}:${ACTOR}:sqlite`); } })).enroll(PIN), hasCode('storage_unavailable'));
    await assert.rejects(createHeadlessSoapActiveRoleEnrollmentService(sources({ readAttestation: () => ({ kind: 'unavailable' }) })).enroll(PIN), hasCode('storage_unavailable'));
    for (const forged of [attestation({ actorRef: 'other' }), attestation({ status: 'revoked', revocationGeneration: 1 }),
        attestation({ activatedAt: new Date(NOW - TTL_MS - 1_000), expiresAt: new Date(NOW - 1_000), createdAt: new Date(NOW - TTL_MS - 2_000), updatedAt: new Date(NOW - TTL_MS - 1_000) }),
        attestation({ activatedAt: new Date(FUTURE), expiresAt: new Date(FUTURE + TTL_MS), updatedAt: new Date(FUTURE) }),
        attestation({ expiresAt: new Date(NOW - 999) })]) {
        await assert.rejects(createHeadlessSoapActiveRoleEnrollmentService(sources({ activate: () => ({ kind: 'ok', value: forged }) })).enroll(PIN), hasCode('storage_unavailable'));
    }
});

test('keeps H2a-E source separate from review authority, routes, Fabric, and clinical writers', () => {
    const source = fs.readFileSync(new URL('./headless-soap-active-role-enrollment.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /physician-review|fresh-review-pin|authenticated-review|active-review-binding|fabric|route|clinical-diary-writer/iu);
});
