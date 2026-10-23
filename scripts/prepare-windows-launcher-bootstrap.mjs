#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeWindowsSystemCommand } from './windows-system-command.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'scripts/windows-launcher-bootstrap');
const sdkVersion = '24.22.0';
const checksums = {
  headers: '00e9f08b9057f9f5428387a5ffd496e53f274565b40b144b7ba876700755352a',
  x64: 'a0a84aa03917b578d286010b7521837e9ff1136ffb2e4a406c14316c33fd06f7',
  arm64: '2c0c3215d59c09d7c136da4949696dae121a299e9bdfc64cd9130a58610af63d',
};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(file);
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 120000, windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(`Development command failed: ${command}: ${result.status}`);
};
const metadata = () => ({ node: process.version, arch: process.arch, machine: os.machine(), uv: process.versions.uv });

function assertNativeHost() {
  const arch = process.arch, machine = os.machine().toLowerCase();
  assert.ok(arch === 'x64' ? ['x86_64', 'amd64'].includes(machine) : arch === 'arm64' && ['arm64', 'aarch64'].includes(machine), 'Development gate requires a native host and matching Node architecture');
}

async function build() {
  const arch = process.arch;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-win-bootstrap-build-'));
  const output = path.join(scratch, 'output'); fs.mkdirSync(output);
  try {
    for (const [remote, file, checksum] of [
      [`node-v${sdkVersion}-headers.tar.gz`, 'headers.tar.gz', checksums.headers],
      [`win-${arch}/node.lib`, 'node.lib', checksums[arch]],
    ]) {
      const response = await fetch(`https://nodejs.org/dist/v${sdkVersion}/${remote}`, { signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha(bytes), checksum, 'Pinned development SDK differs'); fs.writeFileSync(path.join(scratch, file), bytes, { flag: 'wx' });
    }
    run('tar.exe', ['-xf', path.join(scratch, 'headers.tar.gz'), '-C', scratch], scratch);
    run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(directory, 'build.ps1'), '-Architecture', arch, '-Sdk', scratch, '-Output', output], scratch);
    const dependencies = [...read(path.join(output, 'dependencies.txt')).toString('utf8').matchAll(/^\s+([\w.-]+\.(?:dll|exe))\s*$/gimu)].map(match => match[1].toLowerCase()).sort();
    assert.deepEqual(dependencies, ['kernel32.dll', 'node.exe'], 'Bootstrap must not acquire CRT, symbol, network or other runtime dependencies');
    const binary = read(path.join(output, 'system-directory.node'));
    const manifest = { schemaVersion: 1, platform: 'win32', arch, napiVersion: 1, binary: 'system-directory.node',
      bytes: binary.length, sha256: sha(binary), dependencies,
      sourceSha256: sha(read(path.join(directory, 'system-directory.c'))), recipeSha256: sha(read(path.join(directory, 'build.ps1'))),
      builderSha256: sha(read(fileURLToPath(import.meta.url))),
      sdk: { node: sdkVersion, headersSha256: checksums.headers, librarySha256: checksums[arch] },
      build: { ...metadata(), ...JSON.parse(read(path.join(output, 'toolchain.json')).toString('utf8').replace(/^\uFEFF/u, '')) } };
    const target = path.join(directory, 'prebuilds', `win32-${arch}`);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'system-directory.node'), binary, { flag: 'wx' });
    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ type: 'bootstrap-built', ...metadata(), sha256: manifest.sha256, dependencies }));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

async function sourceFirst() {
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false, 'Source-first qualification must run before npm ci, without node_modules');
  initializeWindowsSystemCommand();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-source-first-~'));
  const data = path.join(fixture, 'archive'); fs.mkdirSync(data);
  const child = spawn(process.execPath, ['--import', new URL('./windows-launcher-bootstrap/observe-command.mjs', import.meta.url).href,
    path.join(root, 'scripts/mediflow.mjs'), '--scelta', 'web', '--senza-browser'], {
    cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
      APPDATA: path.join(fixture, 'profile'), LOCALAPPDATA: path.join(fixture, 'local') }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostic = '', closed = false, failure;
  const terminal = Promise.all([new Promise(resolve => child.once('exit', (code, signal) => {
    console.log(JSON.stringify({ type: 'source-first-exit', pid: child.pid, code, signal })); resolve();
  })), new Promise(resolve => child.stderr.once('close', () => {
    console.log(JSON.stringify({ type: 'source-first-stderr-close', pid: child.pid })); resolve();
  }))]).then(() => { closed = true; });
  child.on('error', error => { failure = error; });
  child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-8192); });
  let timer;
  try {
    await Promise.race([terminal, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Source-first launcher observation expired')), 10000); })]);
    if (failure) throw failure;
    assert.match(diagnostic, /Avvio: http:\/\/127\.0\.0\.1:/u);
    assert.match(diagnostic, /Mancano le dipendenze\. Conferma l’installazione con npm ci\./u);
    assert.match(diagnostic, /Serve una scelta esplicita\./u);
    assert.equal(child.exitCode, 1, 'Non-TTY dependency installation must be refused');
    assert.equal(child.signalCode, null);
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
    console.log(JSON.stringify({ type: 'source-first-qualified', ...metadata(), pid: child.pid, noNodeModules: true,
      dependencyConfirmationReached: true, expectedNonTtyRefusal: true, launcherExit: child.exitCode }));
  } finally {
    clearTimeout(timer);
    for (const line of diagnostic.split(/\r?\n/u)) {
      if (line.startsWith('[launcher-identity-query] ')) console.log(line);
    }
    if (closed) fs.rmSync(fixture, { recursive: true, force: true });
    else { child.unref(); child.stderr.unref(); throw new Error(`Source-first fixture retained without terminal proof: ${fixture}`); }
  }
}

function verifyShadow() {
  const shadow = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-bootstrap-shadow-~'));
  const cwd = process.cwd();
  const saved = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR'].map(key => [key, process.env[key]]));
  try {
    fs.writeFileSync(path.join(shadow, 'taskkill.exe'), 'synthetic non-executable shadow');
    process.chdir(shadow); process.env.PATH = shadow; process.env.Path = shadow;
    process.env.SystemRoot = shadow; process.env.WINDIR = shadow;
    const command = initializeWindowsSystemCommand();
    assert.notEqual(path.dirname(command).toLowerCase(), shadow.toLowerCase());
    console.log(JSON.stringify({ type: 'bootstrap-shadow-verified', ...metadata(), taskkill: command }));
  } finally {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(shadow, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.platform, 'win32'); assert.match(process.version, /^v24\./u); assertNativeHost();
    const command = process.argv[2];
    if (command === 'build') await build();
    else if (command === 'verify') console.log(JSON.stringify({ type: 'bootstrap-verified', ...metadata(), taskkill: initializeWindowsSystemCommand() }));
    else if (command === 'verify-shadow') verifyShadow();
    else if (command === 'source-first') await sourceFirst();
    else throw new Error('Use build, verify, verify-shadow or source-first (development/CI only).');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
