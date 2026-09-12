/* @Codex — genuine 0.8.8 owner; no cookie, database, native process or provider. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { basename } from 'node:path';
const syntheticUsername = basename(new URL(import.meta.url).pathname);
import { ordinaryFunctionCommand, beginOrdinaryFunction, isOrdinaryFunctionSelected } from './ordinary-flow';
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from '../security/web-auth-lifecycle-owner-test-fixture';
import { acquireWebSessionResourceIdentity } from '../security/web-session-resource-identity';
import * as owner from '../security/web-auth-lifecycle-owner-adapter';
const signal=()=>new AbortController().signal;
const web=(session: ReturnType<typeof issueSyntheticWebSessionContext>['session']): owner.WebSessionProjection => { assert.equal(session.authChannel,'web');return session as owner.WebSessionProjection; };
test('fresh authentic projections share the opaque generation; GET is passive and does not create an attempt',async()=>{
    const ctx=issueSyntheticWebSessionContext({id:'ordinary-owner-synthetic',username:syntheticUsername,role:'doctor'},'ordinary-owner-control');
    try { const fresh=owner.resolve(ctx.session.id,ctx.controlId);assert.equal(fresh.status,'active');if(fresh.status!=='active')return;
        assert.notEqual(fresh.projection,ctx.session);const a=acquireWebSessionResourceIdentity(web(ctx.session))!,b=acquireWebSessionResourceIdentity(fresh.projection)!;
        assert.ok(a);assert.ok(b);assert.equal(a.generation,b.generation);owner.releaseResourcePort(a.port);owner.releaseResourcePort(b.port);
        const one=await ordinaryFunctionCommand(web(ctx.session),'status',{},signal());const two=await ordinaryFunctionCommand(fresh.projection,'status',{},signal());
        assert.deepEqual(await one.json(),await two.json());assert.equal(isOrdinaryFunctionSelected('patient_insight'),false);
    } finally {retireSyntheticWebSession(ctx.session);}
});
test('copies/proxies/native authority are denied before lookup or original handler',async()=>{
    const ctx=issueSyntheticWebSessionContext({id:'ordinary-owner-copy',username:syntheticUsername,role:'doctor'},'ordinary-owner-copy-control');let calls=0,getters=0;
    const native=owner.serverSessions.createNativeServerSession({id:'ordinary-native-synthetic',username:syntheticUsername,role:'doctor'},{clientId:'synthetic-client',clientPlatform:'macos',tokenHash:'a'.repeat(64)});
    try {
        const getter=Object.defineProperty({},'id',{enumerable:true,get(){getters++;return ctx.session.id;}});
        for(const value of [{...ctx.session},Object.create(ctx.session),new Proxy(ctx.session,{}),native,getter]){
            await assert.rejects(ordinaryFunctionCommand(value as owner.WebSessionProjection,'status',{},signal()));
            await assert.rejects(beginOrdinaryFunction(new Request('http://localhost/api/ai/patient-insight/preview',{method:'POST',body:'{}'}),'patient_insight',value as owner.WebSessionProjection,async()=>{calls++;return Response.json({});}));
        }
        assert.equal(calls,0);assert.equal(getters,0);
    } finally {retireSyntheticWebSession(ctx.session);owner.serverSessions.deleteSession(native.id);}
});
test('retired projection cannot read the closed registry; a new same-user cell is different authority',async()=>{
    const a=issueSyntheticWebSessionContext({id:'ordinary-same-user',username:syntheticUsername,role:'doctor'},'ordinary-old-control');
    const ai=acquireWebSessionResourceIdentity(web(a.session))!;assert.ok(ai);owner.releaseResourcePort(ai.port);retireSyntheticWebSession(a.session);
    await assert.rejects(ordinaryFunctionCommand(web(a.session),'status',{},signal()));
    const b=issueSyntheticWebSessionContext({id:'ordinary-same-user',username:syntheticUsername,role:'doctor'},'ordinary-new-control');
    try {const bi=acquireWebSessionResourceIdentity(web(b.session))!;assert.notEqual(ai.generation,bi.generation);owner.releaseResourcePort(bi.port);assert.equal((await ordinaryFunctionCommand(web(b.session),'status',{},signal())).status,200);}finally{retireSyntheticWebSession(b.session);}
});
