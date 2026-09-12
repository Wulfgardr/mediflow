/* @Codex — synthetic bootstrap contract tests through the actual product wrapper.
 * No object here can enter the private Mac qualification registry. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import type { ExecutionTransport } from './execution-contract';
const { SyntheticProductTransport, createProductFixture } = await import('../chatgpt-product/product-production.test.ts');
const { createExecutionLogin, expectedExecutionEnvironment } = await import('./execution-login.ts');
const { ExecutionError } = await import('./execution-contract.ts');
const rejected = (error: unknown) => error instanceof ExecutionError;

test('prepared initialization traverses the real product wrapper once; config/account are reread and consent remains mandatory', async t => {
    const fixture = createProductFixture(t);
    const transport = fixture.transport as typeof fixture.transport & ExecutionTransport;
    let consumed = 0;
    transport.takeInitializationObservation = () => {
        if (++consumed !== 1) throw new ExecutionError('unqualified_boundary');
        return { ...expectedExecutionEnvironment(transport.cwd), userAgent: 'synthetic_codex/0.153.4' };
    };
    transport.override = method => {
        if (method === 'initialize') throw new ExecutionError('protocol_error'); // A second handshake is a real regression.
        return undefined;
    };
    assert.equal((await fixture.call('login/start')).status, 409); assert.equal(consumed, 0);
    await fixture.consent(); assert.equal(consumed, 0); assert.equal(transport.calls.length, 0);
    const start = await fixture.request('login/start'); assert.ok(start.login);
    assert.equal(consumed, 1); assert.equal(transport.calls.some(c => c.method === 'initialize'), false);
    assert.equal(transport.calls.filter(c => c.method === 'config/read').length, 1);
    assert.equal(transport.calls.filter(c => c.method === 'account/read').length, 1);
    transport.login(); await fixture.request('login/complete');
    assert.equal(transport.calls.filter(c => c.method === 'config/read').length, 2);
    assert.equal(transport.calls.filter(c => c.method === 'account/read').length, 2);
    assert.equal(transport.calls.some(c => c.method === 'turn/start'), false);
    assert.equal((await fixture.request('status')).snapshot.clinicalAdmission, 'held');
});
for (const kind of ['stale-layout', 'stale-version', 'revoked', 'reuse'] as const) test(`prepared login rejects ${kind} before device-code request`, async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, `prepared-${kind}`, 'work')) as InstanceType<typeof SyntheticProductTransport> & ExecutionTransport;
    let used = false;
    transport.takeInitializationObservation = () => {
        if (kind === 'revoked' || used && kind === 'reuse') throw new ExecutionError('unqualified_boundary');
        used = true;
        return { ...expectedExecutionEnvironment(transport.cwd),
            ...(kind === 'stale-layout' ? { codexHome: '/not-this-run/codex' } : {}),
            userAgent: kind === 'stale-version' ? 'synthetic_codex/0.153.40' : 'synthetic_codex/0.153.4' };
    };
    if (kind === 'reuse') transport.takeInitializationObservation();
    const login = createExecutionLogin(transport, () => {}, () => {}, () => {}, transport.cwd); t.after(() => login.dispose());
    await assert.rejects(login.start(), rejected);
    assert.equal(transport.calls.length, 0);
});
