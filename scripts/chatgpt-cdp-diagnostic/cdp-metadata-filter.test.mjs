import assert from 'node:assert/strict';
// @Codex: temporary synthetic CI diagnosis; not a release fix.
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { createReducer, filterStream } from './cdp-metadata-filter.mjs';
const url = 'http://127.0.0.1:4567/api/settings/ai/chatgpt/synthesis/consent?NEVER_LOG_ME';
const format = (direction, value) => `2026-09-20T13:38:21.123Z pw:protocol ${direction} ► ${JSON.stringify(value)}`;
function fixture(options) { const out = []; const p = createReducer(x => out.push(x), options); return { out,p,send: x => p.line(format('SEND',x)),recv: x => p.line(format('RECV',x)) }; }
test('correlates primary session, network/fetch IDs and the original failed command; no raw data', () => {
    const {out,p,send,recv} = fixture();
    recv({sessionId:'s',method:'Network.requestWillBeSent',params:{requestId:'request',request:{url,method:'POST',postData:'NEVER_LOG_ME',headers:{Authorization:'NEVER_LOG_ME'}}}});
    send({sessionId:'s',id:1,method:'Fetch.enable',params:{patterns:[{urlPattern:'*'}]}}); recv({sessionId:'s',id:1,result:{}});
    recv({sessionId:'s',method:'Fetch.requestPaused',params:{requestId:'fetch',networkId:'request',request:{url,method:'POST'}}});
    send({sessionId:'s',id:2,method:'Fetch.continueRequest',params:{requestId:'fetch'}}); recv({sessionId:'s',id:2,result:{}});
    recv({sessionId:'s',method:'Network.loadingFinished',params:{requestId:'request',encodedDataLength:230}});
    send({sessionId:'s',id:3,method:'Network.getResponseBody',params:{requestId:'request'}});
    recv({sessionId:'s',id:3,error:{code:-32000,message:'No data found for resource with given identifier NEVER_LOG_ME'}});
    const summary = p.finish(); assert.equal(summary.complete,true); assert.equal(summary.bodyErrors,1);
    assert.equal(out.find(x=>x.method==='Fetch.requestPaused').networkRequest,out.find(x=>x.method==='Network.getResponseBody').request);
    assert.equal(out.find(x=>x.method==='Network.getResponseBody/reply').failure,'resource-missing');
    assert.equal(JSON.stringify(out).includes('NEVER_LOG_ME'),false);
});
test('same command ID across sessions is not conflated; body is hashed, never retained', () => {
    const {out,p,send,recv} = fixture();
    for (const s of ['a','b']) send({sessionId:s,id:1,method:'Network.getResponseBody',params:{requestId:'r'}});
    recv({sessionId:'b',id:1,result:{body:'NEVER_LOG_ME',base64Encoded:false}});
    recv({sessionId:'a',id:1,error:{code:-32000,message:'Request content was evicted from inspector cache'}});
    p.finish(); const replies=out.filter(x=>x.method==='Network.getResponseBody/reply');
    assert.notEqual(replies[0].session,replies[1].session); assert.equal(replies[0].bytes,12);
    assert.match(replies[0].sha256,/^[a-f0-9]{64}$/); assert.equal(replies[1].failure,'body-evicted');
    assert.equal(JSON.stringify(out).includes('NEVER_LOG_ME'),false);
});
test('unknown debug format, missing protocol and overflow are explicitly incomplete', () => {
    assert.equal(fixture().p.finish().complete,false);
    const malformed=fixture(); malformed.p.line('pw:protocol NEWFORMAT {}'); assert.equal(malformed.p.finish().malformed,1);
    const {p,send,recv}=fixture({recordLimit:2,mapLimit:2});
    for(let i=0;i<6;i++) { send({sessionId:'s'+i,id:i,method:'Network.getResponseBody',params:{requestId:'r'+i}}); recv({sessionId:'s'+i,id:i,result:{body:'x'}}); }
    const result=p.finish(); assert.equal(result.complete,false); assert.equal(result.overflow,true); assert.ok(result.dropped>0);
});
test('scenario diagnostics are re-whitelisted; no arbitrary messages or challenge values escape', () => {
    const {out,p}=fixture(); p.line('# '+JSON.stringify({schema:'mediflow.synthetic-response-lifetime.v1',complete:true,gatewayPort:4567,startedAtUnixMs:10,
        scenario:'NEVER_LOG_ME',events:[{event:'body/read-failed',sequence:1,milliseconds:2,failure:'cdp-body-resource-missing',secret:'NEVER_LOG_ME'},
            {event:'browser/hmr-frame',action:'NEVER_LOG_ME'},{event:'NEVER_LOG_ME'}]}));
    assert.equal(JSON.stringify(out).includes('NEVER_LOG_ME'),false); assert.equal(out[1].failure,'cdp-body-resource-missing');
    assert.equal(p.finish().malformed,1);
});
test('page lifetime console diagnostics retain only allowlisted stream metadata', () => {
    const {out,p}=fixture();
    p.line('debug '+JSON.stringify({schema:'mediflow.synthetic-response-lifetime-page.v1',event:'reader/read-settled',operation:'consent',counter:2,read:1,done:true,bytes:27,callSite:'readResponse',secret:'NEVER_LOG_ME'}));
    p.line('debug '+JSON.stringify({schema:'mediflow.synthetic-response-lifetime-page.v1',event:'signal/abort',operation:'consent',counter:2,doneSeen:true,bytesRead:27,callSite:'setActive',reason:'NEVER_LOG_ME'}));
    p.line('debug '+JSON.stringify({schema:'mediflow.synthetic-response-lifetime-page.v1',event:'NEVER_LOG_ME',operation:'consent'}));
    assert.deepEqual(out.map(({kind,event,operation,counter,read,done,bytes,doneSeen,bytesRead,callSite}) =>
        ({kind,event,operation,counter,read,done,bytes,doneSeen,bytesRead,callSite})), [
        {kind:'page-probe',event:'reader/read-settled',operation:'consent',counter:2,read:1,done:true,bytes:27,doneSeen:undefined,bytesRead:undefined,callSite:'readResponse'},
        {kind:'page-probe',event:'signal/abort',operation:'consent',counter:2,read:undefined,done:undefined,bytes:undefined,doneSeen:true,bytesRead:27,callSite:'setActive'},
    ]);
    assert.equal(JSON.stringify(out).includes('NEVER_LOG_ME'),false); assert.equal(p.finish().malformed,1);
});
test('extracts one prefixed Runtime console string with session/frame correlation and no raw console data', () => {
    const {out,p,send,recv}=fixture();
    recv({sessionId:'page-session',method:'Runtime.executionContextCreated',params:{context:{id:7,origin:'NEVER_LOG_ME',name:'NEVER_LOG_ME',auxData:{frameId:'raw-frame-secret'}}}});
    recv({sessionId:'page-session',method:'Network.loadingFailed',params:{requestId:'r',canceled:true,errorText:'net::ERR_ABORTED'}});
    const value='[mediflow-response-lifetime]'+JSON.stringify({schema:'mediflow.synthetic-response-lifetime-page.v1',event:'reader/cancel-call',operation:'consent',counter:4,doneSeen:true,bytesRead:31,callSite:'readResponse',secret:'NEVER_LOG_ME'});
    recv({sessionId:'page-session',method:'Runtime.consoleAPICalled',params:{type:'debug',executionContextId:7,args:[{type:'string',value,description:'NEVER_LOG_ME'}],stackTrace:{description:'NEVER_LOG_ME'}}});
    recv({sessionId:'page-session',method:'Runtime.consoleAPICalled',params:{type:'debug',executionContextId:7,args:[{type:'string',value},{type:'string',value:'NEVER_LOG_ME'}]}});
    recv({sessionId:'page-session',method:'Runtime.consoleAPICalled',params:{type:'log',executionContextId:7,args:[{type:'string',value:'NEVER_LOG_ME'}]}});
    send({sessionId:'page-session',id:9,method:'Network.getResponseBody',params:{requestId:'r'}}); recv({sessionId:'page-session',id:9,result:{body:'x'}});
    const event=out.find(x=>x.kind==='page-probe'); const network=out.find(x=>x.method==='Network.loadingFailed');
    assert.equal(event.session,network.session); assert.match(event.context,/^c\d+$/u); assert.match(event.frame,/^f\d+$/u);
    assert.deepEqual({event:event.event,operation:event.operation,counter:event.counter,doneSeen:event.doneSeen,bytesRead:event.bytesRead,callSite:event.callSite},
        {event:'reader/cancel-call',operation:'consent',counter:4,doneSeen:true,bytesRead:31,callSite:'readResponse'});
    const summary=p.finish(); assert.equal(summary.pageProbeEvents,1); assert.equal(summary.complete,true);
    assert.equal(JSON.stringify(out).includes('NEVER_LOG_ME'),false); assert.equal(JSON.stringify(out).includes('raw-frame-secret'),false);
});
test('Runtime page-probe overflow is retained and makes capture incomplete', () => {
    const {out,p,send,recv}=fixture();
    recv({sessionId:'s',method:'Runtime.consoleAPICalled',params:{type:'debug',executionContextId:1,args:[{type:'string',value:'[mediflow-response-lifetime]'+JSON.stringify({schema:'mediflow.synthetic-response-lifetime-page.v1',event:'probe/overflow'})}]}});
    send({sessionId:'s',id:1,method:'Network.getResponseBody',params:{requestId:'r'}}); recv({sessionId:'s',id:1,result:{body:'x'}});
    const summary=p.finish(); assert.equal(out.find(x=>x.kind==='page-probe').event,'probe/overflow');
    assert.equal(summary.pageProbeIncomplete,true); assert.equal(summary.complete,false);
});
test('stream filter handles split UTF-8 and oversized lines without outputting raw text', async () => {
    const valid=format('SEND',{sessionId:'s',id:1,method:'Network.getResponseBody',params:{requestId:'r'}})+'\n';
    const reply=format('RECV',{sessionId:'s',id:1,result:{body:'é漢',base64Encoded:false}})+'\n';
    const bytes=Buffer.from(valid+reply), index=bytes.indexOf(Buffer.from('é'))+1, out=[];
    const result=await filterStream(Readable.from([bytes.subarray(0,index),bytes.subarray(index)]),x=>out.push(x));
    assert.equal(result.complete,true); assert.equal(out[1].bytes,5);
    const overflow=[];
    const failed=await filterStream(Readable.from([Buffer.alloc(4*1024*1024+1,65),Buffer.from('\n'+valid+reply)]),x=>overflow.push(x));
    assert.equal(failed.inputIncomplete,true); assert.equal(failed.complete,false); assert.equal(failed.bodyCommands,1);
});
test('execution context reset, loader commits, cancellation and detach are observable independently', () => {
    const {out,p,recv}=fixture();
    recv({sessionId:'s',method:'Page.frameNavigated',params:{frame:{id:'f',loaderId:'new-loader',url:'http://127.0.0.1:4567/'}}});
    recv({sessionId:'s',method:'Runtime.executionContextsCleared',params:{}});
    recv({sessionId:'s',method:'Network.loadingFailed',params:{requestId:'r',canceled:true,errorText:'net::ERR_ABORTED'}});
    recv({sessionId:'s',method:'Network.webSocketCreated',params:{requestId:'ws',url:'ws://127.0.0.1:4567/_next/hmr'}});
    recv({sessionId:'s',method:'Network.webSocketFrameReceived',params:{requestId:'ws',response:{payloadData:JSON.stringify({type:'reloadPage',secret:'NEVER_LOG_ME'})}}});
    recv({method:'Target.detachedFromTarget',params:{sessionId:'s',targetId:'t'}}); p.finish();
    assert.equal(out[0].main,true); assert.equal(out[2].failure,'aborted'); assert.equal(out[4].action,'reloadPage');
    assert.equal(out[5].detachedSession,out[0].session); assert.equal(JSON.stringify(out).includes('NEVER_LOG_ME'),false);
});


