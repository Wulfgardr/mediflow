import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { collectAdditionalInventorySelections } from './additional-inventory-selection.mjs';

const resolver = new URL('./windows-system-command.mjs', import.meta.url).href;
const binding = new URL('./windows-launcher-bootstrap/index.mjs', import.meta.url).href;
const driver = code => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
};

test('Windows native-source resolver rejects invalid paths and caches only a canonical positive before stop', t => {
  t.diagnostic(driver(`
    import assert from 'node:assert/strict';import fs from 'node:fs';import {registerHooks} from 'node:module';
    const directory=String.raw\`D:\\Windows Local\\Systèm32\`,candidate=directory+String.fromCharCode(92)+'taskkill.exe';
    const nativeStat=fs.lstatSync,nativeReal=fs.realpathSync.native;
    let scenario,reads=0,calls=0;
    globalThis.systemDirectory=()=>{calls++;if(scenario==='api-error')throw new Error('NATIVE_API_FAILURE');return scenario==='empty'?'':scenario==='relative'?'Windows':scenario==='unc'?'\\\\server\\share':scenario==='device'?'\\\\?\\C:\\Windows':directory;};
    process.env.SystemRoot='C:\\Users\\synthetic\\Windows';process.env.WINDIR=process.env.SystemRoot;
    process.env.Path='C:\\Users\\synthetic';process.env.PATH='C:\\Users\\synthetic';
    process.report.getReport=()=>assert.fail('Diagnostic report used as bootstrap authority');
    fs.lstatSync=(file,...args)=>{
      if(file!==directory&&file!==candidate)return nativeStat(file,...args);reads++;
      if(scenario==='stat-error'||(scenario==='missing'&&file===candidate))throw new Error('STAT_FAILURE');
      return {isDirectory:()=>file===directory||scenario==='non-file',isFile:()=>file===candidate&&scenario!=='non-file',isSymbolicLink:()=>scenario==='link'&&file===candidate||scenario==='directory-link'&&file===directory};
    };
    fs.realpathSync.native=(file,...args)=>{
      if(file!==directory&&file!==candidate)return nativeReal(file,...args);reads++;
      if(scenario==='realpath-error')throw new Error('REALPATH_FAILURE');
      if(scenario==='escape'&&file===candidate)return 'C:'+String.fromCharCode(92)+'Users'+String.fromCharCode(92)+'taskkill.exe';
      return file===directory?directory.toUpperCase():candidate;
    };
    registerHooks({load(url,context,next){if(url===${JSON.stringify(binding)})return {format:'module',shortCircuit:true,source:'export const loadSystemDirectoryBinding = () => ({getSystemDirectory:globalThis.systemDirectory});'};return next(url,context);}});
    Object.defineProperty(process,'platform',{value:'win32'});
    const cases=['api-error','empty','relative','unc','device','stat-error','missing','non-file','link','directory-link','realpath-error','escape','valid'];
    for(const [index,value] of cases.entries()) {
      scenario=value;const source=await import(${JSON.stringify(resolver)}+'?case='+index);
      assert.throws(()=>source.windowsTaskkillCommand(),error=>error.code==='MEDIFLOW_OWNED_STOP_UNCONFIRMED');
      const before=calls;
      if(value==='valid') {
        assert.equal(source.initializeWindowsSystemCommand(),candidate);
        const consumed=reads;scenario='api-error';
        assert.equal(source.initializeWindowsSystemCommand(),candidate);assert.equal(source.windowsTaskkillCommand(),candidate);
        assert.equal(reads,consumed,'Stop must not perform discovery');assert.equal(calls,before+1);
      } else {
        assert.throws(()=>source.initializeWindowsSystemCommand(),error=>error.code==='MEDIFLOW_OWNED_STOP_UNCONFIRMED',value);
        assert.throws(()=>source.windowsTaskkillCommand(),error=>error.code==='MEDIFLOW_OWNED_STOP_UNCONFIRMED',value+' cached a failure');
      }
    }
    console.log(JSON.stringify({simulatedWindows:true,nativeSourceSimulated:true,cases,reportCalled:false,sourceCalls:calls}));
  `));
});

