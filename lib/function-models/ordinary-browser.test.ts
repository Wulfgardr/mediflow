/* @Codex — browser protocol tests. HTTP and process peers are explicit doubles. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrdinaryBrowser, parseOrdinaryBrowserSettings, parseOrdinaryCatalog } from './ordinary-browser';
import { ORDINARY_FLOW_SCHEMA, ORDINARY_SELECTION_SCHEMA, type OrdinaryFunction } from '../chatgpt-product/ordinary-wire';
function loginFixtureURL(hostname: string, protocol = 'https:', port = '', credentials = false) {
    const value = new URL('http://localhost/device'); value.protocol = protocol; value.hostname = hostname; value.port = port;
    if (credentials) { value.username = hostname; value.password = protocol; }
    return value.href;
}
const ids: OrdinaryFunction[] = ['patient_insight','smart_import','document_synthesis','treatment_reasoning'];
function settings() { return {schema:'mediflow.chatgpt-ordinary-settings.v1',revision:'sha256_'+'a'.repeat(64),enabled:true,retention:'chatgpt_service_terms_apply',preferences:Object.fromEntries(ids.map(id=>[id,{use:'local',model:null as string|null,effort:null as string|null}])),lanes:Object.fromEntries(ids.map(id=>[id,'enabled']))}; }
async function until(check:()=>boolean) { for(let i=0;i<50;i++){if(check())return;await new Promise<void>(resolve=>setImmediate(resolve));}assert.ok(check(),'expected state transition'); }
function harness(id: OrdinaryFunction) {
    let policy=settings(), phase='needs_consent'; const history:{path:string;body:unknown;headers:Headers}[]=[];
    const catalog={revision:'catalog-current',choices:[{optionId:'current-1',model:'synthetic-model-A',effort:'medium'},{optionId:'current-2',model:'synthetic-model-B',effort:'high'}]};
    const state=()=>({schema:ORDINARY_FLOW_SCHEMA,attemptId:'attempt-original',functionId:id,phase,expiresAt:Date.now()+120000});
    const disclosure={schema:'mediflow.chatgpt-ordinary-disclosure.v1',revision:'disclosure-current',operation:id,profileVersion:'mediflow.ordinary-redacted-profile.v1',contextRevision:'host-context',attemptRevision:'host-attempt',qualificationRevision:'host-qualification',sourceSha256:'sha256_'+'a'.repeat(64),payloadSha256:'b'.repeat(64),payloadBytes:100,egress:['auth.openai.com:443','chatgpt.com:443'],proposalOnly:true,clinicalWrites:0};
    const expected={function:id,status:'available',value:{specific:'original function response',writesPerformed:0}};
    let pendingOnce=false;
    let failure:string|null=null, loginURL=loginFixtureURL('auth.openai.com'), release: (()=>void)|undefined, suspendGenerate=false;
    const transport=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const path=String(input),body=typeof init?.body==='string'?JSON.parse(init.body):null;
        history.push({path,body,headers:new Headers(init?.headers)});
        if(path.endsWith('/settings'))return Response.json(policy);
        if(path.endsWith('/policy')){policy={...policy,enabled:body.enabled};return Response.json(policy);}
        if(path===`/api/ai/${id.replaceAll('_','-')}/preview`)return Response.json({...state(),disclosure},{status:202});
        if(path.endsWith('/consent')){assert.deepEqual(body,{attemptId:'attempt-original',expectedDisclosureRevision:disclosure.revision});phase='consented';}
        if(path.endsWith('/login/start')){phase='awaiting_login';return Response.json({...state(),challenge:{verificationUrl:loginURL,userCode:'SYNTHETIC-ONLY'}});}
        if(path.endsWith('/login/complete')){if(pendingOnce){pendingOnce=false;return Response.json({code:'login_pending'},{status:409});}phase='connected';}
        if(path.endsWith('/models')){phase='ready';return Response.json({...state(),catalog});}
        if(path.endsWith('/preference'))return Response.json({...state(),settings:policy});
        if(path.endsWith('/generate')){
            if(suspendGenerate)await new Promise<void>(resolve=>{release=resolve;});
            if(failure)return Response.json({code:failure},{status:409});
            assert.deepEqual(body,{attemptId:'attempt-original',modelOptionId:'current-1',expectedCatalogRevision:'catalog-current'});
            return Response.json(expected);
        }
        return Response.json(state());
    }) as typeof fetch;
    const client=createOrdinaryBrowser(id,transport,()=>{});
    return {client,history,expected,settings:()=>policy,setPolicy:(s:ReturnType<typeof settings>)=>{policy=s;},fail:(c:string)=>{failure=c;},url:(u:string)=>{loginURL=u;},suspend:()=>{suspendGenerate=true;},release:()=>release?.(),isSuspended:()=>!!release,pending:()=>{pendingOnce=true;}};
}
async function prepare(h:ReturnType<typeof harness>,id:OrdinaryFunction,signal=new AbortController().signal){
    await h.client.read();const final=h.client.execute(`/api/ai/${id.replaceAll('_','-')}/preview`,{method:'POST',body:JSON.stringify({opaqueHandle:'owned-selection'})},signal);
    void final.catch(()=>{});await until(()=>h.client.getSnapshot().state?.phase==='needs_consent');return {final};
}
async function ready(h:ReturnType<typeof harness>){for(const step of ['consent','login/start','login/complete','models'] as const)await h.client.action(step);}
for(const id of ids)test(`${id}: exact original response only after explicit consent, login, catalog and generate`,async t=>{
    const h=harness(id);t.after(()=>h.client.cancel());const {final}=await prepare(h,id);
    let delivered=false;void final.then(()=>{delivered=true;}).catch(()=>{});await new Promise<void>(r=>setImmediate(r));assert.equal(delivered,false);
    assert.equal(h.history.filter(x=>x.path.endsWith('/generate')).length,0);
    const preview=h.history.find(x=>x.path.includes('/preview'))!;
    assert.deepEqual(JSON.parse(preview.headers.get('x-mediflow-function-model')!),{schema:ORDINARY_SELECTION_SCHEMA,expectedPreferenceRevision:h.settings().revision});
    await ready(h);assert.equal(h.client.getSnapshot().choice,'');assert.equal(delivered,false);
    h.client.choose('current-1');await h.client.action('generate');
    assert.deepEqual(await (await final).json(),h.expected);
    assert.equal(h.client.getSnapshot().completed,true);assert.equal(h.client.getSnapshot().catalog,null);
    assert.equal(h.history.filter(x=>x.path.endsWith('/generate')).length,1);
});
test('saved model missing in new catalog is not replaced by first available choice',async t=>{
    const h=harness('patient_insight');const s=h.settings();h.setPolicy({...s,preferences:{...s.preferences,patient_insight:{use:'chatgpt_subscription',model:'removed-model',effort:'medium'}}});
    t.after(()=>h.client.cancel());const {final}=await prepare(h,'patient_insight');await ready(h);
    assert.equal(h.client.getSnapshot().choice,'');assert.match(h.client.getSnapshot().error??'',/non è nel catalogo/);
    h.client.cancel();await assert.rejects(final);
});
for(const error of ['model_unavailable','catalog_stale','quota_exhausted','limits_unavailable','revoked'])test(`${error}: no provider fallback and no automatic turn retry`,async t=>{
    const h=harness('smart_import');t.after(()=>h.client.cancel());const {final}=await prepare(h,'smart_import');await ready(h);h.client.choose('current-1');h.fail(error);await h.client.action('generate');
    await assert.rejects(final);assert.equal(h.history.filter(x=>x.path.endsWith('/generate')).length,1);assert.equal(h.history.some(x=>/ollama|athena/.test(x.path)),false);
    assert.match(h.client.getSnapshot().error??'',/Nessun fallback/);
});
test('cancel while generation ignores browser abort still suppresses late response',async t=>{
    const h=harness('document_synthesis');t.after(()=>h.client.cancel());const {final}=await prepare(h,'document_synthesis');await ready(h);h.client.choose('current-1');h.suspend();
    const generate=h.client.action('generate');await until(h.isSuspended);h.client.cancel();await assert.rejects(final);h.release();await generate;
    assert.equal(h.client.getSnapshot().completed,false);assert.ok(h.history.some(x=>x.path.endsWith('/cancel')));
});
test('source/patient abort while waiting login cancels owned attempt and discards response',async t=>{
    const h=harness('treatment_reasoning'),abort=new AbortController();t.after(()=>h.client.cancel());const {final}=await prepare(h,'treatment_reasoning',abort.signal);
    await h.client.action('consent');abort.abort();await assert.rejects(final);assert.ok(h.history.some(x=>x.path.endsWith('/cancel')));assert.equal(h.client.getSnapshot().state,null);
});
for(const url of [loginFixtureURL('evil.invalid'),loginFixtureURL('auth.openai.com', 'http:'),loginFixtureURL('auth.openai.com', 'https:', '', true),loginFixtureURL('auth.openai.com', 'https:', '8443')])test(`official login URL rejects ${url}`,async t=>{
    const h=harness('patient_insight');t.after(()=>h.client.cancel());const {final}=await prepare(h,'patient_insight');await h.client.action('consent');h.url(url);await h.client.action('login/start');await assert.rejects(final);
});
test('bad settings and catalog contracts fail closed; ephemeral options cannot enter preference record',()=>{
    assert.throws(()=>parseOrdinaryBrowserSettings({...settings(),approved:true}));
    assert.throws(()=>parseOrdinaryBrowserSettings({...settings(),retention:'zero'}));
    const s=settings();assert.throws(()=>parseOrdinaryBrowserSettings({...s,preferences:{...s.preferences,smart_import:{use:'chatgpt_subscription',model:'m',effort:'medium',optionId:'leak'}}}));
    assert.throws(()=>parseOrdinaryCatalog({revision:'r',choices:[{optionId:'a',model:'m',effort:'medium'},{optionId:'a',model:'m',effort:'high'}]}));
    assert.throws(()=>parseOrdinaryCatalog({revision:'r',choices:[{optionId:'a',model:'m',effort:'unknown'}]}));
});

test('official login still pending preserves the same owned attempt and permits explicit recheck',async t=>{
    const h=harness('patient_insight');t.after(()=>h.client.cancel());const {final}=await prepare(h,'patient_insight');
    await h.client.action('consent');await h.client.action('login/start');h.pending();await h.client.action('login/complete');
    assert.equal(h.client.getSnapshot().state?.phase,'awaiting_login');assert.equal(h.history.some(x=>x.path.endsWith('/cancel')),false);
    await h.client.action('login/complete');await h.client.action('models');h.client.choose('current-1');await h.client.action('generate');
    assert.deepEqual(await (await final).json(),h.expected);assert.equal(h.history.filter(x=>x.path.endsWith('/login/start')).length,1);
});
