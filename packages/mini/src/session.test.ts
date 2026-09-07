/* @Codex */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AIP_OPERATION_RPC_ENV_KEY_V1, AIP_OPERATION_RPC_LATE_BIND_ENV_V1 } from
  '../../aip/src/child-ipc-contract.ts';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const LOADER = new URL('../../../scripts/register-strip-types-loader.mjs', import.meta.url).href;
const args = ['--experimental-strip-types', '--import', LOADER, CLI, '--session'];

test('session without inherited parent reports disconnected and never ready', () => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5_000, env: {} as NodeJS.ProcessEnv,
    input: '{"command":"status","args":{}}\n' });
  assert.equal(result.status, 69); assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false); assert.equal(output.error.code, 'TRANSPORT_UNBOUND');
  assert.deepEqual(output.status, { transport: 'disconnected', session: 'unavailable',
    ready: false, capabilities: [] });
});

async function connected(input: string | Buffer, end = true) {
  const child = spawn(process.execPath, args, { env: {
    [AIP_OPERATION_RPC_ENV_KEY_V1]: AIP_OPERATION_RPC_LATE_BIND_ENV_V1,
  } as unknown as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '';
  child.stdout!.on('data', (chunk) => { stdout += chunk; });
  child.stderr!.on('data', (chunk) => { stderr += chunk; });
  const completion = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Session timeout')); }, 5_000);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  // No synthetic grant: this parent intentionally never authenticates or binds AIP.
  child.stdin!.on('error', () => undefined);
  if (end) child.stdin!.end(input); else child.stdin!.write(input);
  const code = await completion;
  return { code, stderr, lines: stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

test('prebind session accepts multiple bounded requests and distinguishes catalog denial from status', async () => {
  const result = await connected('{"command":"status","args":{}}\n{"command":"capabilities","args":{}}\n');
  assert.equal(result.code, 0); assert.equal(result.stderr, ''); assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].ok, true); assert.equal(result.lines[0].result.ready, false);
  assert.equal(result.lines[0].result.session, 'not_unlocked');
  assert.equal(result.lines[0].result.transport, 'connected');
  assert.equal(result.lines[1].ok, false); assert.equal(result.lines[1].error.code, 'SESSION_NOT_UNLOCKED');
});

test('invalid or incomplete session requests terminate without reflecting input', async () => {
  for (const input of ['{"command":"status","args":{"unexpected":true}}\n',
    '{"command":"status","command":"capabilities","args":{}}\n',
    '{"command":"status","args":{}}',
    '{"command":"open-loops","args":{}}\n']) {
    const result = await connected(input);
    assert.equal(result.code, 2); assert.equal(result.stderr, '');
    assert.equal(result.lines.length, 1); assert.equal(result.lines[0].error.code, 'INVALID_REQUEST');
    assert.equal(result.lines[0].status.ready, false);
  }
});

test('session bounds a frame without waiting for EOF and bounds lifetime request count', async () => {
  const oversized = await connected(Buffer.alloc(16 * 1024 + 1, 0x20), false);
  assert.equal(oversized.code, 2); assert.equal(oversized.lines[0].error.code, 'INVALID_REQUEST');
  const limited = await connected('{"command":"status","args":{}}\n'.repeat(65));
  assert.equal(limited.code, 2); assert.equal(limited.lines.length, 65);
  assert.equal(limited.lines.at(-1).error.code, 'REQUEST_LIMIT');
});

test('lost parent closes the waiting session even while stdin is open', async () => {
  const child = spawn(process.execPath, args, { env: {
    [AIP_OPERATION_RPC_ENV_KEY_V1]: AIP_OPERATION_RPC_LATE_BIND_ENV_V1,
  } as unknown as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const result = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Disconnect timeout')); }, 5_000);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  child.stdout!.once('data', () => { child.disconnect(); });
  child.stdin!.write('{"command":"status","args":{}}\n');
  assert.equal(await result, 69);
});
