/* @Codex */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    createAipOperationRpcChildEnvironmentV1,
    createAipOperationRpcHostV1,
} from '../packages/aip/src/operation-rpc.ts';

const SERVER = fileURLToPath(new URL('./intelligent-host-mcp-stdio.mjs', import.meta.url));
const STRIP_TYPES_LOADER = process.env.MEDIFLOW_TEST_STRIP_TYPES_LOADER
    ?? fileURLToPath(new URL('./register-strip-types-loader.mjs', import.meta.url));
const TEST_MODULE_ENV = process.env.MEDIFLOW_TEST_NODE_PATH
    ? { NODE_PATH: process.env.MEDIFLOW_TEST_NODE_PATH } : {};
const MODERN_VERSION = '2026-07-28';
const META = Object.freeze({
    'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'mediflow-mcp-contract-test', version: '1.0.0' },
});

function withTimeout(promise, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 4_000);
            timer.unref();
        }),
    ]);
}

async function waitFor(predicate, label) {
    for (let index = 0; index < 100; index += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out: ${label}`);
}

function startServer(bound = false, options = {}) {
    const environment = bound ? createAipOperationRpcChildEnvironmentV1(`aipb_${'1'.repeat(32)}`) : {};
    const child = spawn(process.execPath, ['--experimental-strip-types', '--import', STRIP_TYPES_LOADER, SERVER], {
        env: { ...environment, ...TEST_MODULE_ENV },
        stdio: bound ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe'],
    });
    if (bound) {
        const host = createAipOperationRpcHostV1({ operations: [{
            operationId: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1',
            serviceRef: options.terminologyServiceRef ?? 'AipTerminologySearchServiceV1',
            maximumStage: 'read_only', timeoutMs: options.timeoutMs ?? 250,
            execute: options.terminology ?? (async () => ({ status: 'synthetic' })),
        }, {
            operationId: 'mediflow.patient.open_loops.read.v1',
            capabilityId: 'mediflow.patient.open_loops.read.v1', serviceRef: 'PatientOpenLoopsReadServiceV1',
            maximumStage: 'read_only', timeoutMs: options.timeoutMs ?? 250,
            execute: options.openLoops ?? (async () => ({ status: 'synthetic' })),
        }, {
            operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
            capabilityId: 'mediflow.patient.open_loops.follow_up.propose.v1',
            serviceRef: options.proposalServiceRef ?? 'PatientOpenLoopsFollowUpProposalServiceV1',
            maximumStage: 'proposal_only', timeoutMs: options.timeoutMs ?? 250,
            execute: options.proposal ?? (async () => ({ status: 'synthetic' })),
        }, {
            operationId: 'mediflow.semantic_query_plan.execute.v1',
            capabilityId: 'mediflow.semantic_query_plan.execute.v1',
            serviceRef: options.semanticServiceRef ?? 'SemanticQueryOperationServiceV1',
            maximumStage: 'read_only', timeoutMs: options.timeoutMs ?? 250,
            execute: options.semantic ?? (async () => ({ status: 'synthetic' })),
        }] });
        host.attach({
            subscribe: (listener) => { child.on('message', listener); return () => child.off('message', listener); },
            publish: (frame) => { child.send(frame); },
        });
    }
    const pending = new Map();
    const protocolMessages = [];
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
        for (;;) {
            const newline = stdout.indexOf('\n');
            if (newline < 0) break;
            const line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1);
            if (!line) continue;
            const message = JSON.parse(line); protocolMessages.push(message);
            if ('id' in message && pending.has(message.id)) {
                const resolve = pending.get(message.id); pending.delete(message.id); resolve(message);
            }
        }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let nextId = 1;
    const begin = (method, params = {}, modern = true) => {
        const id = nextId++;
        const message = { jsonrpc: '2.0', id, method, params: modern ? { ...params, _meta: META } : params };
        const response = new Promise((resolve) => pending.set(id, resolve));
        child.stdin.write(`${JSON.stringify(message)}\n`);
        return { id, response: withTimeout(response, method) };
    };
    const send = (method, params = {}, modern = true) => begin(method, params, modern).response;
    const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0', method, params: { ...params, _meta: META },
    })}\n`);
    const stop = async () => {
        if (child.exitCode === null && !child.killed) child.stdin.end();
        await withTimeout(new Promise((resolve) => child.once('exit', resolve)), 'server exit');
    };
    return { begin, child, notify, protocolMessages, send, stop, stderr: () => stderr };
}

