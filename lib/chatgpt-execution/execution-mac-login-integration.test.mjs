/* @Codex — Full production-module unit tests through the private concrete-transport
 * association. Native/platform/stdio evidence is synthetic, NEVER Mac C2 proof.
 * node --experimental-vm-modules --import ./lib/chatgpt-execution/fixtures/mac-login-loader.mjs --test <this-file>
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {macFixture,deferred} from './fixtures/mac-login-harness.mjs';
import {EXECUTION_CONFIG} from './execution-sandbox.ts';
const denied=e=>['unqualified_boundary','revoked','invalid_state','invalid_request','process_exited','timeout','protocol_error'].includes(e.code);
const methods=f=>f.state.calls.map(c=>c.method);

test('prepared real module with realistic wire completes login using one process and original initialized observation',async t=>{
    const f=await macFixture(t),login=f.login();
    assert.deepEqual(methods(f),['initialize','config/read']);assert.equal(f.state.initialized,1);
    assert.equal(f.prepared.audit().phase,'borrowed');
    const challenge=await login.start();assert.equal(challenge.userCode,'FAKE-TEST');
    assert.deepEqual(methods(f),['initialize','config/read','config/read','account/read','account/login/start']);
    assert.equal(f.state.wrapperCalls,0,'wrapper must not supply login RPC authority');
    assert.equal(f.wrapperListeners.size,0,'notifications rebound to the concrete source');
    await assert.rejects(login.complete(),e=>e.code==='login_pending');
    f.notifyLogin();assert.equal(await login.complete(),'plus');assert.equal(await login.read(),'plus');
    assert.deepEqual(methods(f).slice(5),['config/read','account/read','account/read']);
    for(const c of f.state.calls.filter(x=>x.method==='config/read'))assert.deepEqual(c.params,{includeLayers:true,cwd:f.host.cwd});
    for(const c of f.state.calls.filter(x=>x.method==='account/read'))assert.deepEqual(c.params,{refreshToken:false});
    assert.equal(f.state.calls.some(c=>c.method==='turn/start'),false);
    assert.deepEqual(f.state.nativeLaunches,['probe','version','schemas','server']);
    assert.equal(f.prepared.audit().fullSourceBuildBinding,'unqualified');
    assert.equal(f.prepared.audit().omittedToolBinding,'source_resolver_and_immutable_input_not_direct_tool_observation');
});
test('production factory remains HELD with no account or provider work',async t=>{
    const f=await macFixture(t);const production=f.platform.createProductionExecutionPlatform();
    assert.equal(production.snapshot().state,'unqualified');
    await assert.rejects(production.create(new AbortController().signal),denied);
    assert.equal(methods(f).includes('account/login/start'),false);
});
test('same actual response is returned without rewriting the effective config',async t=>{
    const f=await macFixture(t);const actual=await f.host.transport.request('config/read',{includeLayers:true,cwd:f.host.cwd});
    assert.equal(actual,f.state.responses.at(-1).value);assert.equal(Object.keys(actual.config).length,99);
    assert.equal(Object.keys(actual.origins).length,58);assert.equal(actual.layers.length,2);
    assert.throws(()=>f.loginModule.assertExecutionConfig(actual),denied);
});
test('guard refuses login before consuming prepared initialize or requesting account',async t=>{
    const f=await macFixture(t);f.state.guardAllowed=false;
    await assert.rejects(f.login().start(),denied);assert.deepEqual(methods(f),['initialize','config/read']);
    f.state.guardAllowed=true;assert.ok(f.host.transport.takeInitializationObservation());
});
test('claim and bootstrap are separately one-use; replay never downgrades to legacy',async t=>{
    const f=await macFixture(t),raw=f.host.transport.takeInitializationObservation();
    assert.equal(f.qualifier.takeMacLoginTransport(raw,f.host.cwd),f.host.transport);
    assert.throws(()=>f.qualifier.takeMacLoginTransport(raw,f.host.cwd),denied);
    assert.throws(()=>f.host.transport.takeInitializationObservation(),denied);
    assert.equal(f.qualifier.takeMacLoginTransport(f.clone(raw),f.host.cwd),null);
});
for(const kind of ['clone','foreign-cwd','replay','close','revoke','expiry','native-death'])test(`bootstrap binding denies ${kind}`,async t=>{
    const f=await macFixture(t),actual=f.host.transport.takeInitializationObservation();
    if(kind==='clone') {assert.equal(f.qualifier.takeMacLoginTransport(f.clone(actual),f.host.cwd),null);return;}
    if(kind==='replay')f.qualifier.takeMacLoginTransport(actual,f.host.cwd);
    if(kind==='close')await f.host.close();
    if(kind==='revoke')f.abort.abort();
    if(kind==='expiry')f.state.clockOffset=300001;
    if(kind==='native-death')f.loseProcess();
    assert.throws(()=>f.qualifier.takeMacLoginTransport(actual,kind==='foreign-cwd'?'/synthetic-other/work':f.host.cwd),denied);
});
test('a structurally convincing callback is not invoked by the private lookup',async t=>{
    const f=await macFixture(t);let calls=0;const forged={get take(){calls++;return()=>f.host.transport;},get currentEvidence(){calls++;return()=>true;}};
    assert.equal(f.qualifier.takeMacLoginTransport(forged,f.host.cwd),null);assert.equal(calls,0);
    const fake=f.platform.createReviewedMacProductPlatform({binaryPath:f.prepared.binaryPath,qualification:forged});
    assert.notEqual(fake.snapshot().state,'qualified');await assert.rejects(fake.create(new AbortController().signal),denied);assert.equal(calls,0);
});
test('forged prepared observation plus realistic wire cannot select the Mac branch',async t=>{
    const f=await macFixture(t);let calls=0;
    const transport={takeInitializationObservation:()=>f.clone(f.state.responses[0].value),subscribe:()=>()=>{},
        request:async()=>{calls++;return f.clone(f.state.responses[1].value);},initialized(){throw Error('not allowed');}};
    await assert.rejects(f.login(transport).start(),denied);assert.equal(calls,1);
    assert.equal(methods(f).includes('account/login/start'),false);
});
test('transparent initialization wrapper cannot replace subsequent RPC or notifications',async t=>{
    const f=await macFixture(t);const wrapper=f.wrap();
    const login=f.login({...wrapper,request(){assert.fail('foreign RPC must not be called');}});
    await login.start();f.forgedNotice({loginId:'fixture-login',success:true,error:null});
    await assert.rejects(login.complete(),e=>e.code==='login_pending');f.notifyLogin();assert.equal(await login.complete(),'plus');
});
test('second initialize is rejected without a second raw request',async t=>{
    const f=await macFixture(t);const before=methods(f);await assert.rejects(f.host.transport.request('initialize',{}),denied);
    assert.throws(()=>f.host.transport.initialized(),denied);assert.deepEqual(methods(f),before);
});
for(const phase of ['start','complete'])for(const [name,change]of [
    ['origin missing',r=>{delete r.origins.approval_policy;}],
    ['origin foreign',r=>{r.origins.approval_policy.name.file='/synthetic-other/codex/config.toml';}],
    ['origin version',r=>{r.origins.approval_policy.version='sha256:'+'0'.repeat(64);}],
    ['unknown layer',r=>{r.layers[1].name.type='project';}],
    ['layers missing',r=>{delete r.layers;}],
    ['raw tool omitted',r=>{delete r.layers[0].config.tools.update_plan;}],
    ['effective drift',r=>{r.config.model_provider='other';}],
    ['facade',()=>({config:{},origins:{}})],
])test(`${phase}: authentic transport rejects ${name} before account continuation`,async t=>{
    const f=await macFixture(t),login=f.login();
    if(phase==='complete'){await login.start();f.notifyLogin();}
    const before=methods(f).filter(m=>m==='account/read').length;
    f.state.after=(method,value)=>{if(method==='config/read')return change(value);};
    await assert.rejects(login[phase](),denied);
    assert.equal(methods(f).filter(m=>m==='account/read').length,before);
    assert.equal(f.prepared.audit().phase,'revoked');
});
for(const phase of ['start','complete','read','cancel','logout'])for(const drift of ['config-inode','root-mode','admin','expiry','revoke','process'])test(`${phase}: ${drift} before RPC blocks dispatch`,async t=>{
    const f=await macFixture(t),login=f.login();
    if(phase!=='start'){await login.start();if(phase==='read'){f.notifyLogin();await login.complete();}if(phase==='complete')f.notifyLogin();}
    const before=methods(f).length;
    if(drift==='config-inode')f.replaceFile('codex/config.toml',EXECUTION_CONFIG);
    if(drift==='root-mode')fs.chmodSync(f.root,0o755);
    if(drift==='admin')f.state.adminAbsent=false;
    if(drift==='expiry')f.state.clockOffset=300001;
    if(drift==='revoke')f.abort.abort();
    if(drift==='process')f.loseProcess();
    await assert.rejects(phase==='logout'?f.host.transport.request('account/logout'):login[phase](),denied);
    assert.equal(methods(f).length,before);
});
for(const phase of ['start','complete','read','cancel','logout'])for(const drift of ['config-inode','admin','expiry','revoke','guard','dispose','process'])test(`${phase}: ${drift} during await rejects late result`,async t=>{
    const f=await macFixture(t),login=f.login();
    if(phase!=='start'){await login.start();if(phase==='read'){f.notifyLogin();await login.complete();}if(phase==='complete')f.notifyLogin();}
    const gate=deferred(),entered=deferred();let first=true;
    f.state.before=async()=>{if(first){first=false;entered.resolve();await gate.promise;}};
    const pending=phase==='logout'?f.host.transport.request('account/logout'):login[phase]();
    const rejected=assert.rejects(pending,denied);await entered.promise;
    if(drift==='config-inode')f.replaceFile('codex/config.toml',EXECUTION_CONFIG);
    if(drift==='admin')f.state.adminAbsent=false;
    if(drift==='expiry')f.state.clockOffset=300001;
    if(drift==='revoke')f.abort.abort();
    if(drift==='guard') {f.state.guardAllowed=false;if(phase==='logout')f.abort.abort();}
    if(drift==='dispose') {login.dispose();if(phase==='logout')f.abort.abort();}
    if(drift==='process')f.loseProcess();
    gate.resolve();await rejected;
});
for(const params of [{includeLayers:false},{includeLayers:true},{includeLayers:true,cwd:'/synthetic-other/work'},{includeLayers:true,cwd:null},{includeLayers:true,cwd:'OWNED',extra:null}])test(`exact prepared readback request rejects ${JSON.stringify(params)}`,async t=>{
    const f=await macFixture(t);const p={...params};if(p.cwd==='OWNED')p.cwd=f.host.cwd;
    const before=methods(f).length;await assert.rejects(f.host.transport.request('config/read',p),denied);assert.equal(methods(f).length,before);
});
test('request accessors are not called or used as readback authority',async t=>{
    const f=await macFixture(t);let invoked=0;const p={cwd:f.host.cwd,get includeLayers(){invoked++;return true;}};
    await assert.rejects(f.host.transport.request('config/read',p),denied);assert.equal(invoked,0);
});
test('matching early completion still requires fresh readback and same-process account',async t=>{
    const f=await macFixture(t),login=f.login();f.state.after=method=>{if(method==='account/login/start')f.notifyLogin();};
    await login.start();assert.equal(await login.complete(),'plus');assert.equal(methods(f).filter(m=>m==='config/read').length,3);
});
for(const variant of ['foreign','duplicate','failed','malformed','premature'])test(`completion ${variant} never produces an accepted plan`,async t=>{
    const f=await macFixture(t),login=f.login();
    if(variant==='premature'){f.notifyLogin();await assert.rejects(login.start(),denied);return;}
    await login.start();
    if(variant==='foreign')f.notifyLogin('other');
    if(variant==='duplicate'){f.notifyLogin();f.notifyLogin();}
    if(variant==='failed')f.notifyLogin('fixture-login',false);
    if(variant==='malformed')f.emit('account/login/completed',f.clone({loginId:'fixture-login',success:'yes'}));
    await assert.rejects(login.complete(),denied);assert.equal(f.state.failures.length,1);
});
test('account identity drift is rejected, no account switching',async t=>{
    const f=await macFixture(t),login=f.login();await login.start();f.notifyLogin();await login.complete();
    f.state.identity='different@example.invalid';await assert.rejects(login.read(),denied);
});
test('cancel, logout and close keep narrow existing RPCs and do not reacquire an initialization',async t=>{
    const f=await macFixture(t),login=f.login();await login.start();await login.cancel();
    f.notifyLogin();await login.complete();await f.host.transport.request('account/logout');
    const empty=await f.host.transport.request('account/read',{refreshToken:false});assert.equal(empty.account,null);
    login.dispose();const before=methods(f).length;await assert.rejects(login.read(),denied);assert.equal(methods(f).length,before);
    assert.equal(await f.host.close(),true);assert.equal(f.prepared.audit().cleanupComplete,true);
    assert.equal(f.prepared.audit().ownedTreeCeased,true);assert.equal(f.state.proxyClosed,true);
    await assert.rejects(f.host.transport.request('account/read',{}),denied);
    assert.equal(methods(f).filter(m=>m==='initialize').length,1);
});

test('preparation remains account-free and egress-closed until a one-use host transfer',async t=>{
    const f=await macFixture(t,{borrow:false});assert.equal(f.state.proxyActive,false);
    assert.deepEqual(methods(f),['initialize','config/read']);
    const observed=f.state.responses[0].value;
    assert.throws(()=>f.qualifier.takeMacLoginTransport(observed,join(f.root,'work')),denied);
    const owned=await f.borrow();assert.equal(f.state.proxyActive,true);
    await assert.rejects(f.borrow(),denied);
    assert.throws(()=>f.qualifier.takeMacLoginTransport(observed,owned.cwd),denied,'observation not yet taken');
    assert.equal(owned.transport.takeInitializationObservation(),observed);
    assert.equal(f.qualifier.takeMacLoginTransport(observed,owned.cwd),owned.transport);
});
test('same live host cannot start two logins from one observed initialization',async t=>{
    const f=await macFixture(t),first=f.login(),second=f.login();await first.start();
    await assert.rejects(second.start(),denied);await assert.rejects(first.start(),denied);
    assert.equal(methods(f).filter(m=>m==='account/login/start').length,1);
});
test('accepted optional absent empty system layer remains accepted; semantics unchanged',async t=>{
    const f=await macFixture(t),login=f.login();f.state.after=(method,value)=>{if(method==='config/read')value.layers.pop();};
    await login.start();f.notifyLogin();assert.equal(await login.complete(),'plus');
});
test('direct rebinding does not remove independent product host watchers',async t=>{
    const f=await macFixture(t);let watched=0;
    const unsubscribe=f.host.transport.subscribe(method=>{if(method==='account/login/completed')watched++;},()=>{});
    t.after(unsubscribe);const login=f.login();await login.start();f.notifyLogin();assert.equal(watched,1);
    assert.equal(await login.complete(),'plus');
});
for(const mode of ['wall-expiry','wall-rewind'])test(`${mode} during account RPC cannot publish a plan`,async t=>{
    const f=await macFixture(t),login=f.login();await login.start();f.notifyLogin();await login.complete();
    f.state.after=method=>{if(method==='account/read')f.state.wallOffset=mode==='wall-expiry'?300001:-60000;};
    await assert.rejects(login.read(),denied);
});
test('failed currentness is sticky even after the simulated cause disappears',async t=>{
    const f=await macFixture(t),login=f.login();await login.start();f.notifyLogin();await login.complete();
    f.state.adminAbsent=false;await assert.rejects(login.read(),denied);f.state.adminAbsent=true;
    await assert.rejects(login.read(),denied);assert.notEqual(f.reviewed.snapshot().state,'qualified');
});
test('upstream RPC timeout withdraws private authority and closes egress',async t=>{
    const f=await macFixture(t),login=f.login();await login.start();f.notifyLogin();await login.complete();
    f.state.before=()=>{throw new f.contract.ExecutionError('timeout');};
    await assert.rejects(login.read(),e=>e.code==='timeout');
    assert.equal(f.prepared.audit().phase,'revoked');assert.equal(f.state.proxyClosed,true);
});
test('an already connected account before device login remains rejected',async t=>{
    const f=await macFixture(t),login=f.login();f.state.connected=true;
    await assert.rejects(login.start(),denied);assert.equal(methods(f).includes('account/login/start'),false);
});
test('matching completion without a connected account cannot produce a plan',async t=>{
    const f=await macFixture(t),login=f.login();await login.start();
    f.emit('account/login/completed',f.clone({loginId:'fixture-login',success:true,error:null}));
    await assert.rejects(login.complete(),e=>e.code==='not_connected');
});
test('bounded transport close seals only after cleanup and still denies future RPC',async t=>{
    const f=await macFixture(t),login=f.login();await login.start();login.dispose();
    assert.equal(await f.host.transport.close(),true);assert.equal(f.prepared.audit().phase,'sealed');
    assert.equal(f.prepared.audit().cleanupComplete,true);
    await assert.rejects(f.host.transport.request('account/read',{refreshToken:false}),denied);
});
test('an unconfirmed close never returns success or retains reusable private authority',async t=>{
    const f=await macFixture(t),login=f.login();await login.start();login.dispose();f.state.cleanup=false;
    assert.equal(await f.host.transport.close(),false);assert.equal(f.prepared.audit().phase,'revoked');
    assert.notEqual(f.reviewed.snapshot().state,'qualified');
});
test('elapsed drain deadline denies a late seal even when no timer has fired',async t=>{
    const f=await macFixture(t),login=f.login();await login.start();login.dispose();
    const close=f.raw.close;
    f.raw.close=async()=>{const success=await close();f.state.clockOffset+=501;return success;};
    assert.equal(await f.host.transport.close(),false);
    assert.equal(f.prepared.audit().phase,'revoked');
    assert.equal(f.host.boundaryQualified(),false);
});
