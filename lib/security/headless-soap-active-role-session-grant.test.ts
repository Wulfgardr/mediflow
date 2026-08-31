/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';
import { createHeadlessSoapActiveRoleSessionGrantService, HeadlessSoapActiveRoleSessionGrantError } from './headless-soap-active-role-session-grant.ts';
import type { ServerSession } from './server-session.ts';
import { issueSyntheticWebSession, retireSyntheticWebSession } from './web-auth-lifecycle-owner-test-fixture.ts';
const ACTOR = 'synthetic-soap-grant-actor';
const sessions: ServerSession[] = []; let sequence = 0;
function activeAttestation(now: number, change: Record<string, unknown> = {}): unknown {
    return Object.freeze(Object.assign(Object.create(null), {
        attestationRef: `hsar_${'a'.repeat(32)}`, actorRef: ACTOR, schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1', role: 'physician',
        operationId: 'mediflow.clinical_diary.append_soap.v1', policyVersion: 'clinician_confirmed_single_use.v1', status: 'active', attestationVersion: 1,
        issuerRef: `hsari_${'b'.repeat(32)}`, expiresAt: new Date(now + 8 * 60 * 60 * 1_000), activatedAt: new Date(now),
        revocationGeneration: 0, revokedAt: null, createdAt: new Date(now - 1_000), updatedAt: new Date(now),
    }, change));
}
type FixtureState = { now: number; session: ServerSession | null; attestation: unknown };
function fixture(onSessionRead?: (state: FixtureState, readNumber: number) => void, onAttestationRead?: (state: FixtureState) => void) {
    const session = issueSyntheticWebSession({ id: ACTOR, username: 'synthetic-soap-admin', role: 'admin' }, `soap-grant-${sequence += 1}`);
    sessions.push(session); const state: FixtureState = { now: Math.max(Date.now(), session.createdAt), session, attestation: null }; let sessionReads = 0;
    state.attestation = activeAttestation(state.now);
    const service = createHeadlessSoapActiveRoleSessionGrantService({ readCurrentSession: async () => { onSessionRead?.(state, sessionReads += 1); return state.session; }, readAttestation: () => { onAttestationRead?.(state); return state.attestation; }, clock: () => state.now });
    return { service, session, state };
}
function denied(code: string) {
    return (error: unknown) => error instanceof HeadlessSoapActiveRoleSessionGrantError && error.code === code && !error.message.includes(ACTOR) && !/hsar_|sqlite/iu.test(error.message);
}
afterEach(() => { while (sessions.length) retireSyntheticWebSession(sessions.pop()!); });
test('issues one zero-field process-local grant for the exact current session and attestation', async () => {
    const { service } = fixture(); assert.equal(service.issue.length, 0);
    const first = await service.issue(); const duplicate = await service.issue();
    assert.equal(first, duplicate); assert.equal(await service.recheck(first), first);
    assert.equal(Object.getPrototypeOf(first), null); assert.equal(Object.isFrozen(first), true); assert.deepEqual(Reflect.ownKeys(first), []);
    assert.equal(JSON.stringify(first), '{}');
    for (const foreign of [{}, { ...first }, structuredClone(first), new Proxy(first, {})]) await assert.rejects(service.recheck(foreign), denied('grant_unavailable'));
});
test('denies inactive, revoked, expired, mismatched, or malformed attestations', async () => {
    const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
        [{ status: 'inactive', issuerRef: null, expiresAt: null, activatedAt: null }, 'attestation_inactive'],
        [{ status: 'revoked', revocationGeneration: 1, revokedAt: new Date() }, 'attestation_revoked'],
        [{ expiresAt: new Date(8 * 60 * 60 * 1_000 + 1_000), activatedAt: new Date(1_000), createdAt: new Date(0), updatedAt: new Date(1_000) }, 'attestation_expired'],
        [{ actorRef: 'other' }, 'attestation_unavailable'], [{ role: 'admin' }, 'attestation_unavailable'],
        [{ operationId: 'other' }, 'attestation_unavailable'], [{ policyVersion: 'other' }, 'attestation_unavailable'],
        [{ attestationVersion: 2 }, 'attestation_unavailable'], [{ revocationGeneration: 1 }, 'attestation_unavailable'],
    ];
    for (const [change, code] of cases) { const current = fixture(); current.state.attestation = activeAttestation(current.state.now, change);
        await assert.rejects(current.service.issue(), denied(code)); }
});
test('terminalizes on session, attestation, expiry, lifecycle, and process drift', async () => {
    const attestationDrift = fixture(); const attestationGrant = await attestationDrift.service.issue();
    attestationDrift.state.attestation = activeAttestation(attestationDrift.state.now, { issuerRef: `hsari_${'c'.repeat(32)}` });
    await assert.rejects(attestationDrift.service.recheck(attestationGrant), denied('projection_stale'));
    await assert.rejects(attestationDrift.service.recheck(attestationGrant), denied('grant_unavailable'));
    const sessionDrift = fixture(); const sessionGrant = await sessionDrift.service.issue();
    const replacement = issueSyntheticWebSession({ id: ACTOR, username: 'synthetic-soap-admin', role: 'admin' }, `soap-grant-${sequence += 1}`); sessions.push(replacement);
    sessionDrift.state.session = replacement; sessionDrift.state.now = Math.max(sessionDrift.state.now, replacement.createdAt);
    await assert.rejects(sessionDrift.service.recheck(sessionGrant), denied('projection_stale'));
    const expired = fixture(); const expiredGrant = await expired.service.issue();
    const expiry = (expired.state.attestation as { expiresAt: Date }).expiresAt.getTime(); expired.state.now = expiry;
    await assert.rejects(expired.service.recheck(expiredGrant), denied('grant_unavailable'));
    const retired = fixture(); const retiredGrant = await retired.service.issue(); retireSyntheticWebSession(retired.session);
    await assert.rejects(retired.service.recheck(retiredGrant), denied('grant_unavailable'));
    const restarted = fixture(); const oldGrant = await restarted.service.issue();
    const fresh = createHeadlessSoapActiveRoleSessionGrantService({ readCurrentSession: async () => restarted.state.session, readAttestation: () => restarted.state.attestation, clock: () => restarted.state.now });
    await assert.rejects(fresh.recheck(oldGrant), denied('grant_unavailable'));
});
test('explicit disposal is idempotent and removes authority before any next use', async () => {
    const { service } = fixture(); const grant = await service.issue();
    assert.equal(service.dispose(grant), true); assert.equal(service.dispose(grant), false);
    await assert.rejects(service.recheck(grant), denied('grant_unavailable'));
});
test('keeps opaque identity closed after hostile post-import WeakMap and Map mutation', async () => {
    const { service } = fixture(); const forged = Object.freeze(Object.create(null));
    const weak = { get: WeakMap.prototype.get, set: WeakMap.prototype.set, delete: WeakMap.prototype.delete };
    const map = { get: Map.prototype.get, set: Map.prototype.set, delete: Map.prototype.delete };
    let captured: unknown;
    try {
        WeakMap.prototype.set = function(this: WeakMap<object, unknown>, key: object, value: unknown) { if (value && typeof value === 'object' && 'grant' in value && 'snapshot' in value) captured = value; return Reflect.apply(weak.set, this, [key, value]); } as typeof WeakMap.prototype.set;
        WeakMap.prototype.get = function(this: WeakMap<object, unknown>, key: object) { return key === forged && captured ? captured : Reflect.apply(weak.get, this, [key]); } as typeof WeakMap.prototype.get;
        WeakMap.prototype.delete = function(this: WeakMap<object, unknown>, key: object) { return Reflect.apply(weak.delete, this, [key]); } as typeof WeakMap.prototype.delete;
        Map.prototype.set = function(this: Map<unknown, unknown>, key: unknown, value: unknown) { if (value && typeof value === 'object' && 'grant' in value && 'snapshot' in value) captured = value; return Reflect.apply(map.set, this, [key, value]); } as typeof Map.prototype.set;
        Map.prototype.get = function(this: Map<unknown, unknown>, key: unknown) { return key === 'forged-session' && captured ? captured : Reflect.apply(map.get, this, [key]); } as typeof Map.prototype.get;
        Map.prototype.delete = function(this: Map<unknown, unknown>, key: unknown) { return Reflect.apply(map.delete, this, [key]); } as typeof Map.prototype.delete;
        const grant = await service.issue();
        await assert.rejects(service.recheck(forged), denied('grant_unavailable'));
        assert.equal(await service.recheck(grant), grant);
    } finally {
        WeakMap.prototype.get = weak.get; WeakMap.prototype.set = weak.set; WeakMap.prototype.delete = weak.delete;
        Map.prototype.get = map.get; Map.prototype.set = map.set; Map.prototype.delete = map.delete;
    }
});
test('keeps all seven session bindings under hostile post-import Array iterator mutation', async () => {
    const current = fixture(); const grant = await current.service.issue();
    const replacement = issueSyntheticWebSession({ id: ACTOR, username: 'synthetic-soap-admin', role: 'admin' }, `soap-grant-${sequence += 1}`);
    sessions.push(replacement); current.state.session = replacement; current.state.now = Math.max(current.state.now, replacement.createdAt);
    const original = Array.prototype[Symbol.iterator]; let accepted = false; let failure: unknown;
    try {
        Array.prototype[Symbol.iterator] = (function* () {}) as unknown as typeof original;
        try { accepted = await current.service.recheck(grant) === grant; } catch (error) { failure = error; }
    } finally { Array.prototype[Symbol.iterator] = original; }
    assert.equal(accepted, false); assert.equal(denied('projection_stale')(failure), true);
});
test('does not invoke hostile post-import Math.min between attestation validation and publication', async () => {
    const current = fixture(); const grant = await current.service.issue(); const original = Math.min; let calls = 0;
    try {
        Math.min = ((...values: number[]) => { calls += 1; if (calls === 2) current.state.attestation = activeAttestation(current.state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(current.state.now) }); return Reflect.apply(original, Math, values); }) as typeof Math.min;
        assert.equal(await current.service.recheck(grant), grant);
    } finally { Math.min = original; }
    assert.equal(calls, 0);
    current.state.attestation = activeAttestation(current.state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(current.state.now) });
    await assert.rejects(current.service.recheck(grant), denied('attestation_revoked'));
});
test('does not invoke hostile post-import String.trim while binding the current session', async () => {
    const current = fixture(); const grant = await current.service.issue();
    const replacement = issueSyntheticWebSession({ id: ACTOR, username: 'synthetic-soap-admin', role: 'admin' }, `soap-grant-${sequence += 1}`);
    sessions.push(replacement);
    const original = String.prototype.trim; let calls = 0;
    try {
        String.prototype.trim = function(this: string) { calls += 1; if (calls === 4) current.state.session = replacement; return Reflect.apply(original, this, []); } as typeof String.prototype.trim;
        assert.equal(await current.service.recheck(grant), grant);
    } finally { String.prototype.trim = original; }
    assert.equal(calls, 0);
    current.state.session = replacement; current.state.now = Math.max(current.state.now, replacement.createdAt);
    await assert.rejects(current.service.recheck(grant), denied('projection_stale'));
});
test('does not assimilate validated snapshots through hostile Object.prototype.then', async () => {
    const current = fixture(); const grant = await current.service.issue();
    current.state.session = Object.freeze(Object.assign(Object.create(null), current.session)) as ServerSession;
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); let reads = 0;
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; if (reads === 2) current.state.attestation = activeAttestation(current.state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(current.state.now) }); return undefined; } });
        assert.equal(await current.service.recheck(grant), grant);
    } finally { if (previous) Object.defineProperty(Object.prototype, 'then', previous); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
    current.state.attestation = activeAttestation(current.state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(current.state.now) });
    await assert.rejects(current.service.recheck(grant), denied('attestation_revoked'));
});
test('does not invoke hostile post-import RegExp.exec while validating session and attestation references', async () => {
    const current = fixture(); const grant = await current.service.issue(); const original = RegExp.prototype.exec; let issuerCalls = 0;
    try {
        RegExp.prototype.exec = function(this: RegExp, value: string) { if (value.length === 38) { issuerCalls += 1; if (issuerCalls === 2) current.state.attestation = activeAttestation(current.state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(current.state.now) }); } return Reflect.apply(original, this, [value]); } as typeof RegExp.prototype.exec;
        assert.equal(await current.service.recheck(grant), grant);
    } finally { RegExp.prototype.exec = original; }
    assert.equal(issuerCalls, 0);
    current.state.attestation = activeAttestation(current.state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(current.state.now) });
    await assert.rejects(current.service.recheck(grant), denied('attestation_revoked'));
});
test('denies revocation completed before the final synchronous snapshot', async () => {
    const revokeAt = (target: number) => fixture((state, readNumber) => { if (readNumber === target) queueMicrotask(() => { state.attestation = activeAttestation(state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(state.now) }); }); });
    const issuing = revokeAt(2);
    await assert.rejects(issuing.service.issue(), denied('attestation_revoked'));
    const checking = revokeAt(4); const grant = await checking.service.issue();
    await assert.rejects(checking.service.recheck(grant), denied('attestation_revoked'));
    await assert.rejects(checking.service.recheck(grant), denied('grant_unavailable'));
});
test('linearizes final session selection before grant publication and recheck', async () => {
    for (const target of [2, 4]) {
        const replacement = issueSyntheticWebSession({ id: ACTOR, username: 'synthetic-soap-admin', role: 'admin' }, `soap-grant-${sequence += 1}`); sessions.push(replacement); let observedSessionId = '';
        const current = fixture((state, readNumber) => { if (readNumber === target) queueMicrotask(() => queueMicrotask(() => { state.session = replacement; })); }, state => { observedSessionId = state.session?.id ?? ''; });
        const grant = await current.service.issue(); observedSessionId = target === 4 ? '' : observedSessionId;
        if (target === 4) assert.equal(await current.service.recheck(grant), grant);
        assert.equal(observedSessionId, current.session.id); assert.equal(current.state.session, replacement);
        await assert.rejects(current.service.recheck(grant), denied('projection_stale'));
    }
});
test('imports no review, Fabric, route, persistence, patient, proposal, proof, or writer authority', () => {
    const source = fs.readFileSync(new URL('./headless-soap-active-role-session-grant.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*(?:physician-review|authenticated-review|fresh-review|active-review|fabric|route|db-server|schema|patient|proposal|proof|writer)/iu);
    assert.doesNotMatch(source, /\b(?:patientRef|ambulatoryRef|proposalRef|authorizationProof|commandId|idempotencyKey|fieldSet|payload)\b/u);
});
