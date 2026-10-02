import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import profiles from './anydoc-pdf-renderer-profiles.json' with {type:'json'};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const schema='mediflow.anydoc_pdf_child_protocol.v1';

test('Windows ICU identity is pinned; other target profiles acquire no data asset',()=>{
 const windows=profiles.find(p=>p.platform==='win32'&&p.arch==='x64');
 assert.deepEqual(windows.icuData,{file:'icudtl.dat',byteLength:10468208,sha256:'9ae98c06cbb0ea43c5cd6b5725310c008c65e46072421a1118cb88e1de9a8b92'});
 for(const p of profiles.filter(p=>p.platform!=='win32'))assert.equal(p.icuData,undefined);
});

// These are physical, deliberately synthetic package bytes. The Windows native
// binary is never loaded; import hooks mark and stop entry after the real worker guard.
for(const scenario of ['valid','missing','same-size-corrupt','truncated','symlink','directory','missing-profile-asset','unsafe-profile-name']){
 test(`real worker Windows guard: ${scenario} ICU ${scenario==='valid'?'reaches guarded import':'rejects before native import'}`,()=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'mediflow-icu-worker-'));
  try{
   const scripts=path.join(root,'scripts'),backend=path.join(root,'node_modules/@napi-rs/canvas-win32-x64-msvc');fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(backend,{recursive:true});
   const binary=Buffer.from('Synthetic binary fixture; import forbidden.'),icu=Buffer.from('Synthetic ICU guard fixture; never interpreted as native data.');
   const profile={...profiles.find(p=>p.platform==='win32'),binaryByteLength:binary.length,binarySha256:digest(binary),icuData:{file:'icudtl.dat',byteLength:icu.length,sha256:digest(icu)}};
   fs.writeFileSync(path.join(backend,'package.json'),JSON.stringify({name:profile.package,version:'0.1.100'}));fs.writeFileSync(path.join(backend,profile.binary),binary);
   const asset=path.join(backend,'icudtl.dat');fs.writeFileSync(asset,icu);
   if(scenario==='missing')fs.rmSync(asset);
   if(scenario==='same-size-corrupt')fs.writeFileSync(asset,Buffer.alloc(icu.length,1));
   if(scenario==='truncated')fs.writeFileSync(asset,icu.subarray(1));
   if(scenario==='symlink'){fs.renameSync(asset,asset+'.real');fs.symlinkSync(asset+'.real',asset);}
   if(scenario==='directory'){fs.rmSync(asset);fs.mkdirSync(asset);}
   if(scenario==='missing-profile-asset')delete profile.icuData;
   if(scenario==='unsafe-profile-name')profile.icuData.file='../icudtl.dat';
   for(const [name,version] of [['pdfjs-dist','4.10.38'],['@napi-rs/canvas','0.1.100']]){const directory=path.join(root,'node_modules',name);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name,version}));}
   fs.writeFileSync(path.join(scripts,'anydoc-pdf-renderer-profiles.json'),JSON.stringify([profile]));
   const worker=path.join(scripts,'anydoc-pdf-page-worker.mjs');fs.copyFileSync(new URL('./anydoc-pdf-page-worker.mjs',import.meta.url),worker);
   const hook=path.join(scripts,'test-native-entry.mjs');fs.writeFileSync(hook,"import {registerHooks} from 'node:module';import {writeSync} from 'node:fs';Object.defineProperty(process,'platform',{value:'win32'});Object.defineProperty(process,'arch',{value:'x64'});registerHooks({resolve(specifier,context,next){if(specifier==='@napi-rs/canvas'||specifier==='pdfjs-dist/legacy/build/pdf.mjs'){writeSync(2,'NATIVE_ENTRY_ATTEMPTED\\n');throw Error('TEST_NATIVE_IMPORT_FORBIDDEN');}return next(specifier,context);}});");
   const body=Buffer.from('Synthetic page input for pre-import guard only.'),header=Buffer.from(JSON.stringify({schemaVersion:schema,operation:'render',pages:[{page:1,byteLength:body.length}],bodyByteLength:body.length})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
   const result=spawnSync(process.execPath,['--max-old-space-size=256','--permission','--disable-warning=SecurityWarning','--allow-fs-read='+root,'--allow-addons','--import',hook,worker],{cwd:scripts,env:{NODE_ENV:'production',NAPI_RS_ENFORCE_VERSION_CHECK:'1'},input:Buffer.concat([prefix,header,body]),timeout:30000,maxBuffer:4194304,encoding:'buffer',windowsHide:true});
   assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr.toString());assert.ok(result.stdout.length>=5);
   const size=result.stdout.readUInt32BE(0),reply=JSON.parse(result.stdout.subarray(4,4+size));assert.deepEqual(reply,{schemaVersion:schema,status:'error',reason:'engine_unavailable',bodyByteLength:0});assert.equal(result.stdout.length,4+size);
   if(scenario==='valid')assert.match(result.stderr.toString(),/NATIVE_ENTRY_ATTEMPTED/);
   else assert.equal(result.stderr.length,0,'Missing/corrupt ICU must be rejected without entering either native renderer import');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
}
