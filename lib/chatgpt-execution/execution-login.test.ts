/* @Codex — attached source protocol only, fake transport; not binary qualification. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
// Login-only unit peer; product/owner/consent integration stays parent-only.
const { SyntheticLoginTransport: SyntheticProductTransport } = await import('./fixtures/login-peer.ts');
const { createExecutionLogin, assertExecutionConfig, expectedExecutionConfig, expectedExecutionEnvironment, EXECUTION_PROTOCOL_PROVENANCE, readExecutionLimits } = await import('./execution-login.ts');
const { ExecutionError } = await import('./execution-contract.ts');
const { ProductError } = await import('../chatgpt-product/product-contract.ts');
const denied = (error: unknown) => error instanceof ExecutionError || error instanceof ProductError;
for (const mutation of ['missing-restriction', 'external-provider', 'mcp', 'unknown-enabled-feature', 'hooks', 'instructions', 'unknown-null-root', 'unknown-nested', 'unknown-disabled-feature'] as const) test(`config/read rejects ${mutation}`, () => {
    const config = structuredClone(expectedExecutionConfig()) as Record<string, unknown>;
    if (mutation === 'missing-restriction') delete config.features;
    if (mutation === 'external-provider') config.model_provider = 'other';
    if (mutation === 'mcp') config.mcp_servers = { forbidden: {} };
    if (mutation === 'unknown-enabled-feature') (config.features as Record<string, unknown>).unknown_execution = true;
    if (mutation === 'hooks') config.hooks = { enabled: true };
    if (mutation === 'instructions') config.instructions = 'untrusted';
    if (mutation === 'unknown-null-root') config.unqualified_future_field = null;
    if (mutation === 'unknown-nested') (config.history as Record<string, unknown>).unqualified_future_field = false;
    if (mutation === 'unknown-disabled-feature') (config.features as Record<string, unknown>).unqualified_future_field = false;
    assert.throws(() => assertExecutionConfig({ config, origins: {} }), denied);
});
test('config readback checks every frozen restrictive field, not just one readiness flag', () => {
    assert.doesNotThrow(() => assertExecutionConfig({ config: expectedExecutionConfig(), origins: {}, layers: null }));
    assert.throws(() => assertExecutionConfig({ config: { toolsDisabled: true, safe: true }, origins: {} }), denied);
});
for (const variant of ['foreign', 'failed', 'duplicate', 'malformed'] as const) test(`login completion ${variant} cannot hand off`, async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'login-unit', 'work'));
    const failures: string[] = []; let state = '';
    const login = createExecutionLogin(transport, () => {}, value => { state = value; }, error => failures.push(error.code), transport.cwd); t.after(() => login.dispose());
    await login.start();
    if (variant === 'foreign') transport.login('not-owned');
    if (variant === 'failed') transport.login('fixture-login', false);
    if (variant === 'duplicate') { transport.login(); transport.login(); }
    if (variant === 'malformed') transport.emit('account/login/completed', { loginId: 'fixture-login', success: 'true' });
    assert.equal(failures.length, 1);
    if (variant !== 'duplicate') assert.equal(state, '');
    await assert.rejects(login.complete(), denied);
});
test('matching early completion is bounded and requires a fresh same-process account/config readback', async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'login-early', 'work'));
    transport.override = method => { if (method === 'account/login/start') transport.login(); };
    const login = createExecutionLogin(transport, () => {}, () => {}, error => assert.fail(error.code), transport.cwd); t.after(() => login.dispose());
    await login.start(); assert.equal(await login.complete(), 'plus');
    assert.equal(transport.calls.filter(x => x.method === 'config/read').length, 2);
    assert.equal(transport.calls.filter(x => x.method === 'account/read').length, 2);
    assert.equal(transport.calls.some(x => String(x.method) === 'account/login/complete'), false);
    transport.identity = 'changed@example.invalid'; await assert.rejects(login.read(), denied);
});
for (const url of ['http://auth.openai.com/fixture', 'https://other.invalid/fixture', 'https://auth.openai.com:444/fixture', 'https://user@auth.openai.com/fixture', 'https://auth.openai.com/fixture#secret']) test('device URL is only a validated official server response, not arbitrary navigation', async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'login-url', 'work'));
    transport.override = method => method === 'account/login/start' ? { type: 'chatgptDeviceCode', loginId: 'fixture-login', userCode: 'FAKE-TEST', verificationUrl: url } : undefined;
    const login = createExecutionLogin(transport, () => {}, () => {}, () => {}, transport.cwd); t.after(() => login.dispose());
    await assert.rejects(login.start(), denied);
});
test('known quota window is not a missing-window zero; absent codex bucket never uses fallback', () => {
    assert.deepEqual(readExecutionLimits({ rateLimitsByLimitId: { codex: { primary: null, secondary: { usedPercent: 5 } } } }), { primaryUsedPercent: null, secondaryUsedPercent: 5 });
    assert.throws(() => readExecutionLimits({ rateLimitsByLimitId: {}, rateLimits: { primary: { usedPercent: 0 } } }), denied);
    assert.throws(() => readExecutionLimits({ rateLimits: { primary: { usedPercent: 1 }, rateLimitReachedType: 'blocked' } }), denied);
});

for (const version of ['0.153.40', '10.153.4', '0.153.4-unqualified']) test(`initialize does not admit a near-match version ${version}`, async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'login-version', 'work'));
    transport.override = method => method === 'initialize' ? { ...expectedExecutionEnvironment(transport.cwd), userAgent: `fixture_codex/${version} (synthetic)` } : undefined;
    const login = createExecutionLogin(transport, () => {}, () => {}, () => {}, transport.cwd); t.after(() => login.dispose());
    await assert.rejects(login.start(), denied);
    assert.equal(transport.calls.some(call => call.method === 'account/login/start'), false);
});

// All readback objects below are intentional synthetic inputs, not observations.
test('protocol pins record only supplied C1 regeneration, never ConfigToml or live qualification', () => {
    assert.equal(EXECUTION_PROTOCOL_PROVENANCE.binaryVersion, '0.153.4');
    assert.equal(EXECUTION_PROTOCOL_PROVENANCE.binarySha256, 'a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629');
    assert.equal(EXECUTION_PROTOCOL_PROVENANCE.schemas['v2/ConfigReadResponse.json'], '96a04a3f7fff2dc7fafc9f831e8bcd422e021d697dd2c14c801f098a9f21396d');
    assert.equal(EXECUTION_PROTOCOL_PROVENANCE.configInputSchema.state, 'input_schema_source_available');
    assert.equal(EXECUTION_PROTOCOL_PROVENANCE.configInputSchema.binaryBuildBinding, 'unqualified');
    assert.equal(EXECUTION_PROTOCOL_PROVENANCE.configInputSchema.runtimeReadback, 'not_observed');
    assert.equal(EXECUTION_PROTOCOL_PROVENANCE.binaryBuildBinding, 'unqualified');
    assert.equal(EXECUTION_PROTOCOL_PROVENANCE.normalizedReadback, 'not_observed');
});
for (const field of ['browser_use', 'computer_use', 'desktop', 'forced_chatgpt_workspace_id', 'model',
    'model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope', 'model_context_window',
    'model_reasoning_effort', 'model_verbosity', 'review_model', 'sandbox_workspace_write', 'service_tier']) {
    test(`C2 declared root ${field} stays denied even when a fake sets null or an empty object`, () => {
        for (const value of [null, {}, false, '', 'fixture-value']) {
            assert.throws(() => assertExecutionConfig({ config: { ...expectedExecutionConfig(), [field]: value }, origins: {} }), denied);
        }
    });
}
for (const field of ['instructions', 'developer_instructions', 'compact_prompt']) test(`schema string|null root ${field} never accepts an object, empty string or undefined`, () => {
    assert.doesNotThrow(() => assertExecutionConfig({ config: { ...expectedExecutionConfig(), [field]: null }, origins: {} }));
    for (const value of [{}, [], '', undefined, false, 'added instruction']) {
        assert.throws(() => assertExecutionConfig({ config: { ...expectedExecutionConfig(), [field]: value }, origins: {} }), denied);
    }
});
for (const field of ['mcp_servers', 'model_providers', 'plugins', 'hooks', 'unknown_null', 'unknown_disabled']) {
    test(`unproven extra root ${field} is denied without using additionalProperties as admission`, () => {
        for (const value of [null, {}, false]) assert.throws(() => assertExecutionConfig({ config: { ...expectedExecutionConfig(), [field]: value }, origins: {} }), denied);
    });
}
test('provider root allows no override except openai; absence and explicit null are not a claim of observed normalization', () => {
    for (const provider of [null, 'openai']) assert.doesNotThrow(() => assertExecutionConfig({ config: { ...expectedExecutionConfig(), model_provider: provider }, origins: {} }));
    for (const provider of ['', {}, undefined, 'other']) assert.throws(() => assertExecutionConfig({ config: { ...expectedExecutionConfig(), model_provider: provider }, origins: {} }), denied);
});
test('config envelope rejects missing origins, extra roots, layers and unqualified provenance', () => {
    for (const raw of [
        { config: expectedExecutionConfig() },
        { config: expectedExecutionConfig(), origins: null },
        { config: expectedExecutionConfig(), origins: [] },
        { config: expectedExecutionConfig(), origins: { unqualified_origin: {} } },
        { config: expectedExecutionConfig(), origins: {}, layers: [] },
        { config: expectedExecutionConfig(), origins: {}, layers: [{}] },
        { config: expectedExecutionConfig(), origins: {}, future: null },
    ]) assert.throws(() => assertExecutionConfig(raw), denied);
});
for (const field of ['codexHome', 'platformOs', 'platformFamily', 'userAgent'] as const) {
    test(`initialize missing ${field} cannot advance to initialized or account login`, async t => {
        const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'init-required', 'work'));
        const failures: string[] = [];
        const login = createExecutionLogin(transport, () => {}, () => {}, error => failures.push(error.code), transport.cwd); t.after(() => login.dispose());
        transport.override = method => {
            if (method !== 'initialize') return undefined;
            const response: Record<string, unknown> = { ...expectedExecutionEnvironment(transport.cwd), userAgent: 'codex_cli_rs/0.153.4 (FAKE)' };
            delete response[field]; return response;
        };
        await assert.rejects(login.start(), denied); assert.equal(transport.initializedCalls, 0);
        assert.deepEqual(transport.calls.map(call => call.method), ['initialize']);
    });
}
test('initialize rejects a different private home rather than discovering or reusing account control', async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'init-other', 'work'));
    transport.override = method => method === 'initialize' ? { ...expectedExecutionEnvironment(transport.cwd),
        codexHome: join(process.env.MEDIFLOW_DATA_DIR!, 'different-empty-fixture'), userAgent: 'codex_cli_rs/0.153.4 (FAKE)' } : undefined;
    const login = createExecutionLogin(transport, () => {}, () => {}, () => {}, transport.cwd); t.after(() => login.dispose());
    await assert.rejects(login.start(), denied); assert.equal(transport.initializedCalls, 0);
});
test('initialize then initialized then config and empty account precede the one documented device login', async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'rpc-order', 'work'));
    transport.override = method => {
        if (method !== 'initialize') assert.equal(transport.initializedCalls, 1);
        return undefined;
    };
    const login = createExecutionLogin(transport, () => {}, () => {}, error => assert.fail(error.code), transport.cwd); t.after(() => login.dispose());
    await login.start();
    assert.deepEqual(transport.calls.map(call => call.method), ['initialize', 'config/read', 'account/read', 'account/login/start']);
    assert.deepEqual(transport.calls[2].params, { refreshToken: false });
    assert.deepEqual(transport.calls[3].params, { type: 'chatgptDeviceCode' });
    const before = transport.calls.length;
    await assert.rejects(login.complete(), error => error instanceof ProductError && error.code === 'login_pending');
    assert.equal(transport.calls.length, before);
    transport.login(); await login.complete();
    assert.deepEqual(transport.calls.slice(before).map(call => call.method), ['config/read', 'account/read']);
});
test('completion before the login/start RPC is not a usable early completion', async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'premature-event', 'work'));
    const failures: string[] = [];
    transport.override = method => { if (method === 'config/read') transport.login(); };
    const login = createExecutionLogin(transport, () => {}, () => {}, error => failures.push(error.code), transport.cwd); t.after(() => login.dispose());
    await assert.rejects(login.start(), denied); assert.deepEqual(failures, ['protocol_error']);
    assert.equal(transport.calls.some(call => call.method === 'account/login/start'), false);
});
test('account already present before login fails closed without login/start', async t => {
    const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'nonempty-account', 'work')); transport.connected = true;
    const login = createExecutionLogin(transport, () => {}, () => {}, () => {}, transport.cwd); t.after(() => login.dispose());
    await assert.rejects(login.start(), denied); assert.equal(transport.calls.some(call => call.method === 'account/login/start'), false);
});

for (const [field, value] of [['platformOs', 'unqualified-os'], ['platformFamily', 'unqualified-family'], ['futureField', null]] as const) {
    test(`initialize rejects wrong or undeclared ${field} before initialized`, async t => {
        const transport = new SyntheticProductTransport(join(process.env.MEDIFLOW_DATA_DIR!, 'wrong-platform', 'work'));
        transport.override = method => method === 'initialize' ? { ...expectedExecutionEnvironment(transport.cwd),
            userAgent: 'codex_cli_rs/0.153.4 (FAKE)', [field]: value } : undefined;
        const login = createExecutionLogin(transport, () => {}, () => {}, () => {}, transport.cwd); t.after(() => login.dispose());
        await assert.rejects(login.start(), denied); assert.equal(transport.initializedCalls, 0);
        assert.deepEqual(transport.calls.map(call => call.method), ['initialize']);
    });
}
