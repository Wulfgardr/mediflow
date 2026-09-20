/* @Codex — structural readback tests + exact private fence with real local FS.
 * Run with the repository's run-strip-types.mjs --test loader, or the delivered
 * verification-only loader. Synthetic RPC/owner/clock for fence tests; NO native
 * qualification, account access, source-pin override or production test hook.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { assertMacConfigReadback, MAC_READBACK_SOURCE, MAC_CONFIG_SOURCE } from './execution-mac-config.ts';
import { EXECUTION_CONFIG, EXECUTION_SUBSTRATE } from './execution-sandbox.ts';
import { expectedExecutionConfig, assertExecutionConfig, EXECUTION_PROTOCOL_PROVENANCE } from './execution-login.ts';
import { ExecutionError } from './execution-contract.ts';
import { readMacQualification, takeMacQualifiedHost, prepareMacProductQualification, MacQualificationFailure } from './execution-mac-qualification.ts';
import { createProductionExecutionPlatform, createReviewedMacProductPlatform } from './execution-platform.ts';
import { createStdioExecutionTransport } from './execution-transport.ts';
const here = dirname(fileURLToPath(import.meta.url));
const captured = fs.readFileSync(join(here, 'fixtures/mac-readback-v01534.json'), 'utf8');
const sample = () => JSON.parse(captured);
const cwd = '/SYNTHETIC_RUN_ROOT/work';
const boundary = error => error instanceof ExecutionError && error.code === 'unqualified_boundary';
const altered = v => typeof v === 'boolean' ? !v : typeof v === 'number' ? v + 1 : typeof v === 'string' ? v + '-changed' : 'unexpected';
const canonical = v => v && typeof v === 'object' ? Array.isArray(v) ? `[${v.map(canonical)}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const version = v => 'sha256:' + createHash('sha256').update(canonical(v)).digest('hex');
function leaves(v, prefix = []) {
    return Object.entries(v).flatMap(([k, x]) => x && typeof x === 'object' && !Array.isArray(x) ? leaves(x, [...prefix, k]) : [[...prefix, k]]);
}
function set(v, path, value) { const key = path.at(-1); for (const k of path.slice(0, -1)) v = v[k]; v[key] = value; }
function get(v, path) { return path.reduce((v, k) => v[k], v); }
function rejectMutation(name, change) {
    test(name, () => { const r = sample(); change(r); assert.throws(() => assertMacConfigReadback(r, cwd), boundary); });
}

test('unmodified sanitized current wire is structurally accepted WITHOUT returning authority or mutating data', () => {
    const r = sample(), before = JSON.stringify(r);
    assert.equal(assertMacConfigReadback(r, cwd), undefined); assert.equal(JSON.stringify(r), before);
    assert.equal(Object.keys(r.config).length, 99); assert.equal(Object.keys(r.layers[0].config).length, 20);
    assert.equal(Object.keys(r.origins).length, 58); assert.equal(leaves(r.layers[0].config).length, 58);
    assert.deepEqual(r.layers[0].config, expectedExecutionConfig());
    assert.equal(version(r.layers[0].config), r.layers[0].version);
    assert.equal(version(r.layers[1].config), r.layers[1].version);
});
test('key order is not authority: recursively reordered exact JSON is accepted', () => {
    const reverse = v => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])) : v;
    assert.doesNotThrow(() => assertMacConfigReadback(reverse(sample()), cwd));
});
test('absence of optional empty system layer has only structural meaning', () => {
    const r = sample(); r.layers.pop(); assert.equal(assertMacConfigReadback(r, cwd), undefined);
});
test('source/runtime binding remains separate from historical C1 and unqualified full build', () => {
    assert.equal(MAC_READBACK_SOURCE.commit, MAC_CONFIG_SOURCE.commit);
    assert.equal(MAC_READBACK_SOURCE.binarySha256, EXECUTION_SUBSTRATE.codexSha256);
    assert.notEqual(MAC_READBACK_SOURCE.binarySha256, EXECUTION_PROTOCOL_PROVENANCE.binarySha256);
    assert.equal(MAC_CONFIG_SOURCE.binaryBuildBinding, 'unqualified');
    assert.ok(Object.isFrozen(MAC_READBACK_SOURCE));
    assert.throws(() => { MAC_READBACK_SOURCE.binarySha256 = 'forged'; }, TypeError);
});

for (const path of leaves(sample().layers[0].config)) rejectMutation(`raw configured leaf altered: ${path.join('.')}`, r => {
    const raw = r.layers[0].config; set(raw, path, altered(get(raw,path)));
    // Even recomputing ALL version strings cannot bless altered input.
    const replacement = version(raw); r.layers[0].version = replacement;
    for (const origin of Object.values(r.origins)) origin.version = replacement;
});
for (const path of leaves(sample().config)) rejectMutation(`effective value/default altered: ${path.join('.')}`, r => set(r.config, path, altered(get(r.config,path))));
for (const key of Object.keys(sample().config)) rejectMutation(`effective root missing: ${key}`, r => { delete r.config[key]; });
for (const key of Object.keys(sample().origins)) {
    rejectMutation(`origin missing: ${key}`, r => { delete r.origins[key]; });
    rejectMutation(`origin version stale: ${key}`, r => { r.origins[key].version = 'sha256:' + '0'.repeat(64); });
}
for (const path of [[], ['config'], ['origins'], ['layers', 0], ['layers', 0, 'name'], ['layers', 0, 'config'], ['layers', 1], ['layers', 1, 'config'], ['config', 'tools'], ['config','apps','_default'], ['config','features'], ['config','agents'], ['config','history'], ['config','shell_environment_policy']]) {
    for (const value of [null, {}, false]) rejectMutation(`additional key denied at ${path.join('.') || 'envelope'} (${JSON.stringify(value)})`, r => { get(r,path).extra_authority = value; });
}
for (const name of ['model_providers','mcp_servers','profiles','plugins','marketplaces']) rejectMutation(`nonempty authority map denied: ${name}`, r=> { r.config[name].synthetic = {}; });
for (const type of ['project', 'sessionFlags', 'mdm', 'enterpriseManaged', 'packagedDefaults', 'legacyManagedConfigTomlFromFile', 'legacyManagedConfigTomlFromMdm']) {
    rejectMutation(`unexpected authority layer denied: ${type}`, r=> { r.layers[1].name = { type }; });
    rejectMutation(`foreign origin authority denied: ${type}`, r=> { r.origins['approval_policy'].name = { type }; });
}
for (const [name,change] of [
    ['missing config', r=>{ delete r.config; }], ['missing origins', r=>{ delete r.origins; }], ['missing layers', r=>{ delete r.layers; }],
    ['layers null',r=>{r.layers=null;}], ['no layers',r=>{r.layers=[];}], ['empty system only',r=>{r.layers.shift();}],
    ['duplicated user layer',r=>{r.layers[1]=structuredClone(r.layers[0]);}], ['third layer',r=>{r.layers.push(structuredClone(r.layers[1]));}],
    ['reversed precedence',r=>{r.layers.reverse();}], ['raw root missing',r=>{delete r.layers[0].config.tools;}],
    ['raw tools falsely reinserted in typed output',r=>{r.config.tools=structuredClone(r.layers[0].config.tools);}],
    ['update_plan omitted from raw',r=>{delete r.layers[0].config.tools.update_plan;}],
    ['request_user_input omitted from raw',r=>{delete r.layers[0].config.tools.experimental_request_user_input;}],
    ['update_plan origin omitted',r=>{delete r.origins['tools.update_plan.enabled'];}],
    ['raw tool controls missing and typed web_search null',r=>{delete r.layers[0].config.tools;}],
    ['user profile',r=>{r.layers[0].name.profile='synthetic';}], ['missing user profile field',r=>{delete r.layers[0].name.profile;}],
    ['origin profile',r=>{r.origins['approval_policy'].name.profile='synthetic';}],
    ['foreign user path',r=>{r.layers[0].name.file='/SYNTHETIC_OTHER/codex/config.toml';}],
    ['foreign origin path',r=>{r.origins['approval_policy'].name.file='/SYNTHETIC_OTHER/codex/config.toml';}],
    ['path alias',r=>{r.layers[0].name.file='/SYNTHETIC_RUN_ROOT/codex/../codex/config.toml';}],
    ['private system alias',r=>{r.layers[1].name.file='/private/etc/codex/config.toml';}],
    ['system requirements instead of config',r=>{r.layers[1].name.file='/etc/codex/requirements.toml';}],
    ['system profile key even null',r=>{r.layers[1].name.profile=null;}],
    ['user version wrong',r=>{r.layers[0].version='sha256:'+'0'.repeat(64);}],
    ['system version wrong',r=>{r.layers[1].version='sha256:'+'0'.repeat(64);}],
    ['bare version digest',r=>{r.layers[0].version=r.layers[0].version.slice(7);}],
    ['layer disabled',r=>{r.layers[0].disabledReason='synthetic';}],
    ['disabledReason null is not absence',r=>{r.layers[1].disabledReason=null;}],
    ['additional origin',r=>{r.origins['profile']=structuredClone(r.origins.approval_policy);}],
    ['multi_agent origin raw spelling is not the observed enabled leaf',r=>{r.origins['features.multi_agent_v2']=r.origins['features.multi_agent_v2.enabled'];delete r.origins['features.multi_agent_v2.enabled'];}],
    ['both multi_agent origin spellings',r=>{r.origins['features.multi_agent_v2']=structuredClone(r.origins['features.multi_agent_v2.enabled']);}],
    ['generic feature origin renaming prohibited',r=>{r.origins['features.code_mode.enabled']=r.origins['features.code_mode'];delete r.origins['features.code_mode'];}],
    ['origin has its own config',r=>{r.origins.approval_policy.config={};}],
    ['typed profile active',r=>{r.config.profile='synthetic';}],
    ['null source instead of name',r=>{r.layers[0].name=null;}],
    ['raw v2 object is not fixed boolean input',r=>{r.layers[0].config.features.multi_agent_v2={enabled:false};}],
]) rejectMutation(name,change);
for (const badCwd of ['', 'work','/work','/SYNTHETIC_RUN_ROOT/not-work','/SYNTHETIC_RUN_ROOT/work/','/SYNTHETIC_RUN_ROOT/./work','/SYNTHETIC_RUN_ROOT/x/../work','/SYNTHETIC_OTHER/work','/SYNTHETIC_RUN_ROOT/\nwork']) test(`invalid/unbound cwd denied: ${JSON.stringify(badCwd)}`,()=>assert.throws(()=>assertMacConfigReadback(sample(),badCwd),boundary));
test('null, array, class, inherited/accessor/symbol stand-ins are not JSON observations', () => {
    for(const value of [null,[],{},Object.assign(new (class Readback{})(), sample()), Object.create(sample())]) assert.throws(()=>assertMacConfigReadback(value,cwd),boundary);
    for(const field of ['config','origins','layers']) { let invoked=0; const r=sample(); Object.defineProperty(r,field,{get(){invoked++;return sample()[field];},enumerable:true});assert.throws(()=>assertMacConfigReadback(r,cwd),boundary);assert.equal(invoked,0); }
    const r=sample();r.config[Symbol('authority')]=true;assert.throws(()=>assertMacConfigReadback(r,cwd),boundary);
});
test('legacy login matcher remains closed; no normalized fake response is substituted', () => {
    assert.throws(()=>assertExecutionConfig(sample()),boundary);
    assert.throws(()=>assertExecutionConfig({config:sample().config,origins:{}}),boundary);
});

// EXACT private function extracts. No modified runtime module or success issuer.
const qualification = fs.readFileSync(join(here,'execution-mac-qualification.ts'),'utf8');
function slice(start,end) { const a=qualification.indexOf(start), b=qualification.indexOf(end,a); assert.ok(a>=0&&b>a,`${start} missing`);return qualification.slice(a,b); }
const identitySource = slice('function directoryIdentity(', '/** rust-v0.153.4');
const guardSource = slice('    function assertReadbackCurrent()', "    try {\n        if (process.platform !== 'darwin'");
const adminSource = slice('function administrativeFilesAbsent()', '/** Parent entries');
const guardJs=stripTypeScriptTypes(identitySource+'\n'+guardSource,{mode:'transform'});
const adminJs=stripTypeScriptTypes(adminSource);
const paths=['runtime/codex','runtime/mac-owner','runtime/mac-owner.c','runtime/profile.sb','runtime/profile-probe.sb','runtime/public-ca.pem','runtime/probe-ports','codex/config.toml'];
async function fenceFixture(run) {
    const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'mfmac-readback-test-')));fs.chmodSync(root,0o700);
    for(const d of ['runtime','codex','work','tmp','config','cache','data']){fs.mkdirSync(join(root,d),{mode:0o700});fs.chmodSync(join(root,d),0o700);}
    for(const p of paths){fs.writeFileSync(join(root,p),p==='codex/config.toml'?EXECUTION_CONFIG:'synthetic-owned-file',{flag:'wx',mode:0o400});fs.chmodSync(join(root,p),0o400);}
    const state={live:true,adminAbsent:true,revoked:false,expired:false,checks:0,calls:0};
    const response=JSON.parse(captured.replaceAll('/SYNTHETIC_RUN_ROOT',root));
    const context={...fs,join,process,ExecutionError,EXECUTION_CONFIG,assertMacConfigReadback,root,intentionalDrain:false,
        immutable:new Map(),directories:new Map(),
        check(){state.checks++;if(state.revoked||state.expired)throw new ExecutionError('unqualified_boundary');},
        administrativeFilesAbsent(){return state.adminAbsent;},serverOwner:{live:()=>state.live},
        raw:{async request(method,params){state.calls++;assert.equal(method,'config/read');assert.equal(JSON.stringify(params),JSON.stringify({includeLayers:true,cwd:join(root,'work')}));return response;}}};
    const api=runInNewContext(guardJs+'\n({ directoryIdentity, identity, assertReadbackCurrent, readCurrentMacConfig });',context);
    for(const p of [root,...['runtime','codex','work','tmp','config','cache','data'].map(d=>join(root,d))])context.directories.set(p,api.directoryIdentity(p));
    for(const p of paths)context.immutable.set(join(root,p),api.identity(join(root,p)));
    try{return await run({root,state,context,api,response});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('real local filesystem fence returns the same synthetic response, uses explicit cwd and layers',()=>fenceFixture(async({api,response,state})=>{
    assert.equal(await api.readCurrentMacConfig(),response);assert.equal(state.calls,1);assert.ok(state.checks>=6);
}));
for(const [name,change] of [
    ['owner not live',f=>{f.state.live=false;}],['revoked',f=>{f.state.revoked=true;}],['expired',f=>{f.state.expired=true;}],
    ['intentional drain',f=>{f.context.intentionalDrain=true;}],['admin guard false although layer empty',f=>{f.state.adminAbsent=false;}],
    ['admin guard throws',f=>{f.context.administrativeFilesAbsent=()=>{throw new ExecutionError('unqualified_boundary');};}],
    ['config writable',f=>fs.chmodSync(join(f.root,'codex/config.toml'),0o600)],
    ['config identical bytes but changed inode',f=>{const p=join(f.root,'codex/config.toml');fs.renameSync(p,p+'.old');fs.writeFileSync(p,EXECUTION_CONFIG,{mode:0o400,flag:'wx'});}],
    ['config symlink',f=>{const p=join(f.root,'codex/config.toml');fs.renameSync(p,p+'.old');fs.symlinkSync(p+'.old',p);}],
    ['config hardlink',f=>fs.linkSync(join(f.root,'codex/config.toml'),join(f.root,'work/link'))],
    ['cwd symlink alias',f=>{const p=join(f.root,'work');fs.renameSync(p,p+'-actual');fs.symlinkSync(p+'-actual',p);}],
    ['cwd replaced',f=>{const p=join(f.root,'work');fs.renameSync(p,p+'-old');fs.mkdirSync(p,0o700);}],
    ['root directory permissions changed',f=>fs.chmodSync(f.root,0o755)],
    ['binary changed',f=>fs.chmodSync(join(f.root,'runtime/codex'),0o500)],
    ['empty immutable set',f=>f.context.immutable.clear()],['empty directory set',f=>f.context.directories.clear()],
]) test(`private pre-RPC fence rejects ${name}`,()=>fenceFixture(async f=>{change(f);await assert.rejects(f.api.readCurrentMacConfig(),boundary);assert.equal(f.state.calls,0);}));
for(const [name,change] of [
    ['late revocation',f=>{f.state.revoked=true;}],['late expiration',f=>{f.state.expired=true;}],['dead owner',f=>{f.state.live=false;}],
    ['admin policy appears',f=>{f.state.adminAbsent=false;}],['drain begins',f=>{f.context.intentionalDrain=true;}],
    ['owner object swapped',f=>{f.context.serverOwner={live:()=>true};}],['transport object swapped',f=>{f.context.raw={request:async()=>f.response};}],
    ['config bytes changed',f=>{const p=join(f.root,'codex/config.toml');fs.chmodSync(p,0o600);fs.writeFileSync(p,EXECUTION_CONFIG+'\n');fs.chmodSync(p,0o400);}],
    ['config contents restored but ctime changed',f=>{const p=join(f.root,'codex/config.toml');fs.chmodSync(p,0o600);fs.writeFileSync(p,'changed');fs.writeFileSync(p,EXECUTION_CONFIG);fs.chmodSync(p,0o400);}],
    ['raw restrictive tool removed',f=>{delete f.response.layers[0].config.tools.update_plan;}],
]) test(`private post-RPC fence rejects ${name}`,()=>fenceFixture(async f=>{
    f.context.raw.request=async()=>{f.state.calls++;await Promise.resolve();change(f);return f.response;};
    await assert.rejects(f.api.readCurrentMacConfig(),boundary);assert.equal(f.state.calls,1);
}));
test('last fence catches a change during semantic checking; no response delivered',()=>fenceFixture(async f=>{
    f.context.assertMacConfigReadback=(raw,cwd)=>{assertMacConfigReadback(raw,cwd);f.state.expired=true;};
    await assert.rejects(f.api.readCurrentMacConfig(),boundary);
}));
test('same metadata cannot conceal changed config bytes: explicit content reread is required',()=>fenceFixture(async f=>{
    const original=f.context.readFileSync;f.context.readFileSync=(p,...args)=>p===join(f.root,'codex/config.toml')?'synthetic-changed':original(p,...args);
    await assert.rejects(f.api.readCurrentMacConfig(),boundary);assert.equal(f.state.calls,0);
}));
test('second identity after content read detects a concurrent replacement',()=>fenceFixture(async f=>{
    const original=f.context.readFileSync;f.context.readFileSync=(p,...args)=>{const value=original(p,...args);if(p===join(f.root,'codex/config.toml')){fs.renameSync(p,p+'.old');fs.writeFileSync(p,EXECUTION_CONFIG,{mode:0o400,flag:'wx'});}return value;};
    await assert.rejects(f.api.readCurrentMacConfig(),boundary);assert.equal(f.state.calls,0);
}));
test('existing independent administrative guard requires ENOENT for EACH exact path, not empty config',()=>{
    const paths=[];
    const guard=runInNewContext(`(${adminJs})`,{lstatSync(p){paths.push(p);throw Object.assign(new Error(),{code:'ENOENT'});}});
    assert.equal(guard(),true);assert.deepEqual(paths,['/etc/codex/requirements.toml','/etc/codex/config.toml','/etc/codex/managed_config.toml']);
    for(const bad of paths)for(const code of ['EXISTS','EACCES','EPERM','EIO','ENOTDIR']){
        const fn=runInNewContext(`(${adminJs})`,{lstatSync(p){if(p===bad&&code==='EXISTS')return {};throw Object.assign(new Error(),{code:p===bad?code:'ENOENT'});}});assert.equal(fn(),false,`${bad}:${code}`);
    }
});
test('integration captures immutable config at creation and all identities BEFORE startup; never after readback',()=>{
    const capture=qualification.indexOf("immutable.set(join(root, 'codex', 'config.toml')"),launch=qualification.indexOf("serverOwner = launchMacCustodian(root, nonce, 'server'"),readback=qualification.indexOf('const actualConfig = await readCurrentMacConfig()');
    assert.ok(capture>0&&capture<launch&&launch<readback);
    assert.ok(qualification.lastIndexOf('immutable.set(')<launch);
    assert.match(qualification,/previous !== undefined && previous !== stamp/);
    assert.match(qualification,/configSha = macDigest\(JSON.stringify\(actualConfig\)\)/);
    assert.match(qualification,/readbackSource: MAC_READBACK_SOURCE/);
    assert.match(qualification,/layered_source_projection_observed/);
    assert.doesNotMatch(qualification,/layered_source_projection_current/);
    assert.doesNotMatch(qualification,/export (?:async )?function (?:assertReadbackCurrent|readCurrentMacConfig|administrativeFilesAbsent)/);
    assert.ok(qualification.indexOf("phase = 'ready'")>readback);
});
test('raw structural match, copied receipt and successful caller callback do NOT manufacture a Mac authority',async()=>{
    let called=0;const authority={...sample(),currentEvidence(){called++;return {revision:'synthetic',isCurrent:()=>true};}};
    assertMacConfigReadback(authority.config?sample():authority,cwd);
    assert.equal(readMacQualification(authority,'/synthetic-not-used'),null);
    await assert.rejects(takeMacQualifiedHost(authority,'/synthetic-not-used',new AbortController().signal),boundary);
    const reviewed=createReviewedMacProductPlatform({qualification:authority,binaryPath:'/synthetic-not-used'});
    assert.notEqual(reviewed.snapshot().state,'qualified');await assert.rejects(reviewed.create(new AbortController().signal),boundary);
    const production=createProductionExecutionPlatform();assert.notEqual(production.snapshot().state,'qualified');await assert.rejects(production.create(new AbortController().signal),boundary);assert.equal(called,0);
});
test('actual Linux platform gate cannot issue even with plausible paths (NO Mac run)',{skip:process.platform==='darwin'},async()=>{
    await assert.rejects(prepareMacProductQualification({binaryPath:'/synthetic-not-used',nativeSourcePath:'/synthetic-not-used',schemaDirectory:'/synthetic-not-used',c1ReceiptPath:'/synthetic-not-used'}),e=>e instanceof MacQualificationFailure&&e.stage==='platform');
});
test('unexpected server tool/approval request remains denied by unchanged real transport',async()=>{
    const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:12345,exitCode:null,signalCode:null});
    const failures=[];const transport=createStdioExecutionTransport(child,{killGraceMs:20,groupDrainMs:20,
        terminate(){child.exitCode=0;child.emit('exit',0,null);},waitForOwnedGroupExit:async()=>true});
    transport.subscribe(()=>{},code=>failures.push(code));
    const pending=transport.request('config/read',{includeLayers:true,cwd});
    child.stdout.write(JSON.stringify({id:99,method:'item/tool/requestUserInput',params:{}})+'\n');
    await assert.rejects(pending,e=>e instanceof ExecutionError&&e.code==='tool_use_denied');
    assert.ok(failures.includes('tool_use_denied'));assert.equal(await transport.close(),true);
});
test('exact Darwin registry branches reject forged callbacks in an isolated empty registry (NOT Mac custody)',async()=>{
    const text=slice('export function readMacQualification(', 'async function within<');
    const js=stripTypeScriptTypes(text,{mode:'transform'}).replace(/^export /gmu,'');
    const api=runInNewContext(js+'\n({ readMacQualification, takeMacQualifiedHost });',{
        process:{platform:'darwin'},authorities:new WeakMap(),ExecutionError});
    let calls=0;const forged={currentEvidence(){calls++;throw new Error('must not invoke');}};
    assert.equal(api.readMacQualification(forged,'/synthetic'),null);
    await assert.rejects(api.takeMacQualifiedHost(forged,'/synthetic',new AbortController().signal),boundary);
    assert.equal(calls,0);
});