const terminologyOutput = Object.freeze({
    schemaVersion: 'mediflow.terminology.search.output.v1', operationId: 'mediflow.terminology.search.v1',
    capabilityId: 'mediflow.terminology.search.v1', applicationServiceRef: 'AipTerminologySearchServiceV1',
    outcome: 'read', items: [{ system: 'LOINC', code: 'synthetic-code', display: 'Synthetic display', version: null }],
    receipt: { schemaVersion: 'mediflow.terminology.search.receipt.v1', receiptRef: 'aiptr_synthetic_0001',
        operationId: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1',
        outcome: 'read', system: 'LOINC', resultCount: 1, catalogSource: 'local-pilot-catalog', egress: 'none',
        writesPerformed: 0, fabricDependency: 'none', timestamp: 1_000 },
});
const openLoopsOutput = Object.freeze({
    schemaVersion: 'mediflow.patient.open_loops.read.result.v1',
    operationId: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1',
    outcome: 'read', items: [{ loopRef: `aipl_${'1'.repeat(64)}`, kind: 'results_pending',
        temporalState: 'open', openedAt: 900, dueAt: 1_100, revision: 1 }], truncated: false, snapshotRevision: 7,
    receipt: { schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1', receiptRef: `aipr_${'2'.repeat(64)}`,
        operationId: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1',
        outcome: 'read', ownerRefHash: `sha256:${'3'.repeat(64)}`, leaseRefHash: `sha256:${'4'.repeat(64)}`,
        receiptRefHash: `sha256:${'5'.repeat(64)}`, generation: 1, revocationGeneration: 0, selectionEpoch: 2,
        snapshotRevision: 7, itemCount: 1, truncated: false, timestamp: 1_000 },
});
const proposalOutput = Object.freeze({
    schemaVersion: 'mediflow.patient.open_loops.follow_up.proposal.v1',
    operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
    capabilityId: 'mediflow.patient.open_loops.follow_up.propose.v1',
    applicationServiceRef: 'PatientOpenLoopsFollowUpProposalServiceV1', outcome: 'proposed',
    maximumStage: 'proposal_only', reviewRequired: true, writesPerformed: 0, apply: 'none',
    proposalRef: `aipfp_${'6'.repeat(64)}`, basedOnSnapshotRevision: 7,
    items: [{ loopRef: `aipl_${'1'.repeat(64)}`, action: 'review_result' }],
    receipt: { schemaVersion: 'mediflow.patient.open_loops.follow_up.proposal.receipt.v1',
        receiptRef: `aipfr_${'7'.repeat(64)}`,
        operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
        capabilityId: 'mediflow.patient.open_loops.follow_up.propose.v1',
        applicationServiceRef: 'PatientOpenLoopsFollowUpProposalServiceV1', outcome: 'proposed',
        proposalRefHash: `sha256:${'8'.repeat(64)}`, receiptRefHash: `sha256:${'9'.repeat(64)}`,
        sourceReceiptRefHash: `sha256:${'a'.repeat(64)}`, basedOnSnapshotRevision: 7,
        itemCount: 1, truncated: false, maximumStage: 'proposal_only', reviewRequired: true,
        writesPerformed: 0, apply: 'none', egress: 'none', timestamp: 1_001 },
});
const semanticArguments = Object.freeze({
    budget: { maxSteps: 2, maxDurationMs: 250, maxOutputBytes: 32_768 },
    explanation: 'Search local terminology and read selected open loops.',
    steps: [{ stepRef: 'step_terminology', operationId: 'mediflow.terminology.search.v1',
        input: { system: 'LOINC', query: '  synthetic   query ', limit: 3 } },
    { stepRef: 'step_open_loops', operationId: 'mediflow.patient.open_loops.read.v1', input: {} }],
});
const semanticInput = Object.freeze({
    schemaVersion: 'mediflow.semantic-query-operation.input.v1',
    operationId: 'mediflow.semantic_query_plan.execute.v1', budget: semanticArguments.budget,
    explanation: semanticArguments.explanation,
    steps: [{ stepRef: 'step_terminology', operationId: 'mediflow.terminology.search.v1',
        input: { schemaVersion: 'mediflow.terminology.search.input.v1',
            operationId: 'mediflow.terminology.search.v1', system: 'LOINC', query: 'synthetic query', limit: 3 } },
    { stepRef: 'step_open_loops', operationId: 'mediflow.patient.open_loops.read.v1',
        input: { schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
            operationId: 'mediflow.patient.open_loops.read.v1' } }],
});
const semanticOutput = Object.freeze({
    schemaVersion: 'mediflow.semantic-query-execution.result.v1', outcome: 'read_completed',
    steps: [{ stepRef: 'step_terminology', operationId: 'mediflow.terminology.search.v1',
        output: terminologyOutput },
    { stepRef: 'step_open_loops', operationId: 'mediflow.patient.open_loops.read.v1', output: openLoopsOutput }],
    receipt: { schemaVersion: 'mediflow.headless.receipt.v1', requestRef: `sqrq_${'b'.repeat(64)}`,
        actionRef: `sqra_${'c'.repeat(64)}`, capabilityId: 'mediflow.semantic_query_plan.execute.v1',
        outcome: 'orchestration', policyDecision: 'allowed',
        revisionBinding: { generation: 1, revocationGeneration: 0, selectionEpoch: 2 },
        operationCount: 2, durationMs: 4, createdAt: 1_002, writesPerformed: 0, applyPolicy: 'none' },
});

