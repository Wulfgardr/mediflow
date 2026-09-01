/* @Codex */
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import test, { afterEach } from 'node:test';

const sourceOwnerUrl = new URL('../../packages/web-auth-lifecycle-owner/index.js', import.meta.url).href;
const registerHooks = (nodeModule as unknown as { registerHooks(hooks: {
    resolve(
        specifier: string,
        context: unknown,
        nextResolve: (candidate: string, nextContext: unknown) => unknown,
    ): unknown;
}): void }).registerHooks;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '@mediflow/web-auth-lifecycle-owner') {
            return { shortCircuit: true, url: sourceOwnerUrl };
        }
        return nextResolve(specifier, context);
    },
});

const sourceOwner = (await import(sourceOwnerUrl)) as Record<string, (...args: unknown[]) => unknown>;
const grantModule = await import('./headless-soap-active-role-session-grant.ts');
const fixtureModule = await import('./web-auth-lifecycle-owner-test-fixture.ts');
const lineageModule = await import('./headless-soap-authorization-lineage.ts');

const ACTOR = 'synthetic-h6-active-role';
const sessions: Array<ReturnType<typeof fixtureModule.issueSyntheticWebSession>> = [];
let sequence = 0;

function activeAttestation(now: number): unknown {
    return Object.freeze(Object.assign(Object.create(null), {
        attestationRef: `hsar_${'a'.repeat(32)}`,
        actorRef: ACTOR,
        schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1',
        role: 'physician',
        operationId: 'mediflow.clinical_diary.append_soap.v1',
        policyVersion: 'clinician_confirmed_single_use.v1',
        status: 'active',
        attestationVersion: 1,
        issuerRef: `hsari_${'b'.repeat(32)}`,
        expiresAt: new Date(now + 8 * 60 * 60 * 1_000),
        activatedAt: new Date(now),
        revocationGeneration: 0,
        revokedAt: null,
        createdAt: new Date(now - 1_000),
        updatedAt: new Date(now),
    }));
}

function fixture() {
    const session = fixtureModule.issueSyntheticWebSession({
        id: ACTOR,
        username: 'synthetic-h6-admin',
        role: 'admin',
    }, `h6-active-role-${sequence += 1}`);
    sessions.push(session);
    const now = Math.max(Date.now(), session.createdAt);
    const owner = grantModule.createHeadlessSoapActiveRoleSessionGrantOwner({
        readCurrentSession: async () => session,
        readAttestation: () => activeAttestation(now),
        clock: () => now,
    });
    return { owner, session };
}

afterEach(() => {
    while (sessions.length > 0) fixtureModule.retireSyntheticWebSession(sessions.pop()!);
});

function assertActiveRole(activeRole: Record<string, unknown>, grant: object): void {
    assert.equal(Object.getPrototypeOf(activeRole), null);
    assert.equal(Object.isFrozen(activeRole), true);
    assert.deepEqual(Reflect.ownKeys(activeRole), [
        'grantIdentity', 'principalRef', 'authenticationGeneration', 'actorRef',
        'attestationRef', 'attestationVersion', 'revocationGeneration', 'policyVersion',
    ]);
    assert.equal(activeRole.grantIdentity, grant);
    assert.equal(activeRole.principalRef, ACTOR);
    assert.equal(activeRole.actorRef, ACTOR);
    assert.equal(activeRole.attestationRef, `hsar_${'a'.repeat(32)}`);
    assert.equal(activeRole.attestationVersion, 1);
    assert.equal(activeRole.revocationGeneration, 0);
    assert.equal(activeRole.policyVersion, 'clinician_confirmed_single_use.v1');
    const generation = activeRole.authenticationGeneration as object;
    assert.equal(Object.getPrototypeOf(generation), null);
    assert.equal(Object.isFrozen(generation), true);
    assert.deepEqual(Reflect.ownKeys(generation), []);
}

