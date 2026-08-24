/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const script = path.resolve('scripts/macos-release-path-hygiene.mjs');
const server = "const fs=require('node:fs');if(process.env.MEDIFLOW_TEST_PID_FILE)fs.writeFileSync(process.env.MEDIFLOW_TEST_PID_FILE,String(process.pid));require('node:http').createServer((_, r) => r.end('ok')).listen(process.env.PORT, process.env.HOSTNAME);\n";
const macho = Buffer.alloc(32); macho.writeUInt32LE(0xfeedfacf, 0); macho.writeUInt32LE(0x0100000c, 4);
function fixture(payload = server, executable = macho) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-path-hygiene-'));
  const mac = path.join(app, 'Contents', 'MacOS'), resources = path.join(app, 'Contents', 'Resources');
  fs.mkdirSync(mac, { recursive: true }); fs.mkdirSync(path.join(resources, 'WebRuntime'), { recursive: true });
  fs.writeFileSync(path.join(mac, 'MediFlow'), executable); fs.writeFileSync(path.join(resources, 'WebRuntime', 'server.js'), payload); return app;
}
function run(args, env = {}) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }); }
function tool(body) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-tool-')); fs.writeFileSync(path.join(dir, 'strip'), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return dir; }
function gone(pidFile) { assert.throws(() => process.kill(Number(fs.readFileSync(pidFile)), 0)); }
test('source root is existing, canonical, and neutral', () => {
  const neutral = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-source-')), link = `${neutral}-home`, worktreeLink = `${neutral}-worktree`;
  const codex = path.join(neutral, '.codex', 'worktrees'); fs.mkdirSync(codex, { recursive: true }); fs.symlinkSync(os.homedir(), link, 'dir'); fs.symlinkSync(codex, worktreeLink, 'dir');
  try {
    for (const root of [neutral, `${neutral}-stale`, link, worktreeLink, codex, '/Users', '/Users/example/repo', os.homedir()]) {
      const result = run(['--source-root', root, '--check-source']);
      if (root === neutral) assert.equal(result.status, 0, result.stderr); else assert.notEqual(result.status, 0);
    }
  } finally { fs.rmSync(neutral, { recursive: true, force: true }); fs.rmSync(link, { force: true }); fs.rmSync(worktreeLink, { force: true }); }
});
for (const [name, payload, ok] of [['personal', `// ${os.homedir()}/repo`, false], ['pem', '-----BEGIN PRIVATE KEY-----\nAAAAAAAAAAAAAAAAAAAAAAAA\n-----END PRIVATE KEY-----', false], ['aws', 'AKIAAAAAAAAAAAAAAAAA', false], ['github', '// ghp_1234567890123456789012345678901234567890', false], ['slack', 'xoxb-AAAAAAAAAAAAAAAAAAAAAAAA', false], ['neutral', '// /private/tmp/mediflow-source', true]]) {
  test(`payload marker policy: ${name}`, () => { const app = fixture(`${server}${payload}\n`); try { const result = run(['--app', app, '--check']); ok ? assert.equal(result.status, 0, result.stderr) : assert.notEqual(result.status, 0); } finally { fs.rmSync(app, { recursive: true, force: true }); } });
}
test('denies canonical HOME markers through a declared-home symlink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-home-')), home = path.join(root, 'canonical'), declared = path.join(root, 'declared');
  fs.mkdirSync(home); const canonical = fs.realpathSync.native(home); const app = fixture(`${server}// ${canonical}/secret\n`); fs.symlinkSync(home, declared, 'dir');
  try {
    const result = run(['--app', app, '--check'], { HOME: declared });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /current home directory/); assert.doesNotMatch(result.stderr, new RegExp(canonical));
    const stale = path.join(root, 'stale'), staleResult = run(['--app', app, '--check'], { HOME: stale });
    assert.notEqual(staleResult.status, 0); assert.match(staleResult.stderr, /cannot canonicalize local home/); assert.doesNotMatch(staleResult.stderr, new RegExp(stale));
  } finally { fs.rmSync(app, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});