test('discovers status, capabilities, two reads, one proposal and semantic orchestration', async (context) => {
    await access(SERVER);
    const server = startServer(true);
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const discovered = await server.send('server/discover');
    assert.deepEqual(discovered.result.supportedVersions, [MODERN_VERSION]);
    assert.ok(discovered.result.capabilities.tools);

    const listed = await server.send('tools/list');
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
        'mediflow.system.headless_status.v1', 'mediflow.system.capabilities.v1',
        'mediflow.terminology.search.v1', 'mediflow.patient.open_loops.read.v1',
        'mediflow.patient.open_loops.follow_up.propose.v1', 'mediflow.semantic_query_plan.execute.v1',
    ]);
    assert.equal(listed.result.tools.every((tool) => tool.annotations.readOnlyHint === true
        && tool.annotations.destructiveHint === false && tool.annotations.openWorldHint === false), true);
    assert.deepEqual(listed.result.tools.map((tool) => tool._meta['mediflow/maximumStage']),
        ['read_only', 'read_only', 'read_only', 'read_only', 'proposal_only', 'read_only']);
    const status = await server.send('tools/call', { name: 'mediflow.system.headless_status.v1', arguments: {} });
    assert.equal(status.result.structuredContent.dataScope, 'non_phi_system_status');
    const capabilities = await server.send('tools/call', { name: 'mediflow.system.capabilities.v1', arguments: {} });
    assert.deepEqual(capabilities.result.structuredContent.operations.map((item) => item.operationId), [
        'mediflow.terminology.search.v1', 'mediflow.patient.open_loops.read.v1',
        'mediflow.patient.open_loops.follow_up.propose.v1', 'mediflow.semantic_query_plan.execute.v1',
    ]);
    assert.equal(capabilities.result.structuredContent.operations.every((item) => !('serviceRef' in item)), true);
    assert.doesNotMatch(JSON.stringify({ status, capabilities }), /patientId|patientName|secret|token|database|path/iu);
    await server.stop();
    assert.equal(server.stderr(), '');
});

test('does not expose an operation whose host service binding is not exact', async (context) => {
    const server = startServer(true, { terminologyServiceRef: 'AipTerminologySearchServiceV2' });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    await server.send('server/discover');
    const listed = await server.send('tools/list');
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
        'mediflow.system.headless_status.v1', 'mediflow.system.capabilities.v1',
        'mediflow.patient.open_loops.read.v1',
        'mediflow.patient.open_loops.follow_up.propose.v1', 'mediflow.semantic_query_plan.execute.v1',
    ]);
    await server.stop();
});

