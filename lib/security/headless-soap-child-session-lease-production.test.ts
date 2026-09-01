/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-child-session-lease-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const production = await import('./headless-soap-child-session-lease-production.ts');

test('keeps one process owner internal while the public facade shares only its service', async () => {
    const internal = await import('./headless-soap-child-session-lease-production-internal.ts');
    const repeated = await import('./headless-soap-child-session-lease-production-internal.ts');
    const loaderInteropExports = new Set(['__esModule', 'default', ['module', 'exports'].join('.')]);
    const runtimeExports = Object.keys(internal).filter((key) => !loaderInteropExports.has(key));
    assert.deepEqual(runtimeExports, ['headlessSoapChildSessionLeaseProductionOwner']);
    assert.equal(internal.headlessSoapChildSessionLeaseProductionOwner, repeated.headlessSoapChildSessionLeaseProductionOwner);

    const owner = internal.headlessSoapChildSessionLeaseProductionOwner;
    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['bindingController', 'lifecycleController', 'service']);
    assert.equal(production.headlessSoapChildSessionLeaseService, owner.service);
    assert.equal(Object.isFrozen(owner.lifecycleController), true);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), [
        'confirmDependent',
        'registerDependent',
        'unregisterDependent',
        'withCurrentDependent',
        'withCurrentLease',
        'withCurrentProposalBudget',
    ]);
    assert.equal(Object.isFrozen(owner.bindingController), true);
    assert.deepEqual(Reflect.ownKeys(owner.bindingController), ['withCurrentDependentBinding']);
});

test('exposes one frozen child-session singleton and denies open without a current clinician session', async () => {
    const service = production.headlessSoapChildSessionLeaseService;
    assert.equal(service, (await import('./headless-soap-child-session-lease-production.ts')).headlessSoapChildSessionLeaseService);
    assert.equal(Object.isFrozen(service), true);
    assert.deepEqual(Reflect.ownKeys(service).sort(), ['consumeProposalBudget', 'open', 'recheck', 'terminate']);
    assert.equal(service.open.length, 0);
    assert.equal(service.recheck.length, 1);
    assert.equal(service.consumeProposalBudget.length, 1);
    assert.equal(service.terminate.length, 1);

    await assert.rejects(service.open(), (error: unknown) => {
        const candidate = error as { code?: unknown; message?: unknown };
        return candidate.code === 'active_role_unavailable'
            && !/sqlite|database|cookie|patient|actor|session id/iu.test(String(candidate.message));
    });
});

test('denies foreign identities through both the public service and private lifecycle port', async () => {
    const internal = await import('./headless-soap-child-session-lease-production-internal.ts');
    const service = production.headlessSoapChildSessionLeaseService;
    const lifecycle = internal.headlessSoapChildSessionLeaseProductionOwner.lifecycleController;
    const foreignLease = Object.freeze(Object.create(null));
    const foreignRegistration = Object.freeze(Object.create(null));
    const hasCode = (code: string) => (error: unknown) => (error as { code?: unknown }).code === code;

    await assert.rejects(service.recheck(foreignLease), hasCode('lease_unavailable'));
    await assert.rejects(service.consumeProposalBudget(foreignLease), hasCode('lease_unavailable'));
    assert.equal(service.terminate(foreignLease), false);
    assert.equal(lifecycle.registerDependent(foreignLease, () => undefined), null);
    assert.equal(lifecycle.confirmDependent(foreignLease, foreignRegistration), false);
    assert.equal(lifecycle.unregisterDependent(foreignLease, foreignRegistration), false);
    assert.equal(await lifecycle.withCurrentLease(foreignLease, () => undefined), false);
    assert.equal(await lifecycle.withCurrentDependent(foreignLease, foreignRegistration, () => undefined), false);
    assert.equal(await lifecycle.withCurrentProposalBudget(foreignLease, foreignRegistration, () => undefined), false);
    assert.equal(await internal.headlessSoapChildSessionLeaseProductionOwner.bindingController
        .withCurrentDependentBinding(foreignLease, foreignRegistration, () => undefined), false);
});

test('composes one private H2b owner without exposing lifecycle authority from either facade', () => {
    const childSource = fs.readFileSync(new URL('./headless-soap-child-session-lease-production.ts', import.meta.url), 'utf8');
    const childOwnerSource = fs.readFileSync(new URL('./headless-soap-child-session-lease-production-internal.ts', import.meta.url), 'utf8');
    const grantSource = fs.readFileSync(new URL('./headless-soap-active-role-session-grant-production.ts', import.meta.url), 'utf8');
    const grantOwnerSource = fs.readFileSync(new URL('./headless-soap-active-role-session-grant-production-internal.ts', import.meta.url), 'utf8');
    const importsOf = (source: string) => [...source.matchAll(/^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu)]
        .map((match) => match[1] ?? match[2]).sort();

    assert.deepEqual(importsOf(childSource), [
        'server-only',
        './headless-soap-child-session-lease-production-internal',
    ].sort());
    assert.deepEqual(importsOf(childOwnerSource), [
        'server-only',
        './headless-soap-active-role-session-grant-production-internal',
        './headless-soap-child-session-lease',
    ].sort());
    assert.deepEqual(importsOf(grantSource), [
        'server-only',
        './headless-soap-active-role-session-grant-production-internal',
    ].sort());
    assert.deepEqual(importsOf(grantOwnerSource), [
        'server-only',
        './headless-soap-active-role-attestation-store',
        './headless-soap-active-role-session-grant',
        './server-auth',
    ].sort());

    assert.equal(grantOwnerSource.match(/\bcreateHeadlessSoapActiveRoleAttestationStore\(\)/gu)?.length, 1);
    assert.equal(grantOwnerSource.match(/\bcreateHeadlessSoapActiveRoleSessionGrantOwner\s*\(/gu)?.length, 1);
    assert.match(grantOwnerSource, /readCurrentSession:\s*readAuthenticatedWebSession/u);
    assert.equal(childOwnerSource.match(/\bcreateHeadlessSoapChildSessionLeaseOwner\s*\(/gu)?.length, 1);
    assert.match(childSource, /headlessSoapChildSessionLeaseProductionOwner\.service/u);
    for (const method of ['withCurrentGrant', 'registerDependent', 'confirmDependent', 'unregisterDependent', 'withCurrentDependent']) {
        assert.match(childOwnerSource, new RegExp(`\\b${method}: activeRoleLifecycle\\.${method}\\b`, 'u'));
    }
    for (const source of [childSource, grantSource]) {
        assert.equal(source.match(/^export\s+(?:const|function|class)\s/gmu)?.length, 1);
        assert.doesNotMatch(source, /^export\s+(?:const|function|class)\s+\w*(?:Owner|Controller)\b/gmu);
        assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
    }
    assert.equal(childOwnerSource.match(/^export\s+(?:const|function|class)\s/gmu)?.length, 1);
    assert.match(childOwnerSource, /^export\s+const\s+headlessSoapChildSessionLeaseProductionOwner\b/mu);
    assert.doesNotMatch(childOwnerSource, /^export\s+(?:const|function|class)\s+\w*(?:Service|Controller)\b/gmu);
    assert.doesNotMatch(childSource, /lifecycleController|withCurrentGrant|registerDependent|confirmDependent|unregisterDependent|withCurrentDependent|withCurrentProposalBudget/u);
    for (const source of [childSource, childOwnerSource]) {
        assert.doesNotMatch(source, /patient|selection|digest|approval|proof|entry|writer|fabric|db-server|route/iu);
        assert.doesNotMatch(source, /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