test('adds only a distinct private binding controller and emits the frozen H6 activeRole shape', async () => {
    const { owner } = fixture();
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['dispose', 'issue', 'recheck']);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), [
        'confirmDependent', 'registerDependent', 'unregisterDependent',
        'withCurrentDependent', 'withCurrentGrant',
    ]);
    assert.deepEqual(Reflect.ownKeys(owner.bindingController).sort(), [
        'withCurrentDependentBinding', 'withCurrentGrantBinding',
    ]);

    const grants: object[] = [];
    const activeRoles: Array<Record<string, unknown>> = [];
    assert.equal(await owner.bindingController.withCurrentGrantBinding((grant, activeRole) => {
        grants.push(grant);
        activeRoles.push(activeRole as Record<string, unknown>);
    }), true);
    const firstGrant = grants[0];
    const firstActiveRole = activeRoles[0];
    assert.ok(firstGrant); assert.ok(firstActiveRole);
    assertActiveRole(firstActiveRole, firstGrant);

    let duplicateGeneration: unknown;
    assert.equal(await owner.bindingController.withCurrentGrantBinding((grant, activeRole) => {
        assert.equal(grant, firstGrant);
        duplicateGeneration = activeRole.authenticationGeneration;
    }), true);
    assert.equal(duplicateGeneration, firstActiveRole.authenticationGeneration);
});

test('requires the exact H2b registration when rechecking an activeRole binding', async () => {
    const { owner } = fixture();
    const grant = await owner.service.issue();
    const registration = owner.lifecycleController.registerDependent(grant, () => undefined);
    assert.ok(registration);
    const observed: Array<Record<string, unknown>> = [];
    assert.equal(await owner.bindingController.withCurrentDependentBinding(grant, registration, (activeRole) => {
        observed.push(activeRole as Record<string, unknown>);
    }), true);
    assert.ok(observed[0]); assertActiveRole(observed[0], grant);

    let calls = 0;
    assert.equal(await owner.bindingController.withCurrentDependentBinding(
        grant,
        structuredClone(registration),
        () => { calls += 1; },
    ), false);
    assert.equal(calls, 0);
    assert.equal(owner.lifecycleController.confirmDependent(grant, registration), true);
});

test('applies the Web resource final fence after the binding callback and terminalizes on reentry', async () => {
    const { owner, session } = fixture();
    let calls = 0; let originalGrant: object | null = null;
    assert.equal(await owner.bindingController.withCurrentGrantBinding((grant, activeRole) => {
        originalGrant = grant;
        calls += 1;
        assert.equal(activeRole.principalRef, ACTOR);
        const retirement = sourceOwner.retire(session, 'dispose');
        assert.deepEqual(retirement, Object.freeze(Object.assign(Object.create(null), { outcome: 'denied' })));
    }), false);
    assert.equal(calls, 1);
    assert.ok(originalGrant);
    assert.equal(owner.service.dispose(originalGrant), false);
    await assert.rejects(owner.service.recheck(originalGrant), (error: unknown) =>
        (error as { code?: unknown }).code === 'grant_unavailable');
});

test('rejects asynchronous binding callbacks without publishing a reusable grant', async () => {
    const { owner } = fixture();
    let calls = 0;
    assert.equal(await owner.bindingController.withCurrentGrantBinding(async () => { calls += 1; }), false);
    assert.equal(calls, 0);
});

test('keeps activeRole assignable to the frozen H6 lineage contract', () => {
    type ActiveRole = import('./headless-soap-authorization-lineage.ts').HeadlessSoapAuthorizationLineageV1['activeRole'];
    const accepts = (value: ActiveRole): ActiveRole => value;
    assert.equal(typeof accepts, 'function');
    assert.equal(lineageModule.HEADLESS_SOAP_AUTHORIZATION_LINEAGE_SCHEMA,
        'mediflow.headless.soap-authorization-lineage.v1');
});
