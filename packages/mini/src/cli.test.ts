/* @Codex */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
    MINI_EXIT, MINI_HELP, MINI_STDIN_MAX_BYTES, parseMiniTransport, renderMiniTransport, runMiniTransport,
} from './cli';

const CLI = ['scripts/run-strip-types.mjs', 'packages/mini/src/cli.ts'];

function runWithOpenStdin(args: readonly string[], input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [...CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
        child.stdin.on('error', () => undefined);
        child.stdin.write(input);
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Mini waited for stdin')); }, 1_500);
        child.on('error', reject);
        child.on('close', (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    });
}

test('parses one exact JSON transport envelope without mapping a command', () => {
    assert.deepEqual(parseMiniTransport(['--format', 'ndjson'], '{"command":"opaque.intent","args":{"key":"value"}}'), {
        format: 'ndjson', request: { command: 'opaque.intent', args: { key: 'value' } },
    });
    assert.equal(parseMiniTransport(['--format', 'xml'], '{}'), null);
    assert.equal(parseMiniTransport(['opaque.intent'], '{}'), null);
    assert.equal(parseMiniTransport([], '{"command":"x","args":{},"extra":"forged"}'), null);
});

test('renders JSON and ordered NDJSON without execution', () => {
    assert.equal(renderMiniTransport({ items: ['first', 'second'] }, 'json'), '{\n  "items": [\n    "first",\n    "second"\n  ]\n}\n');
    assert.deepEqual(renderMiniTransport({ items: ['first', 'second'] }, 'ndjson').trim().split('\n').map((line) => JSON.parse(line)), [
        { index: 0, item: 'first' }, { index: 1, item: 'second' },
    ]);
    assert.equal(renderMiniTransport({ items: [] }, 'ndjson'), '{"index":null,"item":null}\n');
});

test('keeps the CLI unbound and help transport-only', () => {
    const result = runMiniTransport([], '{"command":"opaque.intent","args":{}}');
    assert.equal(result.exitCode, MINI_EXIT.BROKER_UNAVAILABLE);
    assert.deepEqual(JSON.parse(result.stdout), {
        schemaVersion: 'mediflow.mini.transport.v1', ok: false, error: 'TRANSPORT_UNBOUND',
    });
    assert.equal(MINI_HELP, `MediFlow Mini transport candidate

Usage: npm run --silent mini -- [--format json|ndjson]
       printf '{"command":"opaque.intent","args":{}}' | npm run --silent mini --

This candidate only validates and renders transport envelopes. It does not bind
an application service or execute a command.
`);
});

test('keeps stdout clean and terminates oversized stdin before EOF', async () => {
    const oversized = await runWithOpenStdin(['--format', 'json'], 'caller-text'.repeat(Math.ceil((MINI_STDIN_MAX_BYTES + 1) / 11)));
    assert.equal(oversized.code, MINI_EXIT.USAGE);
    assert.equal(oversized.stderr, '');
    assert.deepEqual(JSON.parse(oversized.stdout), {
        schemaVersion: 'mediflow.mini.transport.v1', ok: false, error: 'INPUT_TOO_LARGE',
    });
    assert.equal(oversized.stdout.includes('caller-text'), false);
});