test('same-context armed/checkpoint sequences survive both protocol and scenario allowlists', () => {
    const {out,p,send,recv}=fixture();
    recv({sessionId:'s',method:'Runtime.executionContextCreated',params:{context:{id:3,auxData:{frameId:'f'}}}});
    for (const [event,pageSequence] of [['probe/armed',1],['probe/checkpoint',19]]) {
        recv({sessionId:'s',method:'Runtime.consoleAPICalled',params:{type:'debug',executionContextId:3,args:[{type:'string',value:
            '[mediflow-response-lifetime]'+JSON.stringify({schema:'mediflow.synthetic-response-lifetime-page.v1',event,pageSequence,secret:'NEVER_LOG_ME'})}]}});
    }
    p.line('# '+JSON.stringify({schema:'mediflow.synthetic-response-lifetime.v1',complete:true,gatewayPort:4567,startedAtUnixMs:10,
        events:[{event:'page/probe/armed',sequence:1,pageSequence:1},{event:'page/probe/checkpoint',sequence:2,pageSequence:19}]}));
    send({sessionId:'s',id:1,method:'Network.getResponseBody',params:{requestId:'r'}});recv({sessionId:'s',id:1,result:{body:'x'}});
    const summary=p.finish();
    assert.equal(summary.pageProbeEvents,2); assert.equal(summary.pageProbeIncomplete,false);
    const callers=out.filter(row=>row.kind==='page-probe');
    assert.deepEqual(callers.map(row=>row.pageSequence),[1,19]);
    assert.equal(callers[0].session,callers[1].session);assert.equal(callers[0].context,callers[1].context);assert.equal(callers[0].frame,callers[1].frame);
    assert.deepEqual(out.filter(row=>row.kind==='scenario-event').map(row=>row.pageSequence),[1,19]);
    assert.equal(JSON.stringify(out).includes('NEVER_LOG_ME'),false);
});

test('negative or nonintegral page sequences are not normalized into a complete prefix', () => {
    const {out,p,recv}=fixture();
    for (const pageSequence of [-1,1.5,'1']) recv({sessionId:'s',method:'Runtime.consoleAPICalled',params:{type:'debug',executionContextId:1,args:[{type:'string',value:
        '[mediflow-response-lifetime]'+JSON.stringify({schema:'mediflow.synthetic-response-lifetime-page.v1',event:'probe/checkpoint',pageSequence})}]}});
    p.finish(); assert.equal(out.filter(row=>row.kind==='page-probe').length,3);
    assert.ok(out.filter(row=>row.kind==='page-probe').every(row=>!('pageSequence' in row)));
});