test('payload links are contained, dereferenced, and cycle-safe', () => {
  const app = fixture(), resources = path.join(app, 'Contents', 'Resources'), link = path.join(resources, 'alias');
  const outside = path.join(os.tmpdir(), `mediflow-secret-${Date.now()}`); fs.writeFileSync(outside, 'ghp_1234567890123456789012345678901234567890'); fs.symlinkSync(outside, link);
  try {
    assert.match(run(['--app', app, '--check']).stderr, /escapes bundle/); fs.unlinkSync(link); fs.symlinkSync('missing', link); assert.match(run(['--app', app, '--check']).stderr, /invalid payload link/);
    fs.unlinkSync(link); fs.writeFileSync(path.join(resources, 'target'), 'ghp_123456789012345678901234567890'); fs.symlinkSync('target', link); assert.match(run(['--app', app, '--check']).stderr, /GitHub token/);
    fs.unlinkSync(link); fs.symlinkSync('loop-b', path.join(resources, 'loop-a')); fs.symlinkSync('loop-a', link); assert.match(run(['--app', app, '--check']).stderr, /invalid payload link/);
  } finally { fs.rmSync(app, { recursive: true, force: true }); fs.rmSync(outside, { force: true }); }
});
test('strip requires a complete supported Mach-O and rechecks after strip', () => {
  const x86 = Buffer.from(macho), unsupported = Buffer.from(macho); x86.writeUInt32LE(0x01000007, 4); unsupported.writeUInt32LE(0x01000008, 4);
  const bad = fixture(server, Buffer.from('not Mach-O')), truncated = fixture(server, macho.subarray(0, 8)), other = fixture(server, unsupported), x86App = fixture(server, x86), good = fixture(), okTools = tool('exit 0'), corruptTools = tool('printf bad > "$2"');
  try {
    assert.match(run(['--app', bad, '--strip'], { PATH: `${okTools}:${process.env.PATH}` }).stderr, /Mach-O arm64/);
    assert.match(run(['--app', truncated, '--strip'], { PATH: `${okTools}:${process.env.PATH}` }).stderr, /Mach-O arm64/);
    assert.match(run(['--app', other, '--strip'], { PATH: `${okTools}:${process.env.PATH}` }).stderr, /Mach-O arm64/);
    assert.equal(run(['--app', x86App, '--strip'], { PATH: `${okTools}:${process.env.PATH}` }).status, 0);
    assert.match(run(['--app', good, '--strip'], { PATH: `${corruptTools}:${process.env.PATH}` }).stderr, /Mach-O arm64/);
  } finally { for (const item of [bad, truncated, other, x86App, good, okTools, corruptTools]) fs.rmSync(item, { recursive: true, force: true }); }
});
test('fails closed when strip fails without leaking tool diagnostics', () => { const app = fixture(), bin = tool("printf '/Users/example/secret' >&2\nexit 7"); try { const result = run(['--app', app, '--strip'], { PATH: `${bin}:${process.env.PATH}` }); assert.match(result.stderr, /strip failed/); assert.doesNotMatch(result.stderr, /\/Users\//); } finally { fs.rmSync(app, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); } });
test('smokes copied WebRuntime on loopback only', () => { const app = fixture(), pidFile = path.join(app, 'child.pid'); try { assert.equal(run(['--app', app, '--smoke'], { MEDIFLOW_TEST_PID_FILE: pidFile }).status, 0); gone(pidFile); } finally { fs.rmSync(app, { recursive: true, force: true }); } });
test('bounds smoke timeout, collision, and child cleanup', async () => {
  const hanging = "const fs=require('node:fs');if(process.env.MEDIFLOW_TEST_PID_FILE)fs.writeFileSync(process.env.MEDIFLOW_TEST_PID_FILE,String(process.pid));require('node:http').createServer(()=>{}).listen(process.env.PORT,process.env.HOSTNAME);";
  const app = fixture(hanging), pidFile = path.join(app, 'child.pid'), occupied = net.createServer();
  try {
    const timed = run(['--app', app, '--smoke'], { MEDIFLOW_TEST_PID_FILE: pidFile }); assert.notEqual(timed.status, 0); gone(pidFile);
    await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve)); const port = occupied.address().port;
    const collision = run(['--app', app, '--smoke'], { MEDIFLOW_TEST_PID_FILE: pidFile, MEDIFLOW_SMOKE_PORT: String(port) }); assert.notEqual(collision.status, 0); gone(pidFile);
  } finally { occupied.close(); fs.rmSync(app, { recursive: true, force: true }); }
});
test('fails closed for unexpected input', () => { const result = run(['--unexpected']); assert.match(result.stderr, /usage:/); });