test('Windows bootstrap artifacts require source identity, digest, architecture and exact native export before admission', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-bootstrap-artifact-~')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  const scripts = path.join(directory, 'scripts'), pack = path.join(scripts, 'windows-launcher-bootstrap');
  fs.mkdirSync(path.join(pack, 'prebuilds/win32-x64'), { recursive: true });
  for (const file of ['index.mjs', 'system-directory.c', 'build.ps1']) fs.copyFileSync(new URL('./windows-launcher-bootstrap/' + file, import.meta.url), path.join(pack, file));
  fs.copyFileSync(new URL('./prepare-windows-launcher-bootstrap.mjs', import.meta.url), path.join(scripts, 'prepare-windows-launcher-bootstrap.mjs'));
  const bytes = Buffer.alloc(128); bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68);
  const artifact = path.join(pack, 'prebuilds/win32-x64/system-directory.node');
  fs.writeFileSync(artifact, bytes);
  const manifest = { schemaVersion: 1, platform: 'win32', arch: 'x64', napiVersion: 1, binary: 'system-directory.node', bytes: bytes.length, sha256: sha(bytes),
    sourceSha256: sha(fs.readFileSync(path.join(pack, 'system-directory.c'))), recipeSha256: sha(fs.readFileSync(path.join(pack, 'build.ps1'))),
    builderSha256: sha(fs.readFileSync(path.join(scripts, 'prepare-windows-launcher-bootstrap.mjs'))), dependencies: ['kernel32.dll', 'node.exe'] };
  fs.writeFileSync(path.join(pack, 'prebuilds/win32-x64/manifest.json'), JSON.stringify(manifest));
  t.diagnostic(driver(`
    import assert from 'node:assert/strict';import fs from 'node:fs';import module from 'node:module';
    const artifact=${JSON.stringify(artifact)},manifestFile=${JSON.stringify(path.join(pack, 'prebuilds/win32-x64/manifest.json'))};
    const original=JSON.parse(fs.readFileSync(manifestFile));let loads=0;
    const requireNative=module.createRequire;
    module.createRequire=url=>url===${JSON.stringify(pathToFileURL(path.join(pack, 'index.mjs')).href)}?file=>{
      assert.equal(file,artifact);loads++;return {getSystemDirectory:()=>String.raw\`C:\\Windows\\System32\`};
    }:requireNative(url);module.syncBuiltinESMExports();
    const {loadSystemDirectoryBinding}=await import(${JSON.stringify(pathToFileURL(path.join(pack, 'index.mjs')).href)});
    Object.defineProperty(process,'platform',{value:'win32'});Object.defineProperty(process,'arch',{value:'x64',configurable:true});
    assert.equal(typeof loadSystemDirectoryBinding().getSystemDirectory,'function');assert.equal(loads,1);
    for(const [field,value] of [['sha256','0'.repeat(64)],['arch','arm64'],['sourceSha256','0'.repeat(64)],['recipeSha256','0'.repeat(64)],['builderSha256','0'.repeat(64)],['dependencies',['dbghelp.dll','node.exe']]]) {
      fs.writeFileSync(manifestFile,JSON.stringify({...original,[field]:value}));assert.throws(loadSystemDirectoryBinding,undefined,field);assert.equal(loads,1);
    }
    fs.writeFileSync(manifestFile,JSON.stringify(original));
    for(const arch of ['arm64','ia32']) {Object.defineProperty(process,'arch',{value:arch});assert.throws(loadSystemDirectoryBinding);assert.equal(loads,1);}
    Object.defineProperty(process,'arch',{value:'x64'});fs.unlinkSync(artifact);assert.throws(loadSystemDirectoryBinding);assert.equal(loads,1);
    console.log(JSON.stringify({artifactBytesSynthetic:true,nativeLoadStubbed:true,loads,invalidArtifactsNotLoaded:true}));
  `));
});

