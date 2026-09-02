import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MINI_HEADLESS_REFERENTIAL_STATUSES } from './headless-referential-status';

/* @Codex */
const COMMANDS = ['patient search', 'patient show', 'draft preview', 'open-loops', 'whoami', 'capabilities'] as const;
const items = COMMANDS.map((miniCommandId) => ({
  schema: 'mediflow.mini.headless-referential-status.v1', miniCommandId,
  status: 'denied', availability: 'unavailable', manualDisposition: 'manual_only',
  grantability: 'not_grantable', operationId: null, applicationServiceRef: null,
  applyPolicy: 'none', writesPerformed: 0,
}));
const success = { schemaVersion: 'mediflow.mini.transport.v1', ok: true, items };
const failure = (code: 'INVALID_REQUEST' | 'TRANSPORT_UNBOUND') => `${JSON.stringify({
  schemaVersion: 'mediflow.mini.transport.v1', ok: false, error: { code },
})}\n`;
const npmExecPath = process.env.npm_execpath?.endsWith('.js') ? process.env.npm_execpath : null;
const npmCommand = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmArgs = (args: string[]) => npmExecPath ? [npmExecPath, ...args] : args;
const npmOptions = process.platform === 'win32' && !npmExecPath ? { shell: true } : {};

function run(input: string | Buffer, args: string[] = []) {
  const result = spawnSync(npmCommand, npmArgs(['run', '--silent', 'mini', '--', ...args]), {
    cwd: new URL('../../..', import.meta.url), input, encoding: 'utf8', timeout: 5000,
    ...npmOptions,
  });
  assert.equal(result.stderr, '');
  return result;
}

function runDirect(input: string, args: string[], poison: string) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', '--import', new URL('../../../scripts/register-strip-types-loader.mjs', import.meta.url).pathname,
    '--import', `data:text/javascript,${encodeURIComponent(poison)}`, new URL('./cli.ts', import.meta.url).pathname,
    ...args,
  ], { input, encoding: 'utf8', timeout: 5000 });
}

test('serializes the exact six deny-only rows as JSON through the npm entrypoint', () => {
  for (const args of [[], ['--format', 'json']]) {
    const result = run('{"command":"capabilities","args":{}}', args);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `${JSON.stringify(success)}\n`);
    assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ['schemaVersion', 'ok', 'items']);
    assert.doesNotMatch(result.stdout, /anchorId|evidence|unresolved|authority|provider|venue|egress/);
  }
  const boundary = '{"command":"capabilities","args":{}}'.padEnd(16 * 1024, ' ');
  assert.equal(run(boundary).stdout, `${JSON.stringify(success)}\n`);
});

