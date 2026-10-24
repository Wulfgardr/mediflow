#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeWindowsSystemCommand, windowsProcessCreationTimeTicks } from './windows-system-command.mjs';

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
    const manifest = { schemaVersion: 2, exports: ['getProcessCreationTimeTicks', 'getSystemDirectory'], platform: 'win32', arch, napiVersion: 1, binary: 'system-directory.node',
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

function legacyOracle(pid, field = 'StartTime.ToUniversalTime().Ticks') {
  const command = path.win32.join(path.win32.dirname(initializeWindowsSystemCommand()), 'WindowsPowerShell/v1.0/powershell.exe');
  const start = process.hrtime.bigint();
  const result = spawnSync(command, ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; (Get-Process -Id ${pid}).${field}.ToString()`],
  { encoding: 'utf8', timeout: 30000, windowsHide: true });
  console.log(JSON.stringify({ type: 'bootstrap-legacy-oracle', productProcess: false, pid, field,
    elapsedMs: Number(process.hrtime.bigint() - start) / 1e6, timeoutMs: 30000,
    status: result.status, signal: result.signal, error: result.error?.code ?? null }));
  assert.ok(!result.error && result.status === 0, 'Legacy oracle unavailable; compatibility is not demonstrated');
  const value = result.stdout.trim();
  assert.match(value, /^[0-9]+$/u);
  return value;
}

async function verifyNativeIdentity() {
  const taskkill = initializeWindowsSystemCommand();
  const {loadSystemDirectoryBinding} = await import('./windows-launcher-bootstrap/index.mjs');
  const nativeTicks = loadSystemDirectoryBinding().getProcessCreationTimeTicks;
  for(const input of [undefined,null,true,'1',0,-1,1.5,NaN,Infinity,0x100000000,1n,process.pid + 0.5,process.pid + 0x100000000,process.pid - 0x100000000]) assert.throws(() => nativeTicks(input));
  assert.throws(() => nativeTicks());assert.throws(() => nativeTicks(process.pid,process.pid));
  const own = windowsProcessCreationTimeTicks(process.pid);
  assert.equal(windowsProcessCreationTimeTicks(process.pid), own);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-native-identity-~'));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {initializeWindowsSystemCommand,windowsProcessCreationTimeTicks} from ${JSON.stringify(new URL('./windows-system-command.mjs', import.meta.url).href)};
    initializeWindowsSystemCommand();
    process.on('message', frame => {
      if(frame?.type === 'close') process.exit(0);
      if(frame?.type === 'query') {
        for(let index=0;index<4096;index++) windowsProcessCreationTimeTicks(index % 2 ? process.pid : process.ppid);
        process.send({type:'queried'}, error => {if(error)throw error;});
      }
    });
    process.send({type:'ready'}, error => {if(error)throw error;});
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env,
    MEDIFLOW_DATA_DIR: path.join(fixture, 'archive'), MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' } });
  let stderr = '', closed = false, failure;
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-1024); });
  const terminal = Promise.all([new Promise(resolve => child.once('exit', (code, signal) => {
    console.log(JSON.stringify({type:'native-identity-child-exit',pid:child.pid,code,signal}));resolve();
  })), new Promise(resolve => child.stderr.once('close', () => {
    console.log(JSON.stringify({type:'native-identity-child-stderr-close',pid:child.pid}));resolve();
  }))]).then(() => {closed = true;});
  const wait = promise => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native identity child observation expired')), 10000);
    promise.then(resolve,reject).finally(() => clearTimeout(timer));
  });
  const message = () => new Promise((resolve,reject) => {
    const done = value => { dispose(); resolve(value); };
    const exited = () => { dispose(); reject(new Error('Native identity child exited before response: ' + stderr)); };
    const failed = error => { dispose(); reject(error); };
    const dispose = () => {child.off('message',done);child.off('exit',exited);child.off('error',failed);};
    child.once('message',done);child.once('exit',exited);child.once('error',failed);
  });
  const send = frame => new Promise((resolve,reject) => child.send(frame,error => error ? reject(error) : resolve()));
  console.log(JSON.stringify({type:'native-identity-child-created',pid:child.pid,parentPid:process.pid,node:process.version,execPath:process.execPath,arch:process.arch,uv:process.versions.uv}));
  try {
    assert.equal((await wait(message())).type,'ready');
    const other = windowsProcessCreationTimeTicks(child.pid);
    assert.equal(windowsProcessCreationTimeTicks(child.pid),other);assert.notEqual(own,other);
    const legacyValues = new Map();
    for(const [pid,native] of [[process.pid,own],[child.pid,other]]) {
      const legacy = legacyOracle(pid);
      assert.equal(native,legacy,'Native identity differs from the legacy string');
      assert.equal(sha(native),sha(legacy));legacyValues.set(pid,legacy);
    }
    const lock = path.join(fixture,'legacy-lock');fs.mkdirSync(lock);
    const receipt = path.join(lock,'instance.json');
    const original = JSON.stringify({pid:child.pid,processIdentity:sha(legacyValues.get(child.pid)),checkoutPath:fixture});fs.writeFileSync(receipt,original);
    const {claimLauncher} = await import('./mediflow.mjs');
    assert.throws(() => claimLauncher(lock,{checkoutPath:fixture}),/già in corso/u);
    assert.equal(fs.readFileSync(receipt,'utf8'),original,'Live legacy receipt changed');
    const before = legacyOracle(child.pid,'HandleCount');
    const response = wait(message());await send({type:'query'});assert.equal((await response).type,'queried');
    const after = legacyOracle(child.pid,'HandleCount');
    assert.equal(after,before,'Native identity queries leaked process handles');
    console.log(JSON.stringify({type:'bootstrap-identity-verified',...metadata(),taskkill,ownPid:process.pid,childPid:child.pid,
      exactLegacyTicks:true,exactLegacySha:true,legacyReceiptPreserved:true,queries:4096,handlesBefore:before,handlesAfter:after}));
  } catch(error) { failure = error; }
  finally {
    try {
      if(!closed) {await send({type:'close'});await wait(terminal);}
      assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);
    } catch(error) {
      failure = failure ? new AggregateError([failure,error],failure.message+'; '+error.message) : error;
      if(child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      try {await wait(terminal);} catch(drain) {failure = new AggregateError([failure,drain],failure.message+'; '+drain.message);}
    }
    if(closed) fs.rmSync(fixture,{recursive:true,force:true});
    else {child.unref();child.stderr.unref();child.channel?.unref();console.error('Native identity fixture retained without terminal proof: '+fixture);}
  }
  if(failure) throw failure;
}

async function sourceFirst() {
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false, 'Source-first qualification must run before npm ci, without node_modules');
  const identitySource = fs.readFileSync(path.join(root, 'scripts/mediflow.mjs'),'utf8').split('function launcherProcessIdentity(pid) {')[1]?.split('function privateLauncherDirectory')[0];
  assert.equal(typeof identitySource,'string');
  assert.doesNotMatch(identitySource,/powershell|SystemRoot|WINDIR/iu);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'scripts/windows-system-command.mjs'),'utf8'),/process\.env|powershell|spawnSync/iu);
  initializeWindowsSystemCommand();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-source-first-~'));
  const data = path.join(fixture, 'archive'); fs.mkdirSync(data);
  const guard = path.join(fixture,'source-first-guard.mjs');
  fs.writeFileSync(guard, `
    import cp from 'node:child_process';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';
    import ${JSON.stringify(new URL('./windows-launcher-bootstrap/observe-command.mjs', import.meta.url).href)};
    let denied = 0;
    for(const method of ['spawn','spawnSync','execFile','execFileSync']) {
      const original = cp[method];
      cp[method] = (command,...args) => {
        if(typeof command === 'string' && /^(?:powershell|pwsh)(?:\\.exe)?$/iu.test(path.win32.basename(command))) {
          denied++;throw new Error('SOURCE_FIRST_POWERSHELL_DENIED');
        }
        return original(command,...args);
      };
    }
    syncBuiltinESMExports();
    process.once('exit', () => process.stderr.write('SOURCE_FIRST_NATIVE_ONLY '+JSON.stringify({powerShellCalls:denied})+'\\n'));
  `);
  const child = spawn(process.execPath, ['--import', pathToFileURL(guard).href,
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
    assert.match(diagnostic, /SOURCE_FIRST_NATIVE_ONLY \{"powerShellCalls":0\}/u);
    assert.equal(child.exitCode, 1, 'Non-TTY dependency installation must be refused');
    assert.equal(child.signalCode, null);
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
    console.log(JSON.stringify({ type: 'source-first-qualified', ...metadata(), pid: child.pid, noNodeModules: true,
      dependencyConfirmationReached: true, expectedNonTtyRefusal: true, launcherExit: child.exitCode }));
  } finally {
    clearTimeout(timer);
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
    else if (command === 'verify') {
      console.log(JSON.stringify({ type: 'bootstrap-verified', ...metadata(), taskkill: initializeWindowsSystemCommand() }));
      await verifyNativeIdentity();
    }
    else if (command === 'verify-shadow') verifyShadow();
    else if (command === 'source-first') await sourceFirst();
    else throw new Error('Use build, verify, verify-shadow or source-first (development/CI only).');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
