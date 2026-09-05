/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';
import { createHeadlessSoapActiveRoleSessionGrantOwner, createHeadlessSoapActiveRoleSessionGrantService, HeadlessSoapActiveRoleSessionGrantError } from './headless-soap-active-role-session-grant.ts';
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
    const sources = { readCurrentSession: async () => { onSessionRead?.(state, sessionReads += 1); return state.session; }, readAttestation: () => { onAttestationRead?.(state); return state.attestation; }, clock: () => state.now };
    const service = createHeadlessSoapActiveRoleSessionGrantService(sources);
    return { service, session, sources, state };
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
test('private owner controller atomically attaches, fences, unregisters, and drains dependents', async () => {
    const current = fixture(); const owner = createHeadlessSoapActiveRoleSessionGrantOwner(current.sources); const grant = await owner.service.issue();
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['dispose', 'issue', 'recheck']);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), ['confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent', 'withCurrentGrant']);
    let calls = 0;
    const first = owner.lifecycleController.registerDependent(grant, () => { calls += 1; assert.equal(owner.lifecycleController.confirmDependent(grant, first), false); assert.equal(owner.lifecycleController.registerDependent(grant, () => undefined), null); });
    const throwing = owner.lifecycleController.registerDependent(grant, () => { calls += 1; throw new Error('synthetic dependent failure'); });
    const removed = owner.lifecycleController.registerDependent(grant, () => { calls += 100; });
    assert.ok(first); assert.ok(throwing); assert.ok(removed); assert.equal(owner.lifecycleController.confirmDependent(grant, first), true);
    assert.equal(Object.getPrototypeOf(first), null); assert.equal(Object.isFrozen(first), true); assert.deepEqual(Reflect.ownKeys(first), []);
    assert.equal(owner.lifecycleController.confirmDependent(grant, structuredClone(first)), false);
    assert.equal(owner.lifecycleController.unregisterDependent(grant, removed), true); assert.equal(owner.lifecycleController.unregisterDependent(grant, removed), false);
    assert.equal(owner.lifecycleController.registerDependent(grant, async () => undefined), null);
    assert.equal(owner.lifecycleController.registerDependent(grant, new Proxy(() => undefined, {})), null);
    assert.equal(owner.service.dispose(grant), true); assert.equal(calls, 2);
    assert.equal(owner.lifecycleController.confirmDependent(grant, first), false); assert.equal(owner.lifecycleController.confirmDependent(grant, throwing), false);
});
test('private owner rejects an async disposer whose public prototype is spoofed', async () => {
    const current = fixture(); const owner = createHeadlessSoapActiveRoleSessionGrantOwner(current.sources); const grant = await owner.service.issue(); let completed = false;
    const disposer = async () => { await Promise.resolve(); completed = true; };
    Object.setPrototypeOf(disposer, Function.prototype);
    assert.equal(owner.lifecycleController.registerDependent(grant, disposer), null);
    assert.equal(owner.service.dispose(grant), true); assert.equal(completed, false);
    await Promise.resolve(); assert.equal(completed, false);
});
test('private owner rolls back and terminalizes an apply-then-throw dependent attach', () => {
    const result = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'lib/security/headless-soap-active-role-session-grant-attach-failure-fixture.ts'], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
test('private continuations linearize attach and use before queued revocation', async () => {
    const attaching = fixture((state, readNumber) => { if (readNumber === 2) queueMicrotask(() => queueMicrotask(() => { state.attestation = activeAttestation(state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(state.now) }); })); });
    const attachOwner = createHeadlessSoapActiveRoleSessionGrantOwner(attaching.sources); let attachedGrant: unknown, attachedRegistration: unknown, attachDisposals = 0, attachStatus = '';
    assert.equal(await attachOwner.lifecycleController.withCurrentGrant((grant) => {
        const registration = attachOwner.lifecycleController.registerDependent(grant, () => { attachDisposals += 1; }); assert.ok(registration);
        attachedGrant = grant; attachedRegistration = registration; attachStatus = (attaching.state.attestation as { status: string }).status;
    }), true);
    assert.equal(attachStatus, 'active'); assert.equal((attaching.state.attestation as { status: string }).status, 'revoked');
    assert.equal(attachOwner.lifecycleController.confirmDependent(attachedGrant, attachedRegistration), true);
    await assert.rejects(attachOwner.service.recheck(attachedGrant), denied('attestation_revoked')); assert.equal(attachDisposals, 1);

    const checking = fixture((state, readNumber) => { if (readNumber === 4) queueMicrotask(() => queueMicrotask(() => { state.attestation = activeAttestation(state.now, { status: 'revoked', revocationGeneration: 1, revokedAt: new Date(state.now) }); })); });
    const checkOwner = createHeadlessSoapActiveRoleSessionGrantOwner(checking.sources); const grant = await checkOwner.service.issue(); let useStatus = '', useDisposals = 0;
    const registration = checkOwner.lifecycleController.registerDependent(grant, () => { useDisposals += 1; }); assert.ok(registration);
    assert.equal(await checkOwner.lifecycleController.withCurrentDependent(grant, registration, () => { useStatus = (checking.state.attestation as { status: string }).status; }), true);
    assert.equal(useStatus, 'active'); assert.equal((checking.state.attestation as { status: string }).status, 'revoked');
    await assert.rejects(checkOwner.service.recheck(grant), denied('attestation_revoked')); assert.equal(useDisposals, 1);
});
test('private continuations fail closed on reentry and asynchronous results', async () => {
    const reentrant = fixture(); const reentrantOwner = createHeadlessSoapActiveRoleSessionGrantOwner(reentrant.sources); let reentrantDisposals = 0;
    assert.equal(await reentrantOwner.lifecycleController.withCurrentGrant(grant => {
        assert.ok(reentrantOwner.lifecycleController.registerDependent(grant, () => { reentrantDisposals += 1; })); reentrantOwner.service.dispose(grant);
    }), false);
    assert.equal(reentrantDisposals, 1);
    const asynchronous = fixture(); const asyncOwner = createHeadlessSoapActiveRoleSessionGrantOwner(asynchronous.sources); const grant = await asyncOwner.service.issue(); let asyncDisposals = 0;
    const registration = asyncOwner.lifecycleController.registerDependent(grant, () => { asyncDisposals += 1; }); assert.ok(registration);
    assert.equal(await asyncOwner.lifecycleController.withCurrentDependent(grant, registration, () => Promise.resolve()), false);
    assert.equal(asyncDisposals, 1); assert.equal(asyncOwner.service.dispose(grant), false);
});
test('private continuations poison nested asynchronous grant work', async () => {
    const current = fixture(); const owner = createHeadlessSoapActiveRoleSessionGrantOwner(current.sources); let nested: Promise<unknown> | null = null, attachedGrant: unknown, publications = 0, disposals = 0;
    assert.equal(await owner.lifecycleController.withCurrentGrant(grant => {
        attachedGrant = grant; assert.ok(owner.lifecycleController.registerDependent(grant, () => { disposals += 1; })); publications += 1;
        nested = owner.lifecycleController.withCurrentGrant(() => { publications += 1; }).then(value => value, error => error);
    }), false);
    assert.ok(nested); assert.equal(denied('lifecycle_unavailable')(await nested), true); assert.equal(publications, 1); assert.equal(disposals, 1); assert.equal(owner.service.dispose(attachedGrant), false);
});
test('private continuations observe rejected native Promise results', () => {
    const result = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'lib/security/headless-soap-active-role-session-grant-rejection-fixture.ts'], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
test('private dependent drain follows Web owner retirement before the next use', async () => {
    const current = fixture(); const owner = createHeadlessSoapActiveRoleSessionGrantOwner(current.sources); const grant = await owner.service.issue(); let calls = 0;
    const registration = owner.lifecycleController.registerDependent(grant, () => { calls += 1; }); assert.ok(registration);
    retireSyntheticWebSession(current.session); assert.equal(calls, 1); assert.equal(owner.lifecycleController.confirmDependent(grant, registration), false);
    await assert.rejects(owner.service.recheck(grant), denied('grant_unavailable'));
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