test('serializes exactly six ordered index/item NDJSON rows', () => {
  const result = run('{ "args": {}, "command": "capabilities" }', ['--format', 'ndjson']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${items.map((item, index) => JSON.stringify({ index, item })).join('\n')}\n`);
});

test('prints exact help without reading a request', () => {
  const result = run('', ['--help']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'Usage: mediflow-mini [--format json|ndjson] < request.json\n');
});

test('denies invalid envelopes and argument combinations without echoing input', () => {
  const invalid: readonly [string | Buffer, string[]][] = [
    ['', []], ['{"command":"capabilities","args":{},"extra":1}', []],
    ['{"command":"capabilities","command":"capabilities","args":{}}', []],
    ['{"command":"capabilities","args":{},"args":{}}', []],
    ['{"command":"capabilities","args":{"x":1}}', []], ['not-secret-json', []],
    ['not-secret-json', ['--format', 'ndjson']],
    [Buffer.from([0x7b, 0xff, 0x7d]), []], ['{}', ['capabilities']],
    ['{}', ['--format']], ['{}', ['--format', 'yaml']],
    ['{}', ['--format', 'json', '--format', 'ndjson']], ['{}', ['--help', '--format', 'json']],
  ];
  for (let index = 0; index < invalid.length; index += 1) {
    const result = run(invalid[index]![0], invalid[index]![1]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, failure('INVALID_REQUEST'));
    assert.doesNotMatch(result.stdout, /not-secret-json/);
  }
});

test('returns transport-unbound for a well-formed unknown command', () => {
  for (const args of [[], ['--format', 'ndjson']]) {
    const result = run('{"command":"patient search","args":{}}', args);
    assert.equal(result.status, 69);
    assert.equal(result.stdout, failure('TRANSPORT_UNBOUND'));
  }
});

test('rejects oversized open stdin without waiting for EOF', async () => {
  const child = spawn(npmCommand, npmArgs(['run', '--silent', 'mini']), {
    cwd: new URL('../../..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'], ...npmOptions,
  });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(Buffer.alloc(16 * 1024 + 1, 0x78));
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Mini waited for EOF')); }, 3000);
    child.on('exit', (status) => { clearTimeout(timer); resolve(status); });
  });
  assert.equal(code, 2); assert.equal(stderr, ''); assert.equal(stdout, failure('INVALID_REQUEST'));
});

test('serializes without ambient array iteration or inherited then access', () => {
  const poison = 'setImmediate(()=>{Object.defineProperty(Object.prototype,"then",{configurable:true,get(){throw Error("then")}});Object.defineProperty(Array.prototype,Symbol.iterator,{configurable:true,value(){throw Error("iterator")}})})';
  const result = runDirect('{"command":"capabilities","args":{}}', [], poison);
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(success)}\n`);
});

test('never reads inherited toJSON for success or denial serialization', () => {
  const poison = 'setImmediate(()=>{const d={configurable:true,get(){throw Error("toJSON read")}};Object.defineProperty(Object.prototype,"toJSON",d);Object.defineProperty(Array.prototype,"toJSON",d)})';
  const cases: readonly [string, string[], number, string][] = [
    ['{"command":"capabilities","args":{}}', [], 0, `${JSON.stringify(success)}\n`],
    ['{"command":"capabilities","args":{}}', ['--format', 'ndjson'], 0, `${items.map((item, index) => JSON.stringify({ index, item })).join('\n')}\n`],
    ['not-json', [], 2, failure('INVALID_REQUEST')],
    ['{"command":"patient search","args":{}}', [], 69, failure('TRANSPORT_UNBOUND')],
  ];
  const first = MINI_HEADLESS_REFERENTIAL_STATUSES[0]!;
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index]!;
    const result = runDirect(item[0], item[1], poison);
    assert.equal(result.status, item[2]); assert.equal(result.stderr, ''); assert.equal(result.stdout, item[3]);
  }
  assert.equal(MINI_HEADLESS_REFERENTIAL_STATUSES[0], first);
  for (let index = 0; index < MINI_HEADLESS_REFERENTIAL_STATUSES.length; index += 1) {
    assert.equal(Object.hasOwn(MINI_HEADLESS_REFERENTIAL_STATUSES[index]!, 'toJSON'), false);
  }
});

test('keeps the CLI pipe-only, indexed, and free of executable bindings', () => {
  const source = readFileSync(new URL('./cli.ts', import.meta.url), 'utf8');
  assert.deepEqual(source.match(/^import .*;$/gm), [
    "import { argv, exit, stdin, stdout } from 'node:process';",
    "import { MINI_HEADLESS_REFERENTIAL_STATUSES } from './headless-referential-status';",
  ]);
  assert.doesNotMatch(source, /\.map\(|\.\.\.|for\s*\([^)]*\sof\s|Symbol\.iterator|Promise|\bthen\b/);
  assert.doesNotMatch(source, /trusted-service|registry resolver|semantic runtime|auth|SOAP|Fabric|provider|\bdb\b|route|socket|IPC|network|authority|\bapply\b/i);
  assert.doesNotMatch(source.replaceAll('stdout.write', ''), /\bwrite\b|node:fs|fetch|WebSocket|XMLHttpRequest/i);
});
