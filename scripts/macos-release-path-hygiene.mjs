/* @Codex */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
function fail(message) { throw new Error(`macOS release path hygiene: ${message}`); }
function usage() { fail('usage: --source-root <absolute path> --check-source | --app <MediFlow.app> [--strip] [--check] [--smoke]'); }
const args = process.argv.slice(2);
let app;
let sourceRoot;
let checkSource = false;
let strip = false;
let check = false;
let smoke = false;
for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === '--app' || value === '--source-root') {
    const next = args[index += 1];
    if (!next) usage();
    if (value === '--app') app = next;
    else sourceRoot = next;
  } else if (value === '--check-source') checkSource = true;
  else if (value === '--strip') strip = true;
  else if (value === '--check') check = true;
  else if (value === '--smoke') smoke = true;
  else usage();
}
if ((!checkSource && !strip && !check && !smoke) || (checkSource && !sourceRoot) || ((strip || check || smoke) && !app)) usage();
if (app) { app = path.resolve(app); if (!fs.existsSync(app)) fail('app must exist'); }
function unsafeSourceRoot(root) {
  if (!path.isAbsolute(root)) fail('source root must be absolute');
  let stat; try { stat = fs.statSync(root); } catch { fail('source root must be an existing directory'); }
  if (!stat.isDirectory()) fail('source root must be an existing directory');
  let resolved; try { resolved = fs.realpathSync.native(root); } catch { fail('source root must be an existing directory'); }
  const home = fs.realpathSync.native(os.homedir());
  const inside = (value, base) => value === base || value.startsWith(`${base}${path.sep}`);
  const inCodex = resolved.split(path.sep).some((part, index, parts) => part === '.codex' && parts[index + 1] === 'worktrees');
  return inside(resolved, '/Users') || inCodex ||
    (home !== '/' && inside(resolved, home));
}
function executable() { return path.join(app, 'Contents', 'MacOS', 'MediFlow'); }
function webRuntime() { return path.join(app, 'Contents', 'Resources', 'WebRuntime'); }

