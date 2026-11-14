import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {attestLocalOllamaModel} from '../lib/ai-providers/ollama-locality';

const source=fs.readFileSync(new URL('./measure-local-load.mjs',import.meta.url),'utf8');
const model='qwen3.5:35b-a3b';
const digest='26025611beeb3fe9e4850b1fdae686bebba7cdfa7f13ddb04955f19872ee022a';
const base='http://127.0.0.1:38492';

async function exerciseWarmAttestation(failPreload=false) {
    const wrapperStart=source.indexOf('const nativeFetch=');
    const wrapperEnd=source.indexOf('globalThis.fetch=request;',wrapperStart);
    const warmStart=source.indexOf('const attestation=',source.indexOf("for(const mode of ['cold','warm'])"));
    const warmEnd=source.indexOf('if(attestation.digest',warmStart);
    assert.ok(wrapperStart>=0&&wrapperEnd>wrapperStart&&warmStart>wrapperEnd&&warmEnd>warmStart,'bank transport statements remain identifiable');
    const wrapper=source.slice(wrapperStart,wrapperEnd+'globalThis.fetch=request;'.length);
    const warm=source.slice(warmStart,warmEnd);
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mediflow-warm-bank-'));
    const originalFetch=globalThis.fetch;
    const calls:{path:string;originHeader:string|null}[]=[];
    const descriptor={name:model,model,digest,size:1,details:{format:'synthetic-control-only'}};
    globalThis.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
        calls.push({path:url.pathname,originHeader:new Headers(init?.headers).get('Origin')});
        if(url.origin===base)return Response.json({synthetic:true});
        assert.equal(url.origin,'http://127.0.0.1:11434');
        if(failPreload&&url.pathname==='/api/generate')return Response.json({error:'synthetic_preload_failure'},{status:503});
        const body=url.pathname==='/api/version'?{version:'0.40.16'}
            :url.pathname==='/api/tags'||url.pathname==='/api/ps'?{models:[descriptor]}
            :url.pathname==='/api/show'?{details:{format:'synthetic-control-only'}}
            :url.pathname==='/api/generate'?{model,done:true}:null;
        assert.ok(body,'only the five attestation metadata paths are substituted');
        return Response.json(body);
    };
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    try {
        const run=new AsyncFunction('attestLocalOllamaModel','fs','E','base','model',wrapper+`
            try {
                let attestation=null,error=null;
                try { attestation=await(async()=>{${warm}return attestation;})(); }
                catch(e){error={message:e.message,code:e.code??null};}
                const wrapperRestored=globalThis.fetch===request;
                await request('/api/synthetic-application-control');
                let daemonStillDenied=false;
                try{await request('http://127.0.0.1:11434/api/version');}
                catch(e){daemonStillDenied=e.message==='external_request_denied';}
                return {attestation,error,wrapperRestored,daemonStillDenied};
            } finally { fs.closeSync(raw); }
        `);
        const result=await run(attestLocalOllamaModel,fs,directory,base,model);
        return {...result,calls};
    } finally {
        globalThis.fetch=originalFetch;
        fs.rmSync(directory,{recursive:true,force:true});
    }
}

test('load bank warm attestation reaches the native daemon transport and restores the restricted application wrapper',async()=>{
    const result=await exerciseWarmAttestation();
    assert.equal(result.error,null,'the first warm group must not exit with external_request_denied');
    assert.equal(result.attestation.digest,digest);
    assert.deepEqual(result.calls.map((call:{path:string})=>call.path),['/api/version','/api/tags','/api/show','/api/generate','/api/ps','/api/synthetic-application-control']);
    assert.equal(result.wrapperRestored,true);
    assert.equal(result.daemonStillDenied,true);
    assert.equal(result.calls.at(-1).originHeader,base);
});

test('load bank restores the restricted application wrapper when native preload fails',async()=>{
    const result=await exerciseWarmAttestation(true);
    assert.equal(result.error?.code,'provider_unready');
    assert.deepEqual(result.calls.map((call:{path:string})=>call.path),['/api/version','/api/tags','/api/show','/api/generate','/api/synthetic-application-control']);
    assert.equal(result.wrapperRestored,true);
    assert.equal(result.daemonStillDenied,true);
    assert.equal(result.calls.at(-1).originHeader,base);
});
