/* Real filesystem reservation and auth owners; no issuer, runtime or provider. */
import assert from 'node:assert/strict';
import { after, test, type TestContext } from 'node:test';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebSessionProjection } from '../security/web-auth-lifecycle-owner-adapter';
import type { ProductResponse } from './product-contract';
import type { MacQualificationAudit } from '../chatgpt-execution/execution-mac-qualification';

const originalDataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(originalDataDir, 'Run-owned synthetic data directory required');
mkdirSync(originalDataDir, { recursive: true });
const dataDir = mkdtempSync(join(originalDataDir, 'retained-preparation-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
after(() => { process.env.MEDIFLOW_DATA_DIR = originalDataDir; });
const { createMacProductPlatformManager, hasUnconfirmedMacProductPreparation } = await import('../chatgpt-execution/execution-mac-product.ts');
const { MacQualificationFailure } = await import('../chatgpt-execution/execution-mac-qualification.ts');
const { ExecutionError } = await import('../chatgpt-execution/execution-contract.ts');
const { ordinaryFunctionCommand, beginOrdinaryFunction } = await import('./ordinary-flow.ts');
const { createChatGptProduct } = await import('./product-production.ts');
const { createProductBrowser } = await import('./product-browser.ts');
const { createOrdinaryBrowser } = await import('../function-models/ordinary-browser.ts');
const { PRODUCT_NAMESPACE, PRODUCT_OPERATION, PRODUCT_DATA_CLASS } = await import('./product-contract.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('../security/web-auth-lifecycle-owner-test-fixture.ts');
const { resolve } = await import('../security/web-auth-lifecycle-owner-adapter.ts');
const directory = join(dataDir, 'chatgpt-execution');
const hold = join(directory, 'mac-preparation.hold');
const blocked = { state: 'blocked', expiresAt: null };
const assets = () => ({ binaryPath: '/synthetic/never-started', nativeSourcePath: '/synthetic/owner.c', schemaDirectory: '/synthetic/schema', c1ReceiptPath: '/synthetic/c1' });
const cleanAudit: MacQualificationAudit = {
    schema: 'mediflow.mac-custody-audit.v1', run: 'synthetic', phase: 'revoked', stage: 'readback',
    claim: 'candidate_boundary_only_not_live_or_clinical', revision: null, baseContextSha256: '', sourceAvailable: true,
    fullSourceBuildBinding: 'unqualified', consumedProjectionBinding: 'not_observed', omittedToolBinding: 'not_observed',
    protocolRegeneration: 'not_observed', initializeSha256: null, readbackSha256: null, nativeHelperSha256: null,
    compilerSha256: null, binarySha256: '', osBuild: 'synthetic', cleanupComplete: true, ownedTreeCeased: true,
    administrativePolicy: 'absent_only_no_overrides', resourcesRetained: false,
};
function emptyHold() {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(hold, '', { flag: 'wx', mode: 0o600 });
}
function identity(path = hold) {
    const s = lstatSync(path);
    return { dev: s.dev, ino: s.ino, size: s.size, contents: readFileSync(path).toString('hex') };
}
let sequence = 0;
function session(t: TestContext) {
    const name = `retained-${++sequence}`;
    const context = issueSyntheticWebSessionContext({ id: name, username: 'synthetic', role: 'doctor' }, name);
    t.after(() => retireSyntheticWebSession(context.session));
    return context;
}
const web = (value: ReturnType<typeof session>['session']) => value as WebSessionProjection;
function manager(reservationDirectory = directory) {
    let starts = 0, resolutions = 0;
    const instance = createMacProductPlatformManager({ reservationDirectory: () => reservationDirectory,
        assets() { resolutions++; return assets(); }, async prepare() { starts++; throw new Error('No issuer permitted'); } });
    return { instance, counts: () => ({ starts, resolutions }) };
}

test('fresh manager observes an empty retained hold without claiming cleanup or touching it', async t => {
    emptyHold(); t.after(() => rmSync(directory, { recursive: true }));
    const before = identity(), f = manager(), p = f.instance.createPlatform();
    assert.deepEqual(p.preparation!(), blocked);
    await p.close!(); assert.deepEqual(p.preparation!(), blocked);
    await assert.rejects(p.prepare!(new AbortController().signal, 300000), e => e instanceof ExecutionError && e.code === 'busy');
    assert.deepEqual(f.counts(), { starts: 0, resolutions: 0 });
    assert.deepEqual(identity(), before);
});
for (const kind of ['non-directory', 'symlink-directory', 'dangling-hold'] as const) test(`indeterminate reservation (${kind}) stays blocked without resolving assets`, async t => {
    const root = mkdtempSync(join(dataDir, 'indeterminate-'));
    t.after(() => rmSync(root, { recursive: true }));
    const path = join(root, 'reservation');
    if (kind === 'non-directory') writeFileSync(path, 'synthetic');
    else if (kind === 'symlink-directory') symlinkSync(join(root, 'absent'), path);
    else { mkdirSync(path, { mode: 0o700 }); symlinkSync(join(root, 'absent'), join(path, 'mac-preparation.hold')); }
    const f = manager(path), p = f.instance.createPlatform();
    assert.deepEqual(p.preparation!(), blocked);
    await p.close!();
    await assert.rejects(p.prepare!(new AbortController().signal, 300000));
    assert.deepEqual(f.counts(), { starts: 0, resolutions: 0 });
});
test('observation failure, including ENOENT from directory resolution, is not proof of absence', async () => {
    for (const code of ['EACCES', 'ENOENT']) {
        const directory = () => { throw Object.assign(new Error('PRIVATE_OBSERVATION'), { code }); };
        assert.equal(hasUnconfirmedMacProductPreparation(directory), true);
        const p = createMacProductPlatformManager({ reservationDirectory: directory, assets,
            async prepare() { throw new Error('No issuer permitted'); } }).createPlatform();
        assert.deepEqual(p.preparation!(), blocked);
        await assert.rejects(p.prepare!(new AbortController().signal, 300000));
    }
});
test('no reservation is passive; the live owner remains preparing/closing and only its confirmed cleanup closes it', async t => {
    const path = join(dataDir, 'live-owner');
    let release!: () => void, starts = 0;
    const pending = new Promise<void>(done => { release = done; });
    const m = createMacProductPlatformManager({ assets, reservationDirectory: () => path,
        async prepare() { starts++; await pending; throw new MacQualificationFailure('readback', cleanAudit, null); } });
    const live = m.createPlatform();
    assert.deepEqual(live.preparation!(), { state: 'not_prepared', expiresAt: null });
    assert.throws(() => lstatSync(path), { code: 'ENOENT' });
    const work = live.prepare!(new AbortController().signal, 300000); void work.catch(() => {});
    t.after(async () => { release(); await work.catch(() => {}); });
    assert.equal(live.preparation!().state, 'preparing');
    assert.deepEqual(m.createPlatform().preparation!(), blocked);
    assert.deepEqual(manager(path).instance.createPlatform().preparation!(), blocked);
    const closing = live.close!(); assert.equal(live.preparation!().state, 'closing');
    release(); await assert.rejects(work, MacQualificationFailure); await closing;
    assert.equal(starts, 1); assert.equal(live.preparation!().state, 'closed');
    assert.throws(() => lstatSync(join(path, 'mac-preparation.hold')), { code: 'ENOENT' });
    assert.deepEqual(manager(path).instance.createPlatform().preparation!(), { state: 'not_prepared', expiresAt: null });
});
test('ordinary empty registry reports recovery for two genuine owners; copies and retired owners cannot observe or rearm', async t => {
    const a = session(t), b = session(t), signal = new AbortController().signal;
    const clean = { schema: 'mediflow.chatgpt-ordinary-flow.v1', phase: 'closed', attemptId: null, cleanupConfirmed: true };
    assert.deepEqual(await (await ordinaryFunctionCommand(web(a.session), 'status', {}, signal)).json(), clean);
    emptyHold(); t.after(() => rmSync(directory, { recursive: true })); const before = identity();
    const expected = { ...clean, phase: 'recovery_required', cleanupConfirmed: false };
    for (const context of [a, b]) {
        const fresh = resolve(context.session.id, context.controlId); assert.equal(fresh.status, 'active');
        if (fresh.status !== 'active') throw new Error('Synthetic owner missing');
        assert.deepEqual(await (await ordinaryFunctionCommand(fresh.projection, 'status', {}, signal)).json(), expected);
        let calls = 0;
        await assert.rejects(beginOrdinaryFunction(new Request('http://localhost/api/ai/patient-insight/preview', { method: 'POST', body: '{}' }), 'patient_insight', fresh.projection,
            async () => { calls++; return Response.json({}); }), e => e instanceof ExecutionError && e.code === 'busy');
        assert.equal(calls, 0);
        await assert.rejects(ordinaryFunctionCommand({ ...fresh.projection }, 'status', {}, signal));
    }
    retireSyntheticWebSession(a.session);
    await assert.rejects(ordinaryFunctionCommand(web(a.session), 'status', {}, signal));
    assert.deepEqual(identity(), before);
});
test('ordinary reprepare remains disarmed by the real retained-hold status without reading settings', async t => {
    const a = session(t); emptyHold(); t.after(() => rmSync(directory, { recursive: true }));
    const paths: string[] = [];
    const browser = createOrdinaryBrowser('patient_insight', async (input) => {
        const operation = String(input).split('/').at(-1)!; paths.push(operation);
        assert.equal(operation, 'status');
        return ordinaryFunctionCommand(web(a.session), operation, {}, new AbortController().signal);
    }, () => {});
    t.after(() => browser.cancel());
    await assert.rejects(browser.reprepare());
    assert.deepEqual(paths, ['status']);
    assert.equal(browser.getSnapshot().settings, null); assert.equal(browser.getSnapshot().state, null);
    assert.ok(browser.getSnapshot().error);
});
test('ordinary status cannot turn an unreadable reservation path into confirmed cleanup', async t => {
    const a = session(t); writeFileSync(directory, 'synthetic non-directory', { flag: 'wx' });
    t.after(() => rmSync(directory));
    const response = await ordinaryFunctionCommand(web(a.session), 'status', {}, new AbortController().signal);
    assert.deepEqual(await response.json(), { schema: 'mediflow.chatgpt-ordinary-flow.v1', phase: 'recovery_required', attemptId: null, cleanupConfirmed: false });
});
test('dedicated HTTP and existing browser retain blocked cleanup across fresh managers and authenticated owners', async t => {
    emptyHold(); t.after(() => rmSync(directory, { recursive: true })); const before = identity();
    const a = session(t), b = session(t); let current: WebSessionProjection | null = web(a.session);
    const f = manager();
    const root = createChatGptProduct({ resolveSession: async () => current, platform: () => f.instance.createPlatform() });
    t.after(() => root.dispose());
    const request = async (operation: Parameters<typeof root.handle>[1], body = {}) => root.handle(new Request('http://localhost:3987' + PRODUCT_NAMESPACE + operation, {
        method: operation === 'status' ? 'GET' : 'POST', headers: { origin: 'http://localhost:3987', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        ...(operation === 'status' ? {} : { body: JSON.stringify(body) }),
    }), operation);
    for (const owner of [web(a.session), web(b.session)]) {
        current = owner;
        const response = await request('status'); assert.equal(response.status, 200);
        const value = await response.json() as ProductResponse;
        assert.equal(value.snapshot.state, 'held'); assert.deepEqual(value.snapshot.preparation, blocked);
        assert.equal(value.snapshot.receipt.cleanup, 'unconfirmed');
        assert.equal(value.snapshot.receipt.ownedGroupCessation, 'not_observed');
        assert.equal(value.snapshot.receipt.leaderExit, 'not_observed');
        assert.equal(value.snapshot.authenticatedProcess, 'none');
        assert.equal(value.snapshot.catalog, null); assert.equal(value.snapshot.result, null);
        assert.doesNotMatch(JSON.stringify(value), /mac-preparation|retained-preparation-|\/synthetic|pid|retainedRoot/iu);
        assert.equal((await request('prepare')).status, 409);
        assert.equal((await request('consent', { operation: PRODUCT_OPERATION, dataClass: PRODUCT_DATA_CLASS, expectedDisclosureRevision: value.snapshot.disclosure.revision })).status, 409);
        for (const operation of ['cancel', 'logout'] as const) {
            const stopped = await request(operation); assert.equal(stopped.status, 200);
            assert.equal(((await stopped.json()) as ProductResponse).snapshot.receipt.cleanup, 'unconfirmed');
            assert.equal((await request('prepare')).status, 409);
        }
    }
    const browser = createProductBrowser(async input => request(String(input).slice(PRODUCT_NAMESPACE.length) as 'status'));
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('status');
    assert.equal(browser.snapshot().snapshot?.preparation.state, 'blocked');
    assert.equal(browser.snapshot().snapshot?.receipt.cleanup, 'unconfirmed');
    current = { ...web(a.session) }; assert.equal((await request('status')).status, 401);
    current = web(a.session); retireSyntheticWebSession(a.session); assert.equal((await request('status')).status, 401);
    current = null; assert.equal((await request('status')).status, 401);
    assert.deepEqual(f.counts(), { starts: 0, resolutions: 0 }); assert.deepEqual(identity(), before);
});

test('dedicated status preserves unknown for an indeterminate path and clean observations for an absent reservation', async t => {
    const a = session(t), f = manager();
    const root = createChatGptProduct({ resolveSession: async () => web(a.session), platform: () => f.instance.createPlatform() });
    t.after(() => root.dispose());
    const request = () => root.handle(new Request('http://localhost:3987' + PRODUCT_NAMESPACE + 'status'), 'status');
    const clean = await (await request()).json() as ProductResponse;
    assert.deepEqual(clean.snapshot.preparation, { state: 'not_prepared', expiresAt: null });
    assert.equal(clean.snapshot.receipt.cleanup, 'not_observed');
    assert.equal(clean.snapshot.receipt.ownedGroupCessation, 'not_observed');
    writeFileSync(directory, 'synthetic non-directory', { flag: 'wx' }); t.after(() => rmSync(directory));
    const unknown = await (await request()).json() as ProductResponse;
    assert.deepEqual(unknown.snapshot.preparation, blocked);
    assert.equal(unknown.snapshot.receipt.cleanup, 'unconfirmed');
    assert.deepEqual(f.counts(), { starts: 0, resolutions: 0 });
});
test('the dedicated cleanup receipt is confirmed only after the original preparation reports clean cessation', async t => {
    const a = session(t);
    let starts = 0;
    const m = createMacProductPlatformManager({ assets, reservationDirectory: () => directory,
        async prepare() { starts++; throw new MacQualificationFailure('readback', cleanAudit, null); } });
    const root = createChatGptProduct({ resolveSession: async () => web(a.session), platform: () => m.createPlatform() });
    t.after(() => root.dispose());
    const request = (operation: 'prepare' | 'cancel' | 'status') => root.handle(new Request('http://localhost:3987' + PRODUCT_NAMESPACE + operation, {
        method: operation === 'status' ? 'GET' : 'POST', headers: { origin: 'http://localhost:3987', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        ...(operation === 'status' ? {} : { body: '{}' }),
    }), operation);
    assert.equal((await request('prepare')).status, 503);
    const response = await request('cancel'); assert.equal(response.status, 200);
    await new Promise<void>(done => setImmediate(done));
    const status = await request('status'); assert.equal(status.status, 200);
    const value = await status.json() as ProductResponse;
    assert.equal(starts, 1); assert.equal(value.snapshot.preparation.state, 'closed');
    assert.equal(value.snapshot.receipt.cleanup, 'confirmed');
    assert.throws(() => lstatSync(hold), { code: 'ENOENT' });
    const ordinary = await ordinaryFunctionCommand(web(a.session), 'status', {}, new AbortController().signal);
    assert.deepEqual(await ordinary.json(), { schema: 'mediflow.chatgpt-ordinary-flow.v1', phase: 'closed', attemptId: null, cleanupConfirmed: true });
});