const MACHO_ARM64 = 0x0100000c;
function isArm64Macho(file) {
  try {
    const data = fs.readFileSync(file);
    if (data.length < 8) return false;
    const le = data.readUInt32LE(0), be = data.readUInt32BE(0);
    if (le === 0xfeedfacf || be === 0xfeedfacf) return (le === 0xfeedfacf ? data.readUInt32LE(4) : data.readUInt32BE(4)) === MACHO_ARM64;
    const fat = be === 0xcafebabe || be === 0xcafebabf ? { little: false, step: be === 0xcafebabf ? 32 : 20 } : be === 0xbebafeca || be === 0xbfbafeca ? { little: true, step: be === 0xbfbafeca ? 32 : 20 } : null;
    if (!fat) return false;
    const read = (offset) => fat.little ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
    for (let index = 0; index < read(4) && 8 + index * fat.step + 4 <= data.length; index += 1) if (read(8 + index * fat.step) === MACHO_ARM64) return true;
  } catch {}
  return false;
}
function assertArm64Macho(file) { if (!isArm64Macho(file)) fail('native executable must be a Mach-O arm64 binary'); }
function stripExecutable() {
  const file = executable();
  if (!fs.existsSync(file)) fail('missing native executable');
  assertArm64Macho(file);
  const result = spawnSync('strip', ['-x', file], { encoding: 'utf8' });
  if (result.status !== 0) fail(`strip failed: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
  assertArm64Macho(file);
}
const forbidden = [
  ['current home directory', path.resolve(os.homedir())],
  ['Codex worktree', '/.codex/worktrees/'],
].map(([label, literal]) => [label, (text) => text.includes(literal)]).concat([
  ['private key', /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]{20,}?-----END(?: [A-Z]+)? PRIVATE KEY-----/],
  ['AWS access key', '\\bAKIA[0-9A-Z]{16}\\b'],
  ['GitHub token', '\\bgh[pousr]_[A-Za-z0-9]{20,}\\b'],
  ['Slack token', '\\bxox[baprs]-[A-Za-z0-9-]{20,}\\b'],
].map(([label, pattern]) => [label, (text) => new RegExp(pattern).test(text)]));
function checkPayload() {
  const contents = path.join(app, 'Contents');
  let canonicalApp, canonicalContents;
  try { canonicalApp = fs.realpathSync.native(app); canonicalContents = fs.realpathSync.native(contents); }
  catch { fail('missing app Contents'); }
  const visited = new Set(), inside = (value, base) => value === base || value.startsWith(`${base}${path.sep}`);
  if (!inside(canonicalContents, canonicalApp)) fail('payload link escapes bundle: Contents');
  const violations = [];
  function visit(candidate, label) {
    let real;
    try { real = fs.realpathSync.native(candidate); }
    catch { fail(`invalid payload link: ${path.relative(app, label)}`); }
    if (!inside(real, canonicalContents)) fail(`payload link escapes bundle: ${path.relative(app, label)}`);
    if (visited.has(real)) return;
    visited.add(real);
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(real, { withFileTypes: true })) visit(path.join(real, entry.name), path.join(label, entry.name));
      return;
    }
    if (!stat.isFile()) fail(`unsupported payload entry: ${path.relative(app, label)}`);
    const text = fs.readFileSync(real).toString('latin1');
    for (const [marker, matches] of forbidden) if (matches(text)) violations.push(`${path.relative(app, label)} contains forbidden marker: ${marker}`);
  }
  visit(canonicalContents, contents);
  if (violations.length) fail(violations.slice(0, 10).join('\n'));
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close((error) => error ? reject(error) : resolve(address.port)); });
  });
}
function smokePort() {
  if (process.env.MEDIFLOW_SMOKE_PORT === undefined) return freePort();
  const port = Number(process.env.MEDIFLOW_SMOKE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail('invalid smoke port');
  return port;
}
function requestRoot(port, attempts = 20, deadline = 2_000) {
  return new Promise((resolve, reject) => {
    const expires = Date.now() + deadline;
    let settled = false, lastError;
    const finish = (error) => { if (settled) return; settled = true; error ? reject(error) : resolve(); };
    const attempt = () => {
      if (settled) return;
      const remaining = expires - Date.now();
      if (remaining <= 0 || attempts-- < 0) return finish(lastError || new Error('GET / timed out'));
      let done = false, timer;
      const retry = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        lastError = error;
        if (Date.now() < expires && attempts >= 0) setTimeout(attempt, 50);
        else finish(error);
      };
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        response.resume();
        if (response.statusCode && response.statusCode < 400) finish();
        else finish(new Error(`GET / returned ${response.statusCode}`));
      });
      req.once('error', retry);
      timer = setTimeout(() => { retry(new Error('GET / timed out')); req.destroy(); }, Math.min(500, remaining));
    };
    attempt();
  });
}
function waitForExit(child, timeout = 500) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.removeListener('exit', done); resolve(false); }, timeout);
    child.once('exit', done);
    if (child.exitCode !== null) done();
  });
}
async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill('SIGTERM'); } catch {}
  if (await waitForExit(child)) return;
  try { child.kill('SIGKILL'); } catch {}
  if (!(await waitForExit(child))) fail('relocated runtime did not exit');
}
async function smokeRelocatedRuntime() {
  const runtime = webRuntime();
  if (!fs.existsSync(path.join(runtime, 'server.js'))) fail('missing WebRuntime/server.js');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-relocated-'));
  const copied = path.join(temporary, 'MediFlow.app');
  let child;
  try {
    fs.cpSync(app, copied, { recursive: true });
    const port = await smokePort();
    child = spawn(process.execPath, ['server.js'], { cwd: path.join(copied, 'Contents', 'Resources', 'WebRuntime'), env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port) }, stdio: 'ignore' });
    await requestRoot(port);
  } finally {
    try { await stopChild(child); } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
}
try {
  if (checkSource && unsafeSourceRoot(sourceRoot)) fail('unsafe source root: use a neutral archive path');
  if (strip) stripExecutable();
  if (check) checkPayload();
  if (smoke) await smokeRelocatedRuntime();
  console.log('macOS release path hygiene passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
