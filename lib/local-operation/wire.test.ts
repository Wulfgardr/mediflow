import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { syntheticFixture, SENTINELS } from './synthetic.fixture.ts';
import { createLocalOperationRemoteHost } from './remote-host.ts';
import { createAipOperationRpcHostV1 } from '../../packages/aip/src/operation-rpc.ts';
import { LOCAL_OPERATION_DESCRIPTOR, LOCAL_OPERATION_RPC_MODE, LOCAL_OPERATION_TOOL_DESCRIPTOR,
    localOperationResultSchema } from '../../packages/mcp/src/local-operation-contract.ts';
import { createLocalOperationProtocol } from '../../packages/mcp/src/local-operation-server.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } } };

test('CU-1a: cattura integrale stdio, stderr e IPC del server MCP contro allowlist', async t => {
    const f = await syntheticFixture(); t.after(() => f.close());
    const cap = f.service.create(f.plan.operationId);
    const host = createLocalOperationRemoteHost({ service: f.service, currentSessionBinding: () => f.context.sessionId,
        requestOpen: async () => {}, requestResume: async () => {}, now: f.now });
    const ref = host.publish(cap);
    const rpc = createAipOperationRpcHostV1({ operations: [{ ...LOCAL_OPERATION_DESCRIPTOR, timeoutMs: 1000,
        execute: (input: unknown) => host.remote.request(input) }] });
    const child = fork('scripts/local-operation-mcp-stdio.mjs', [], { cwd: root,
        execArgv: ['--import', fileURLToPath(new URL('../../scripts/register-strip-types-loader.mjs', import.meta.url))],
        env: { ...process.env, MEDIFLOW_AIP_OPERATION_RPC: LOCAL_OPERATION_RPC_MODE }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    const ipc: string[] = [], inbound: string[] = [], stdout: string[] = [], stderr: string[] = [];
    child.on('message', frame => { ipc.push(String(frame)); });
    const handle = rpc.attach({ subscribe(listener: (frame: unknown) => void) { child.on('message', listener); return () => child.off('message', listener); },
        publish(frame: string) { ipc.push(frame); if (child.connected) child.send(frame); } });
    let buffered = '';
    const waiting = new Map<number | null, (frame: Record<string, unknown>) => void>();
    child.stdout!.on('data', chunk => {
        buffered += chunk.toString('utf8');
        while (buffered.includes('\n')) {
            const end = buffered.indexOf('\n'), line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
            stdout.push(line); const frame = JSON.parse(line);
            const resolve = waiting.get(frame.id); waiting.delete(frame.id); resolve?.(frame);
        }
    });
    child.stderr!.on('data', chunk => { stderr.push(chunk.toString('utf8')); });
    t.after(async () => {
        rpc.revoke(handle); host.remote.close();
        if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    });
    const exchange = (frame: Record<string, unknown>, expectedId: number | null = frame.id as number) => new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('synthetic_wire_timeout')), 5000);
        waiting.set(expectedId, response => { clearTimeout(timer); resolve(response); });
        const line = JSON.stringify(frame); inbound.push(line); child.stdin!.write(`${line}\n`);
    });
    assert.deepEqual((await exchange(initialize)).result, { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'mediflow-local-operation', version: '0.1.0' } });
    assert.deepEqual((await exchange({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result, { tools: [LOCAL_OPERATION_TOOL_DESCRIPTOR] });
    let id = 3;
    for (const action of ['open', 'status', 'resume']) {
        f.advance(250);
        const frame = await exchange({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'mediflow.local_operation.v1', arguments: { action, ...(action === 'open' ? {} : { ref }) } } });
        const result = frame.result as { content: unknown; structuredContent: unknown };
        const parsed = localOperationResultSchema.parse(result.structuredContent);
        assert.deepEqual(result, { content: [{ type: 'text', text: JSON.stringify(parsed) }], structuredContent: parsed });
    }
    await f.service.prepare(cap); await f.service.approve(cap); f.loseResponse(); await assert.rejects(f.service.execute(cap));
    f.advance(250);
    await exchange({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'mediflow.local_operation.v1', arguments: { action: 'status', ref } } });
    for (const method of ['resources/list', 'resources/read', 'prompts/list', 'logging/setLevel', 'SYNTHETIC_DIAGNOSIS_5A19']) {
        const frame = await exchange({ jsonrpc: '2.0', id: id++, method, params: { value: SENTINELS[0] } });
        assert.deepEqual(frame.error, { code: -32601, message: 'MediFlow unavailable.' });
    }
    const invalid = await exchange({ jsonrpc: '2.0', id: SENTINELS[0], method: 'tools/call', params: { name: 'mediflow.local_operation.v1', arguments: { action: 'open', _meta: { value: SENTINELS[2] } } } }, null);
    assert.deepEqual(invalid.error, { code: -32602, message: 'MediFlow unavailable.' });
    for (const sentinel of SENTINELS) {
        assert.ok(!stdout.join('\n').includes(sentinel)); assert.ok(!stderr.join('').includes(sentinel)); assert.ok(!ipc.join('\n').includes(sentinel));
    }
    assert.equal(stderr.join(''), '');
    assert.ok(inbound.some(line => line.includes(SENTINELS[0]!)));
    assert.ok(f.traffic.some(item => item.body.includes(SENTINELS[2]!)));
    for (const line of stdout) {
        const frame = JSON.parse(line);
        assert.deepEqual(Object.keys(frame).sort(), ['id', 'jsonrpc', frame.error ? 'error' : 'result'].sort());
    }
});

test('CU-1a: metadati, errori e risultati contaminati non attraversano il protocollo', async () => {
    for (const response of [ { schema: 'mediflow.local-operation.v1', status: 'local_result_available', _meta: { secret: SENTINELS[0] } },
        { schema: 'mediflow.local-operation.v1', status: SENTINELS[2] } ]) {
        const protocol = createLocalOperationProtocol({ request: async () => response as never });
        await protocol.receive(JSON.stringify(initialize));
        const frame = JSON.parse((await protocol.receive(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'mediflow.local_operation.v1', arguments: { action: 'open' } } })))!);
        assert.deepEqual(frame.result.structuredContent, { schema: 'mediflow.local-operation.v1', status: 'unavailable' });
        for (const sentinel of SENTINELS) assert.ok(!JSON.stringify(frame).includes(sentinel));
    }
    const protocol = createLocalOperationProtocol({ request: async () => { throw new Error(SENTINELS.join('|')); } });
    await protocol.receive(JSON.stringify(initialize));
    for (const id of [null, {}, SENTINELS[0], -1, 1.5, 1_000_001]) {
        const response = JSON.parse((await protocol.receive(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' })))!);
        assert.equal(response.id, null);
    }
    assert.equal(JSON.parse((await protocol.receive('x'.repeat(4097)))!).id, null);
    assert.equal(await protocol.receive(JSON.stringify(initialize)), null);
});
