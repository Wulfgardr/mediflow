import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
    registerHooks({load(url,context,next){if(url===${JSON.stringify(binding)})return {format:'module',shortCircuit:true,source:'export const loadSystemDirectoryBinding = () => ({getSystemDirectory:globalThis.systemDirectory,getProcessCreationTimeTicks:()=>"638000000000000001"});'};return next(url,context);}});
    Object.defineProperty(process,'platform',{value:'win32'});
    const cases=['api-error','empty','relative','unc','device','stat-error','missing','non-file','link','directory-link','realpath-error','escape','valid'];
    for(const [index,value] of cases.entries()) {
      scenario=value;const source=await import(${JSON.stringify(resolver)}+'?case='+index);
      assert.throws(()=>source.windowsTaskkillCommand(),error=>error.code==='MEDIFLOW_OWNED_STOP_UNCONFIRMED');
      assert.throws(()=>source.windowsProcessCreationTimeTicks(process.pid),/bootstrap/u);
      const before=calls;
      if(value==='valid') {
        assert.equal(source.initializeWindowsSystemCommand(),candidate);
        const consumed=reads;scenario='api-error';
        assert.equal(source.initializeWindowsSystemCommand(),candidate);assert.equal(source.windowsTaskkillCommand(),candidate);
        assert.equal(reads,consumed,'Stop must not perform discovery');assert.equal(calls,before+1);
        assert.equal(source.windowsProcessCreationTimeTicks(process.pid),'638000000000000001');
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
  const manifest = { schemaVersion: 2, exports: ['getProcessCreationTimeTicks','getSystemDirectory'], platform: 'win32', arch: 'x64', napiVersion: 1, binary: 'system-directory.node', bytes: bytes.length, sha256: sha(bytes),
    sourceSha256: sha(fs.readFileSync(path.join(pack, 'system-directory.c'))), recipeSha256: sha(fs.readFileSync(path.join(pack, 'build.ps1'))),
    builderSha256: sha(fs.readFileSync(path.join(scripts, 'prepare-windows-launcher-bootstrap.mjs'))), dependencies: ['kernel32.dll', 'node.exe'] };
  fs.writeFileSync(path.join(pack, 'prebuilds/win32-x64/manifest.json'), JSON.stringify(manifest));
  t.diagnostic(driver(`
    import assert from 'node:assert/strict';import fs from 'node:fs';import module from 'node:module';
    const artifact=${JSON.stringify(artifact)},manifestFile=${JSON.stringify(path.join(pack, 'prebuilds/win32-x64/manifest.json'))};
    const original=JSON.parse(fs.readFileSync(manifestFile));let loads=0,shape='valid';
    const requireNative=module.createRequire;
    module.createRequire=url=>url===${JSON.stringify(pathToFileURL(path.join(pack, 'index.mjs')).href)}?file=>{
      assert.equal(file,artifact);loads++;if(shape==='missing')return {getSystemDirectory:()=>''};if(shape==='type')return {getProcessCreationTimeTicks:'invalid',getSystemDirectory:()=>''};if(shape==='extra')return {getProcessCreationTimeTicks:()=>'',getSystemDirectory:()=>'',extra:()=>''};const exported={getProcessCreationTimeTicks:()=>"638000000000000001",getSystemDirectory:()=>String.raw\`C:\\Windows\\System32\`};if(shape==='hidden')Object.defineProperty(exported,'extra',{value:()=>''});if(shape==='symbol')exported[Symbol('extra')]=()=>'';return exported;
    }:requireNative(url);module.syncBuiltinESMExports();
    const {loadSystemDirectoryBinding}=await import(${JSON.stringify(pathToFileURL(path.join(pack, 'index.mjs')).href)});
    Object.defineProperty(process,'platform',{value:'win32'});Object.defineProperty(process,'arch',{value:'x64',configurable:true});
    assert.equal(typeof loadSystemDirectoryBinding().getSystemDirectory,'function');assert.equal(loads,1);
    for(const [field,value] of [['schemaVersion',1],['exports',['getProcessCreationTimeTicks,getSystemDirectory']],['exports',['getSystemDirectory']],['exports',['getSystemDirectory','getProcessCreationTimeTicks']],['exports',['getProcessCreationTimeTicks','getSystemDirectory','extra']],['sha256','0'.repeat(64)],['arch','arm64'],['sourceSha256','0'.repeat(64)],['recipeSha256','0'.repeat(64)],['builderSha256','0'.repeat(64)],['dependencies',['dbghelp.dll','node.exe']]]) {
      fs.writeFileSync(manifestFile,JSON.stringify({...original,[field]:value}));assert.throws(loadSystemDirectoryBinding,undefined,field);assert.equal(loads,1);
    }
    fs.writeFileSync(manifestFile,JSON.stringify(original));
    for(const arch of ['arm64','ia32']) {Object.defineProperty(process,'arch',{value:arch});assert.throws(loadSystemDirectoryBinding);assert.equal(loads,1);}
    Object.defineProperty(process,'arch',{value:'x64'});
    for(const value of ['missing','type','extra','hidden','symbol']){shape=value;assert.throws(loadSystemDirectoryBinding,undefined,value);}
    const beforeMissing=loads;fs.unlinkSync(artifact);assert.throws(loadSystemDirectoryBinding);assert.equal(loads,beforeMissing);
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
  for (const fragment of ["import { initializeWindowsSystemCommand, windowsProcessCreationTimeTicks } from './windows-system-command.mjs';", "  initializeWindowsSystemCommand();\n  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-source-first-~'));", "else if (command === 'source-first') await sourceFirst();"]) {
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

test('source-first tooling enforces native-only startup and retains the original gate failure', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-source-observer-~')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scripts = path.join(directory, 'scripts'); fs.mkdirSync(scripts);
  const preparer = path.join(scripts, 'prepare-windows-launcher-bootstrap.mjs');
  fs.copyFileSync(new URL('./prepare-windows-launcher-bootstrap.mjs', import.meta.url), preparer);
  fs.writeFileSync(path.join(scripts, 'windows-system-command.mjs'), '');
  fs.copyFileSync(new URL('./mediflow.mjs', import.meta.url),path.join(scripts,'mediflow.mjs'));
  fs.mkdirSync(path.join(scripts,'windows-launcher-bootstrap'));
  fs.copyFileSync(new URL('./windows-launcher-bootstrap/observe-command.mjs',import.meta.url),path.join(scripts,'windows-launcher-bootstrap/observe-command.mjs'));
  fs.writeFileSync(path.join(scripts,'windows-system-command.mjs'),'export const windowsTaskkillCommand=()=>"synthetic-taskkill";');
  t.diagnostic(driver(`
    import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
    import cp from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';import {EventEmitter} from 'node:events';import {registerHooks,syncBuiltinESMExports} from 'node:module';
    const preparer=${JSON.stringify(preparer)},root=${JSON.stringify(directory)},url=${JSON.stringify(pathToFileURL(preparer).href)};
    const calls=[],logs=[],errors=[];let diagnostic,initializations=0;
    globalThis.initializeSourceFirst=()=>{initializations++;return 'synthetic admitted command';};
    registerHooks({load(url,context,next){if(url===${JSON.stringify(pathToFileURL(path.join(scripts, 'windows-system-command.mjs')).href)})return {format:'module',shortCircuit:true,source:'export const initializeWindowsSystemCommand=globalThis.initializeSourceFirst;export const windowsProcessCreationTimeTicks=()=>"638000000000000001";export const windowsTaskkillCommand=()=>"synthetic-taskkill";'};return next(url,context);}});
    const spawn=cp.spawn,machine=os.machine,log=console.log,error=console.error;
    cp.spawn=(...args)=>{
      fs.copyFileSync(fileURLToPath(args[1][1]),path.join(root,'guard.mjs'));
      calls.push(args);const child=new EventEmitter();child.stderr=new EventEmitter();child.pid=424200;child.exitCode=null;child.signalCode=null;
      setImmediate(()=>{child.stderr.emit('data',Buffer.from(diagnostic));child.exitCode=1;child.emit('exit',1,null);child.stderr.emit('close');});
      return child;
    };
    os.machine=()=> 'arm64';syncBuiltinESMExports();Object.defineProperty(process,'platform',{value:'win32'});Object.defineProperty(process,'arch',{value:'arm64'});
    console.log=text=>logs.push(text);console.error=text=>errors.push(text);
    process.argv=[process.execPath,preparer,'source-first'];
    const receipt='SOURCE_FIRST_NATIVE_ONLY '+JSON.stringify({powerShellCalls:0});
    try {
      for(const outcome of ['failure','ordinary']) {
        const before=logs.length,errorCount=errors.length;process.exitCode=undefined;
        diagnostic=receipt+'\\n'+(outcome==='failure'?'Impossibile verificare l’identità del processo lanciatore.\\n':'Avvio: http://127.0.0.1:3333\\nMancano le dipendenze. Conferma l’installazione con npm ci.\\nServe una scelta esplicita.\\n');
        await import(url+'?case='+outcome);
        const [command,args,options]=calls.at(-1);assert.equal(command,process.execPath);
        const guard=args[1];assert.match(guard,/%7E/u);assert.equal(args[0],'--import');
        assert.deepEqual(args.slice(2),[path.join(root,'scripts/mediflow.mjs'),'--scelta','web','--senza-browser']);
        const fixture=path.dirname(options.env.MEDIFLOW_DATA_DIR);
        assert.equal(path.resolve(options.cwd),root);assert.deepEqual(options.stdio,['ignore','ignore','pipe']);
        assert.deepEqual(Object.keys(options).sort(),['cwd','env','stdio']);
        const expectedEnv={...process.env,MEDIFLOW_DATA_DIR:path.join(fixture,'archive'),MEDIFLOW_E2E_DISABLE_LEGACY_COPY:'1',APPDATA:path.join(fixture,'profile'),LOCALAPPDATA:path.join(fixture,'local')};
        assert.ok(JSON.stringify(options.env)===JSON.stringify(expectedEnv),'Source-first environment changed');
        assert.equal(fs.existsSync(fixture),false,'Terminal synthetic fixture retained');
        assert.equal(fs.existsSync(path.join(root,'node_modules')),false);
        assert.equal(logs.slice(before).some(text=>text.includes('[launcher-identity-query]')),false);
        if(outcome==='failure') {
          assert.equal(process.exitCode,1,'Receipt converted the original gate failure into success');
          assert.equal(errors.length,errorCount+1);assert.match(errors.at(-1),/Avvio/u);assert.match(errors.at(-1),/Impossibile verificare/u);
          assert.equal(logs.slice(before).some(text=>text.includes('source-first-qualified')),false);
        } else {
          assert.equal(process.exitCode,undefined);assert.equal(errors.length,errorCount);
          assert.ok(logs.slice(before).some(text=>text.includes('source-first-qualified')));
        }
      }
      assert.equal(calls.length,2);assert.equal(initializations,2);
      const nativeSync=cp.spawnSync,response={status:0};let passed=0;
      cp.spawnSync=()=>{passed++;return response;};syncBuiltinESMExports();
      await import(pathToFileURL(path.join(root,'guard.mjs')).href);
      for(const method of ['spawn','spawnSync','execFile','execFileSync'])assert.throws(()=>cp[method]('PowerShell.EXE',[]),/SOURCE_FIRST_POWERSHELL_DENIED/u);
      assert.equal(passed,0);assert.equal(cp.spawnSync('synthetic-command',[]),response);assert.equal(passed,1);
      cp.spawnSync=nativeSync;syncBuiltinESMExports();
    } finally {console.log=log;console.error=error;cp.spawn=spawn;os.machine=machine;syncBuiltinESMExports();process.exitCode=undefined;}
    console.log(JSON.stringify({launcherChildrenSynthetic:true,realPowerShellStarted:false,nativeOnlyMarkerRequired:true,failureRetained:true,ordinaryGateRetained:true,fixturesRemoved:true}));
  `));
});


test('Windows native identity validates PID and preserves decimal precision without a partial bootstrap', t => {
  t.diagnostic(driver(`
    import assert from 'node:assert/strict';import fs from 'node:fs';import {registerHooks} from 'node:module';
    let value='638000000000000001',calls=[];
    globalThis.nativeTicks=pid=>{calls.push(pid);if(value instanceof Error)throw value;return value;};
    globalThis.nativeDirectory='D:'+String.fromCharCode(92)+'Windows'+String.fromCharCode(92)+'System32';
    registerHooks({load(url,context,next){if(url===${JSON.stringify(binding)})return {format:'module',shortCircuit:true,source:'export const loadSystemDirectoryBinding=()=>({getSystemDirectory:()=>globalThis.nativeDirectory,getProcessCreationTimeTicks:globalThis.nativeTicks});'};return next(url,context);}});
    const stat=fs.lstatSync,real=fs.realpathSync.native;let invalid=true;
    fs.lstatSync=file=>{if(!file.startsWith('D:'))return stat(file);return {isDirectory:()=>!file.endsWith('.exe'),isFile:()=>file.endsWith('.exe')&&!invalid,isSymbolicLink:()=>false};};
    fs.realpathSync.native=file=>file.startsWith('D:')?file:real(file);
    Object.defineProperty(process,'platform',{value:'win32'});
    const source=await import(${JSON.stringify(resolver)});
    assert.throws(()=>source.windowsProcessCreationTimeTicks(process.pid),/bootstrap/u);
    assert.throws(source.initializeWindowsSystemCommand);assert.throws(()=>source.windowsProcessCreationTimeTicks(process.pid),/bootstrap/u);assert.deepEqual(calls,[]);
    invalid=false;source.initializeWindowsSystemCommand();
    for(const pid of [undefined,null,true,'1',0,-1,1.5,NaN,Infinity,0x100000000,1n]) assert.throws(()=>source.windowsProcessCreationTimeTicks(pid));
    assert.deepEqual(calls,[]);
    for(const pid of [1,process.pid,0xffffffff])assert.equal(source.windowsProcessCreationTimeTicks(pid),'638000000000000001');
    assert.deepEqual(calls,[1,process.pid,0xffffffff]);
    for(const bad of [638000000000000001,'','0','01',' 638000000000000001','638000000000000001\\n','3155378976000000000','-1',new Error('NATIVE_DENIED')]) {
      value=bad;assert.throws(()=>source.windowsProcessCreationTimeTicks(process.pid));
    }
    console.log(JSON.stringify({nativeCallsSimulated:true,pidRangeChecked:true,exactDecimalPreserved:true,noPartialBootstrap:true}));
  `));
});

test('native process identity source confines handle lifetime and calendar arithmetic to the R38 contract', () => {
  const text=fs.readFileSync(new URL('./windows-launcher-bootstrap/system-directory.c',import.meta.url),'utf8');
  const conversion=text.slice(text.indexOf('static BOOL creation_ticks'),text.indexOf('static napi_value get_process_creation_time_ticks'));
  assert.match(conversion,/FileTimeToSystemTime\(creation, &utc\)/u);
  assert.match(conversion,/year \/ 4 - year \/ 100 \+ year \/ 400/u);
  assert.match(conversion,/raw % 10000/u);
  assert.match(conversion,/2650467743999999999ULL/u);
  assert.doesNotMatch(conversion,/double|float|sprintf|Number|504911232/u);
  const query=text.slice(text.indexOf('static napi_value get_process_creation_time_ticks'),text.indexOf('static napi_value init'));
  assert.match(query,/OpenProcess\(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid\)/u);
  assert.match(query,/GetProcessTimes\(process, &creation, &exit_time, &kernel_time, &user_time\)/u);
  assert.equal(query.split('CloseHandle(process)').length-1,1);
  assert.match(query,/!closed \|\| status != napi_ok/u);
  assert.match(query,/\(double\)pid != input/u);
  assert.match(query,/napi_create_string_latin1/u);
  assert.doesNotMatch(query,/PROCESS_ALL_ACCESS|SYNCHRONIZE|GetCurrentProcess|WaitFor|Sleep|sprintf/u);
  const launcher=fs.readFileSync(new URL('./mediflow.mjs',import.meta.url),'utf8');
  const identity=launcher.slice(launcher.indexOf('function launcherProcessIdentity'),launcher.indexOf('function privateLauncherDirectory'));
  assert.match(identity,/value = windowsProcessCreationTimeTicks\(pid\)/u);
  assert.doesNotMatch(identity,/powershell|SystemRoot|WINDIR/iu);
});

test('Windows identity queries own and other live owners and preserves V2 and legacy locks on uncertainty', t => {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mf-native-claim-~')));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  t.diagnostic(driver(`
    import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
    import cp from 'node:child_process';import {once} from 'node:events';import {registerHooks,syncBuiltinESMExports} from 'node:module';
    const root=${JSON.stringify(directory)},queries=[],closedEvents=[];
    const child=cp.spawn(process.execPath,['-e',"process.send('ready');process.on('message',()=>process.exit(0));"],{stdio:['ignore','ignore','pipe','ipc']});
    const terminal=Promise.all([once(child,'exit').then(([code,signal])=>closedEvents.push({type:'exit',code,signal})),once(child.stderr,'close').then(()=>closedEvents.push({type:'stderr-close'}))]);
    await once(child,'message');let mode='normal';
    const ticks=pid=>String(638000000000000001n+BigInt(pid));
    globalThis.nativeTicks=pid=>{queries.push(pid);assert.ok([process.pid,child.pid].includes(pid));if(mode==='own-error'&&pid===process.pid||mode==='owner-error'&&pid===child.pid)throw new Error('NATIVE_QUERY_UNAVAILABLE');return mode==='mismatch'&&pid===child.pid?String(BigInt(ticks(pid))+1n):ticks(pid);};
    globalThis.nativeDirectory='D:'+String.fromCharCode(92)+'Windows'+String.fromCharCode(92)+'System32';
    registerHooks({load(url,context,next){if(url===${JSON.stringify(binding)})return {format:'module',shortCircuit:true,source:'export const loadSystemDirectoryBinding=()=>({getSystemDirectory:()=>globalThis.nativeDirectory,getProcessCreationTimeTicks:globalThis.nativeTicks});'};return next(url,context);}});
    const stat=fs.lstatSync,real=fs.realpathSync.native;
    fs.lstatSync=(file,...args)=>typeof file==='string'&&file.startsWith('D:')?{isDirectory:()=>!file.endsWith('.exe'),isFile:()=>file.endsWith('.exe'),isSymbolicLink:()=>false}:stat(file,...args);
    fs.realpathSync.native=(file,...args)=>typeof file==='string'&&file.startsWith('D:')?file:real(file,...args);
    cp.spawnSync=()=>assert.fail('Windows product spawned PowerShell or another identity subprocess');syncBuiltinESMExports();
    Object.defineProperty(process,'platform',{value:'win32'});
    const {claimLauncher,releaseLauncher}=await import(${JSON.stringify(new URL('./mediflow.mjs',import.meta.url).href)});
    const {initializeWindowsSystemCommand}=await import(${JSON.stringify(resolver)});
    const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
    const absent=path.join(root,'absent');
    try {
      assert.throws(()=>claimLauncher(absent,{checkoutPath:root}),/identità/u);assert.equal(fs.existsSync(absent),false);assert.deepEqual(queries,[]);
      initializeWindowsSystemCommand();mode='own-error';
      assert.throws(()=>claimLauncher(absent,{checkoutPath:root}),/identità/u);assert.equal(fs.existsSync(absent),false);assert.equal(fs.existsSync(absent+'.recovery'),false);
      mode='normal';const live=claimLauncher(path.join(root,'v2'),{checkoutPath:root});
      assert.equal(live.receipt.processIdentity,sha(ticks(process.pid)),'Decimal identity was rounded or reformatted');
      const owner=path.join(path.dirname(live.receiptFile),'owner.json'),saved=[fs.readFileSync(owner),fs.readFileSync(live.receiptFile)];
      assert.throws(()=>claimLauncher(live.directory,{checkoutPath:root}),/già in corso/u);
      assert.deepEqual(fs.readFileSync(owner),saved[0]);assert.deepEqual(fs.readFileSync(live.receiptFile),saved[1]);releaseLauncher(live);
      for(const value of ['normal','owner-error','mismatch']) {
        mode=value;const lock=path.join(root,value);fs.mkdirSync(lock);const file=path.join(lock,'instance.json');
        const bytes=JSON.stringify({pid:child.pid,processIdentity:sha(ticks(child.pid)),checkoutPath:root});fs.writeFileSync(file,bytes);
        if(value==='mismatch') {const next=claimLauncher(lock,{checkoutPath:root});assert.equal(next.claimed,true);releaseLauncher(next);}
        else {assert.throws(()=>claimLauncher(lock,{checkoutPath:root}),/già in corso/u,'Live owner was reclaimed on '+value);assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(child.exitCode,null);}
      }
      assert.ok(queries.includes(child.pid),'Other-PID owner query not performed');
    } finally {
      await new Promise((resolve,reject)=>child.send('close',error=>error?reject(error):resolve()));
      await terminal;
    }
    assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);assert.equal(closedEvents.length,2);
    console.log(JSON.stringify({simulatedWin32Binding:true,realOwnedChild:child.pid,ownPid:process.pid,queries,closedEvents,legacyProtected:true,v2Protected:true,mismatchRecovered:true,noPowerShell:true}));
  `));
});

test('native verify gate separates legacy compatibility from timeout and detects leaked handles', t => {
  for(const outcome of ['success','mismatch','leak','oracle-timeout']) t.diagnostic(driver(`
    import assert from 'node:assert/strict';import cp from 'node:child_process';import os from 'node:os';import fs from 'node:fs';
    import path from 'node:path';import {EventEmitter} from 'node:events';import {registerHooks,syncBuiltinESMExports} from 'node:module';
    const taskkill='D:'+String.fromCharCode(92)+'Windows'+String.fromCharCode(92)+'System32'+String.fromCharCode(92)+'taskkill.exe';
    const ticks=pid=>String(638000000000000001n+BigInt(pid));globalThis.nativeGateTicks=ticks;
    globalThis.nativeGateApi=(...args)=>{if(args.length!==1||!Number.isInteger(args[0])||args[0]<1||args[0]>0xffffffff)throw new Error('SYNTHETIC_NATIVE_INPUT_DENIED');return ticks(args[0]);};
    registerHooks({load(url,context,next){if(url===${JSON.stringify(binding)})return {format:'module',shortCircuit:true,source:'export const loadSystemDirectoryBinding=()=>({getProcessCreationTimeTicks:globalThis.nativeGateApi});'};if(url===${JSON.stringify(resolver)})return {format:'module',shortCircuit:true,source:'export const initializeWindowsSystemCommand=()=>'+JSON.stringify(taskkill)+';export const windowsProcessCreationTimeTicks=globalThis.nativeGateTicks;export const windowsTaskkillCommand=()=>'+JSON.stringify(taskkill)+';'};return next(url,context);}});
    const logs=[],errors=[],frames=[],created=[],fixtures=[],native=cp.spawnSync;let counts=0;
    cp.spawn=(_command,_args,_options)=>{
      fixtures.push(path.dirname(_options.env.MEDIFLOW_DATA_DIR));
      const child=new EventEmitter();child.stderr=new EventEmitter();Object.assign(child,{pid:424201,exitCode:null,signalCode:null});
      child.send=(frame,callback)=>{frames.push(frame.type);callback(null);setImmediate(()=>{
        if(frame.type==='query')child.emit('message',{type:'queried'});
        else {child.exitCode=0;child.emit('exit',0,null);child.stderr.emit('close');}
      });};
      setImmediate(()=>child.emit('message',{type:'ready'}));created.push(child);return child;
    };
    cp.spawnSync=(command,args,options)=>{
      assert.equal(command,taskkill.replace('taskkill.exe','WindowsPowerShell'+String.fromCharCode(92)+'v1.0'+String.fromCharCode(92)+'powershell.exe'));
      assert.deepEqual(args.slice(0,3),['-NoProfile','-NonInteractive','-Command']);assert.equal(options.timeout,30000);assert.equal(options.encoding,'utf8');assert.equal(options.windowsHide,true);
      if(${JSON.stringify(outcome)}==='oracle-timeout')return {status:null,signal:'SIGTERM',error:{code:'ETIMEDOUT'},stdout:'',stderr:''};
      if(args[3].endsWith('.HandleCount.ToString()'))return {status:0,stdout:String(++counts===2&&${JSON.stringify(outcome)}==='leak'?4196:100)};
      const pid=Number(args[3].match(/Get-Process -Id ([0-9]+)/u)[1]);assert.ok([process.pid,424201].includes(pid));
      assert.equal(args[3],"$ErrorActionPreference='Stop'; (Get-Process -Id "+pid+").StartTime.ToUniversalTime().Ticks.ToString()");
      return {status:0,stdout:${JSON.stringify(outcome)}==='mismatch'?String(BigInt(ticks(pid))+1n):ticks(pid)};
    };
    syncBuiltinESMExports();os.machine=()=> 'arm64';Object.defineProperty(process,'platform',{value:'win32'});Object.defineProperty(process,'arch',{value:'arm64'});
    process.kill=(pid,signal)=>{assert.equal(pid,424201);assert.equal(signal,0);return true;};
    console.log=text=>logs.push(text);console.error=text=>errors.push(text);
    process.argv=[process.execPath,${JSON.stringify(fileURLToPath(new URL('./prepare-windows-launcher-bootstrap.mjs',import.meta.url)))},'verify'];
    await import(${JSON.stringify(new URL('./prepare-windows-launcher-bootstrap.mjs',import.meta.url).href)});
    if(${JSON.stringify(outcome)}==='success') {assert.equal(process.exitCode,undefined);assert.ok(logs.some(text=>text.includes('bootstrap-identity-verified')));assert.deepEqual(frames,['query','close']);}
    else {
      assert.equal(process.exitCode,1);assert.equal(errors.length,1);
      assert.match(errors[0],${JSON.stringify(outcome)}==='mismatch'?/differs from the legacy string/u:${JSON.stringify(outcome)}==='leak'?/leaked process handles/u:/oracle unavailable/u);
      assert.equal(logs.some(text=>text.includes('bootstrap-identity-verified')),false);
    }
    assert.equal(frames.at(-1),'close');assert.equal(created[0].exitCode,0);
    const parent=logs.map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(line=>line?.type==='native-identity-child-created');
    assert.ok(parent);for(const fixture of fixtures)assert.equal(fs.existsSync(fixture),false);
    cp.spawnSync=native;process.exitCode=undefined;process.stdout.write(JSON.stringify({outcome:${JSON.stringify(outcome)},nativeAndChildSimulated:true,frames,compatibilityDistinctFromTimeout:true})+'\\n');
  `));
});
