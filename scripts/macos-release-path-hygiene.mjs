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
if (app) {
  app = path.resolve(app);
  if (!fs.existsSync(app)) fail('app must exist');
}

function unsafeSourceRoot(root) {
  if (!path.isAbsolute(root)) fail('source root must be absolute');
  const resolved = path.resolve(root);
  const home = path.resolve(os.homedir());
  return resolved.includes('/Users/') || resolved.includes('/.codex/worktrees/') ||
    (home !== '/' && (resolved === home || resolved.startsWith(`${home}${path.sep}`)));
}

function checkSourceRoot() {
  if (unsafeSourceRoot(sourceRoot)) fail('unsafe source root: use a neutral archive path');
}

function executable() { return path.join(app, 'Contents', 'MacOS', 'MediFlow'); }
function webRuntime() { return path.join(app, 'Contents', 'Resources', 'WebRuntime'); }

function stripExecutable() {
  const file = executable();
  if (!fs.existsSync(file)) fail('missing native executable');
  const result = spawnSync('strip', ['-x', file], { encoding: 'utf8' });
  if (result.status !== 0) fail(`strip failed: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
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
  if (!fs.existsSync(contents)) fail('missing app Contents');
  const violations = [];
  function inspect(file) {
    const text = fs.readFileSync(file).toString('latin1');
    for (const [label, matches] of forbidden) {
      if (matches(text)) violations.push(`${path.relative(app, file)} contains forbidden marker: ${label}`);
    }
  }
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) inspect(file);
      else if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        for (const [label, matches] of forbidden) {
          if (matches(target)) violations.push(`${path.relative(app, file)} contains forbidden marker: ${label}`);
        }
      }
    }
  }
  walk(contents);
  if (violations.length) fail(violations.slice(0, 10).join('\n'));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function requestRoot(port, attempts = 20) {
  return new Promise((resolve, reject) => {
    const request = () => http.get({ host: '127.0.0.1', port, path: '/', timeout: 500 }, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode < 400) resolve();
      else reject(new Error(`GET / returned ${response.statusCode}`));
    }).on('error', (error) => {
      if (attempts-- > 0) setTimeout(request, 100);
      else reject(error);
    });
    request();
  });
}

async function smokeRelocatedRuntime() {
  const runtime = webRuntime();
  if (!fs.existsSync(path.join(runtime, 'server.js'))) fail('missing WebRuntime/server.js');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-relocated-'));
  const copied = path.join(temporary, 'MediFlow.app');
  let child;
  try {
    fs.cpSync(app, copied, { recursive: true });
    const port = await freePort();
    child = spawn(process.execPath, ['server.js'], { cwd: path.join(copied, 'Contents', 'Resources', 'WebRuntime'), env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port) }, stdio: 'ignore' });
    await requestRoot(port);
  } finally {
    child?.kill();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  if (checkSource) checkSourceRoot();
  if (strip) stripExecutable();
  if (check) checkPayload();
  if (smoke) await smokeRelocatedRuntime();
  console.log('macOS release path hygiene passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