test('Windows launcher bootstrap precedes claim and stays outside the native-free portable staging closure', () => {
  const text = fs.readFileSync(new URL('./mediflow.mjs', import.meta.url), 'utf8');
  const main = text.slice(text.indexOf('export async function main'));
  assert.ok(main.indexOf('initializeWindowsSystemCommand();') < main.indexOf('claimLauncher('));
  const stop = text.slice(text.indexOf('export async function stopOwnedChild'), text.indexOf('export function installDesktopEntry'));
  assert.equal(stop.includes('initializeWindowsSystemCommand'), false);
  assert.equal(stop.includes('getReport'), false);
  assert.match(stop, /spawnSync\(windowsCommand, \['\/pid', String\(child.pid\), '\/T', '\/F'\]/u);
  const native = fs.readFileSync(new URL('./windows-launcher-bootstrap/system-directory.c', import.meta.url), 'utf8');
  assert.match(native, /GetSystemDirectoryW\(buffer, capacity\)/u);
  assert.match(native, /napi_create_string_utf16/u);
  assert.doesNotMatch(native, /SymInitialize|GetEnvironmentVariable|uv_|#include <(?:node|v8)\.h>/u);
  const stage = fs.readFileSync(new URL('./stage-headless-runtime.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(stage, /windows-system-command|windows-launcher-bootstrap/u);
  assert.match(stage, /\.node/u);
});

test('Windows bootstrap CI selection requires the real source-first consumer and initialization', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-bootstrap-selection-~')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.mkdirSync(path.join(directory, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'scripts/additional-test-selection.mjs'), '');
  const consumer = fs.readFileSync(new URL('./prepare-windows-launcher-bootstrap.mjs', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/cross-platform.yml', import.meta.url), 'utf8');
  const file = path.join(directory, 'scripts/prepare-windows-launcher-bootstrap.mjs');
  const ci = path.join(directory, '.github/workflows/cross-platform.yml');
  fs.writeFileSync(file, consumer); fs.writeFileSync(ci, workflow);
  const selected = () => collectAdditionalInventorySelections(directory)['ci:windows-bootstrap'];
  assert.deepEqual(selected().errors, []);
  assert.deepEqual(selected().files, ['scripts/prepare-windows-launcher-bootstrap.mjs']);
  for (const fragment of ["import { initializeWindowsSystemCommand } from './windows-system-command.mjs';", '  initializeWindowsSystemCommand();', "else if (command === 'source-first') await sourceFirst();"]) {
    fs.writeFileSync(file, consumer.replace(fragment, '// Removed real consumer binding'));
    assert.ok(selected().errors.length, fragment);
  }
  fs.writeFileSync(file, consumer);
  fs.writeFileSync(ci, workflow.replace('run: node scripts/prepare-windows-launcher-bootstrap.mjs source-first', 'run: echo source-first'));
  assert.ok(selected().errors.length);
});

test('Windows bootstrap source digests survive real checkouts with different local EOL settings', t => {
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-bootstrap-eol-~')));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const seed = path.join(fixture, 'seed'); fs.mkdirSync(seed);
  const config = path.join(fixture, 'empty-git-config'); fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config };
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, env, timeout: 5000 });
    assert.equal(result.status, 0, result.stdout?.toString() + result.stderr?.toString());
    return result.stdout;
  };
  const files = ['scripts/windows-launcher-bootstrap/system-directory.c', 'scripts/windows-launcher-bootstrap/build.ps1', 'scripts/prepare-windows-launcher-bootstrap.mjs'];
  git(seed, 'init', '--quiet');
  for (const file of ['.gitattributes', ...files]) {
    const target = path.join(seed, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(new URL('../' + file, import.meta.url), target);
  }
  git(seed, '-c', 'core.autocrlf=false', 'add', '.');
  git(seed, '-c', 'user.name=Synthetic EOL test', '-c', 'user.email=synthetic@example.invalid', 'commit', '--quiet', '-m', 'Synthetic bootstrap source');
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  for (const [autocrlf, eol] of [['true', 'crlf'], ['false', 'crlf'], ['input', 'lf']]) {
    const checkout = path.join(fixture, autocrlf);
    git(fixture, 'clone', '--quiet', '--no-local', '--no-checkout', seed, checkout);
    git(checkout, '-c', `core.autocrlf=${autocrlf}`, '-c', `core.eol=${eol}`, 'checkout', '--quiet', '--detach', 'HEAD');
    for (const file of files) {
      const blob = git(checkout, 'show', 'HEAD:' + file), bytes = fs.readFileSync(path.join(checkout, file));
      t.diagnostic(JSON.stringify({ syntheticCheckout: true, autocrlf, eol, file, gitBlobSha256: sha(blob), checkoutSha256: sha(bytes), crlf: bytes.includes(Buffer.from('\r\n')) }));
      assert.deepEqual(bytes, blob, `Checkout byte drift with core.autocrlf=${autocrlf}, core.eol=${eol}: ${file}`);
      assert.equal(bytes.includes(Buffer.from('\r\n')), false);
    }
  }
});