test('calls only the two canonical read inputs and returns minimized validated outputs', async (context) => {
    const observed = [];
    const server = startServer(true, {
        terminology: async (input) => { observed.push(input); return terminologyOutput; },
        openLoops: async (input) => { observed.push(input); return openLoopsOutput; },
    });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const terminology = await server.send('tools/call', { name: 'mediflow.terminology.search.v1',
        arguments: { system: 'LOINC', query: '  synthetic   query ', limit: 3 } });
    assert.deepEqual(terminology.result.structuredContent, terminologyOutput);
    assert.equal(terminology.result.content[0].text, 'Terminology search returned 1 item(s).');
    const loops = await server.send('tools/call', {
        name: 'mediflow.patient.open_loops.read.v1', arguments: {},
    });
    assert.deepEqual(loops.result.structuredContent, openLoopsOutput);
    assert.equal(loops.result.content[0].text, 'Open-loops read returned 1 item(s).');
    assert.equal(observed.every((input) => Object.getPrototypeOf(input) === null && Object.isFrozen(input)), true);
    assert.deepEqual(observed.map((input) => ({ ...input })), [{ schemaVersion: 'mediflow.terminology.search.input.v1',
        operationId: 'mediflow.terminology.search.v1', system: 'LOINC', query: 'synthetic query', limit: 3 }, {
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: 'mediflow.patient.open_loops.read.v1',
    }]);
    assert.doesNotMatch(JSON.stringify({ terminology, loops }), /patientId|patientName|birth|authority|provider/i);
    await server.stop();
    assert.equal(server.stderr(), '');
});

test('calls the named follow-up proposal tool with an exact empty caller input', async (context) => {
    const observed = [];
    const server = startServer(true, {
        proposal: async (input) => { observed.push(input); return proposalOutput; },
    });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const proposal = await server.send('tools/call', {
        name: 'mediflow.patient.open_loops.follow_up.propose.v1', arguments: {},
    });
    assert.deepEqual(proposal.result.structuredContent, proposalOutput);
    assert.equal(proposal.result.content[0].text, 'Follow-up proposal returned 1 review item(s); apply none.');
    assert.deepEqual(observed.map((input) => ({ ...input })), [{
        schemaVersion: 'mediflow.patient.open_loops.follow_up.propose.input.v1',
        operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
    }]);
    assert.doesNotMatch(JSON.stringify(proposal), /patientId|patientName|birth|diagnosis|reasoning|prompt|authority/iu);
    await server.stop();
    assert.equal(server.stderr(), '');
});

test('calls the named semantic query tool with only strict allowlisted steps', async (context) => {
    const observed = [];
    const server = startServer(true, {
        semantic: async (input) => { observed.push(input); return semanticOutput; },
    });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const semantic = await server.send('tools/call', {
        name: 'mediflow.semantic_query_plan.execute.v1', arguments: semanticArguments,
    });
    assert.deepEqual(semantic.result.structuredContent, semanticOutput);
    assert.equal(semantic.result.content[0].text, 'Semantic query completed 2 read step(s); writes 0, apply none.');
    assert.deepEqual(JSON.parse(JSON.stringify(observed)), [semanticInput]);
    assert.equal(semantic.result.structuredContent.receipt.writesPerformed, 0);
    assert.equal(semantic.result.structuredContent.receipt.applyPolicy, 'none');
    assert.doesNotMatch(JSON.stringify(semantic), /patientId|ambulatoryId|authority|provider|venue|sql/iu);
    await server.stop();
    assert.equal(server.stderr(), '');
});

test('rejects a semantic result beyond the caller duration budget', async (context) => {
    const server = startServer(true, { semantic: async () => semanticOutput });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const response = await server.send('tools/call', {
        name: 'mediflow.semantic_query_plan.execute.v1',
        arguments: { ...semanticArguments,
            budget: { ...semanticArguments.budget, maxDurationMs: semanticOutput.receipt.durationMs - 1 } },
    });
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, 'MediFlow operation denied: protocol_invalid.');
    await server.stop();
});

test('rejects a semantic result beyond the caller UTF-8 output budget', async (context) => {
    const utf8Terminology = { ...terminologyOutput,
        items: [{ ...terminologyOutput.items[0], display: 'é'.repeat(100) }] };
    const oversized = { ...semanticOutput, steps: [
        { ...semanticOutput.steps[0], output: utf8Terminology }, semanticOutput.steps[1],
    ] };
    const json = JSON.stringify(oversized);
    const utf8Bytes = Buffer.byteLength(json, 'utf8');
    assert.ok(utf8Bytes > json.length);
    const server = startServer(true, { semantic: async () => oversized });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const response = await server.send('tools/call', {
        name: 'mediflow.semantic_query_plan.execute.v1',
        arguments: { ...semanticArguments,
            budget: { ...semanticArguments.budget, maxOutputBytes: json.length } },
    });
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, 'MediFlow operation denied: protocol_invalid.');
    await server.stop();
});

