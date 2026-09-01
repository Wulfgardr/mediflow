/* @Codex */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./intelligent-host-mcp-stdio.mjs', import.meta.url));
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

function startServer() {
    const child = spawn(process.execPath, [SERVER], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
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
    const send = (method, params = {}, modern = true) => {
        const id = nextId++;
        const message = { jsonrpc: '2.0', id, method, params: modern ? { ...params, _meta: META } : params };
        const response = new Promise((resolve) => pending.set(id, resolve));
        child.stdin.write(`${JSON.stringify(message)}\n`);
        return withTimeout(response, method);
    };
    const stop = async () => {
        if (child.exitCode === null && !child.killed) child.stdin.end();
        await withTimeout(new Promise((resolve) => child.once('exit', resolve)), 'server exit');
    };
    return { child, protocolMessages, send, stop, stderr: () => stderr };
}

test('discovers one modern-only non-PHI status tool and calls it over real stdio', async () => {
    await access(SERVER);
    const server = startServer();
    const discovered = await server.send('server/discover');
    assert.deepEqual(discovered.result.supportedVersions, [MODERN_VERSION]);
    assert.ok(discovered.result.capabilities.tools);

    const listed = await server.send('tools/list');
    assert.equal(listed.result.tools.length, 1);
    const [tool] = listed.result.tools;
    assert.equal(tool.name, 'mediflow.system.headless_status.v1');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal('resultType' in tool, false);

    const called = await server.send('tools/call', { name: tool.name, arguments: {} });
    assert.deepEqual(called.result.structuredContent, {
        schemaVersion: 'mediflow.system.headless-status.v1',
        candidateVersion: '0.8.5',
        protocolVersion: MODERN_VERSION,
        dataScope: 'non_phi_system_status',
        writes: 0,
        apply: 'none',
    });
    assert.equal(called.result.isError, undefined);
    assert.doesNotMatch(JSON.stringify(called.result), /patient|clinical|secret|token|database|path/iu);
    await server.stop();
    assert.equal(server.stderr(), '');
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
    assert.equal(valid.result.tools.length, 1);
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