test('rejects caller-supplied patient scope and authority before every host service', async (context) => {
    let calls = 0;
    const server = startServer(true, { terminology: () => { calls += 1; return terminologyOutput; },
        openLoops: () => { calls += 1; return openLoopsOutput; },
        proposal: () => { calls += 1; return proposalOutput; },
        semantic: () => { calls += 1; return semanticOutput; } });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const forgedLoops = await server.send('tools/call', { name: 'mediflow.patient.open_loops.read.v1',
        arguments: { patientId: 'caller-selected' } });
    const forgedTerminology = await server.send('tools/call', { name: 'mediflow.terminology.search.v1',
        arguments: { system: 'LOINC', query: 'synthetic', limit: 1, authority: 'caller' } });
    const forgedProposal = await server.send('tools/call', {
        name: 'mediflow.patient.open_loops.follow_up.propose.v1',
        arguments: { text: 'forbidden freeform', authority: 'caller' },
    });
    const forgedSemantic = await server.send('tools/call', {
        name: 'mediflow.semantic_query_plan.execute.v1',
        arguments: { ...semanticArguments, sourceRefs: ['caller'], provider: 'caller' },
    });
    assert.equal(forgedLoops.error?.code === -32602 || forgedLoops.result?.isError === true, true);
    assert.equal(forgedTerminology.error?.code === -32602 || forgedTerminology.result?.isError === true, true);
    assert.equal(forgedProposal.error?.code === -32602 || forgedProposal.result?.isError === true, true);
    assert.equal(forgedSemantic.error?.code === -32602 || forgedSemantic.result?.isError === true, true);
    assert.doesNotMatch(JSON.stringify({ forgedLoops, forgedTerminology, forgedProposal, forgedSemantic }),
        /caller-selected|forbidden freeform|"caller"/u);
    assert.equal(calls, 0);
    await server.stop();
});

test('propagates MCP cancellation to child RPC and discards the late service completion', async (context) => {
    let entered = false; let signal; let finish;
    const server = startServer(true, { terminology: (_input, serviceSignal) => {
        entered = true; signal = serviceSignal;
        return new Promise((resolve) => { finish = resolve; });
    } });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const call = server.begin('tools/call', { name: 'mediflow.terminology.search.v1',
        arguments: { system: 'LOINC', query: 'synthetic', limit: 1 } });
    void call.response.catch(() => undefined);
    await waitFor(() => entered, 'service entry');
    server.notify('notifications/cancelled', { requestId: call.id, reason: 'synthetic cancellation' });
    await waitFor(() => signal?.aborted === true, 'RPC abort propagation');
    finish(terminologyOutput);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(server.protocolMessages.filter((message) => message.id === call.id).length, 0);
    await server.stop();
});

test('maps the host budget denial without publishing a later service result', async (context) => {
    let finish;
    const server = startServer(true, { timeoutMs: 15, terminology: () => new Promise((resolve) => { finish = resolve; }) });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const call = server.begin('tools/call', { name: 'mediflow.terminology.search.v1',
        arguments: { system: 'LOINC', query: 'synthetic', limit: 1 } });
    const response = await call.response;
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, 'MediFlow operation denied: timeout.');
    finish(terminologyOutput);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(server.protocolMessages.filter((message) => message.id === call.id).length, 1);
    await server.stop();
});

test('cancels the host when the client budget expires and drops the late result', async (context) => {
    let entered = false; let signal; let finish;
    const server = startServer(true, { timeoutMs: 1_500, terminology: (_input, serviceSignal) => {
        entered = true; signal = serviceSignal;
        return new Promise((resolve) => { finish = resolve; });
    } });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const call = server.begin('tools/call', { name: 'mediflow.terminology.search.v1',
        arguments: { system: 'LOINC', query: 'synthetic', limit: 1 } });
    await waitFor(() => entered, 'service entry');
    const response = await call.response;
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, 'MediFlow operation denied: timeout.');
    await waitFor(() => signal?.aborted === true, 'client-budget RPC abort propagation');
    finish(terminologyOutput);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(server.protocolMessages.filter((message) => message.id === call.id).length, 1);
    await server.stop();
});

test('rejects hostile service output without reflecting it to the MCP caller', async (context) => {
    let calls = 0;
    const server = startServer(true, { terminology: () => {
        calls += 1; return calls === 1 ? { ...terminologyOutput, patientName: 'sensitive-value' } : terminologyOutput;
    } });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const response = await server.send('tools/call', { name: 'mediflow.terminology.search.v1',
        arguments: { system: 'LOINC', query: 'synthetic', limit: 1 } });
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, 'MediFlow operation denied: protocol_invalid.');
    assert.doesNotMatch(JSON.stringify(response), /sensitive-value|patientName/u);
    const retry = await server.send('tools/call', { name: 'mediflow.terminology.search.v1',
        arguments: { system: 'LOINC', query: 'synthetic', limit: 1 } });
    assert.equal(retry.result.content[0].text, 'MediFlow operation denied: host_unbound.');
    assert.equal(calls, 1);
    await server.stop();
});

test('rejects a non-closed-world follow-up proposal without reflecting clinical text', async (context) => {
    let calls = 0;
    const server = startServer(true, { proposal: () => {
        calls += 1; return { ...proposalOutput, diagnosis: 'sensitive-value' };
    } });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const response = await server.send('tools/call', {
        name: 'mediflow.patient.open_loops.follow_up.propose.v1', arguments: {},
    });
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, 'MediFlow operation denied: protocol_invalid.');
    assert.doesNotMatch(JSON.stringify(response), /sensitive-value|diagnosis/u);
    const retry = await server.send('tools/call', {
        name: 'mediflow.patient.open_loops.follow_up.propose.v1', arguments: {},
    });
    assert.equal(retry.result.content[0].text, 'MediFlow operation denied: host_unbound.');
    assert.equal(calls, 1);
    await server.stop();
});

test('rejects a non-closed-world semantic result without reflecting clinical text', async (context) => {
    let calls = 0;
    const server = startServer(true, { semantic: () => {
        calls += 1; return { ...semanticOutput, diagnosis: 'sensitive-value' };
    } });
    context.after(() => { if (server.child.exitCode === null) server.child.kill(); });
    const response = await server.send('tools/call', {
        name: 'mediflow.semantic_query_plan.execute.v1', arguments: semanticArguments,
    });
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, 'MediFlow operation denied: protocol_invalid.');
    assert.doesNotMatch(JSON.stringify(response), /sensitive-value|diagnosis/u);
    const retry = await server.send('tools/call', {
        name: 'mediflow.semantic_query_plan.execute.v1', arguments: semanticArguments,
    });
    assert.equal(retry.result.content[0].text, 'MediFlow operation denied: host_unbound.');
    assert.equal(calls, 1);
    await server.stop();
});

test('rejects a legacy initialize and remains usable for a modern opening', async () => {
    const server = startServer();
    const legacy = await server.send('initialize', {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' },
    }, false);
    assert.equal(legacy.error.code, -32022);
    assert.deepEqual(legacy.error.data.supported, [MODERN_VERSION]);
    const modern = await server.send('server/discover');
    assert.deepEqual(modern.result.supportedVersions, [MODERN_VERSION]);
    await server.stop();
});

test('fails unknown tools in-band and survives malformed JSON without stdout noise', async () => {
    const server = startServer();
    server.child.stdin.write('{not-json}\n');
    const response = await server.send('tools/call', { name: 'unknown.tool', arguments: {} });
    assert.ok(response.error || response.result?.isError === true);
    const valid = await server.send('tools/list');
    assert.equal(valid.error.code, -32601);
    await server.stop();
    assert.equal(server.protocolMessages.every((message) => message.jsonrpc === '2.0'), true);
});

test('bounds the stdio frame and keeps the source isolated from app authority', async () => {
    const source = await readFile(SERVER, 'utf8');
    assert.match(source, /maxBufferSize:\s*65_536/u);
    assert.doesNotMatch(source, /(?:@\/|lib\/|better-sqlite3|next\/|node:(?:net|http)|process\.env)/u);
    const server = startServer();
    server.child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { pad: 'x'.repeat(70_000), _meta: META } })}\n`);
    await withTimeout(new Promise((resolve) => server.child.once('exit', resolve)), 'oversized frame rejection');
    assert.equal(server.protocolMessages.length, 0);
    assert.equal(server.stderr(), 'MCP stdio transport error\n');
});
