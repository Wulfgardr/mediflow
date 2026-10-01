// External, single-attempt synthetic diagnostic activation. Never a release gate.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const BRANCH='diagnostic/pr383-windows-font-ab-20261001';
export const REVIEWED_PATCH='fd1af838cfb05e3e0664ebee1233884079289fee35ec4b79e92a8d9691fca1fa';
export const PINS_SHA256='d407dd15c6bb32370bd39ca252ae5afdb33d068bac9cca0fc9025397086891e5';
export const CANDIDATE=Object.freeze({head:'eb701348f3a01ccf5051fe3d8a51de1082ef751d',tree:'1deddabbdf1dd2282ea8f63a05c89fd69e6483bc',parents:['a238b47fccce09db9a0a7b3977355266962216ca','df90702a69c8877557d666be81d039d6f88cde7a']});
export const ARTIFACT_BYTES_MAX=256*1024*1024;
const HERE=path.dirname(fileURLToPath(import.meta.url)),DIAGNOSTIC=path.dirname(path.dirname(HERE)),SOURCE=path.join(DIAGNOSTIC,'.diagnostics','font-ab');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const demand=(condition,message)=>{if(!condition)throw Error(message);};
const runtime=()=>({node:process.versions.node,modules:process.versions.modules,platform:process.platform,arch:process.arch});
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function physical(root,relative) {
  root=fs.realpathSync(root);
  demand(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).some(s=>!s||s==='..'),'Unsafe path');
  const file=path.join(root,relative);demand(fs.realpathSync(file)===file&&fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),'Nonphysical file');return file;
}
export const gitAt=repository=>args=>execFileSync('git',['-C',repository,...args],{encoding:'utf8',timeout:10000,maxBuffer:1048576}).trim();
export function candidateIdentity(repository,git=gitAt(repository)) {
  const head=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
  // Read raw commit headers: works when rev-list/%P hide shallow parents.
  const parents=git(['cat-file','-p','HEAD']).split(/\r?\n\r?\n/,1)[0].split(/\r?\n/).filter(s=>/^parent [0-9a-f]{40}$/.test(s)).map(s=>s.slice(7));
  demand(head===CANDIDATE.head&&tree===CANDIDATE.tree&&JSON.stringify(parents)===JSON.stringify(CANDIDATE.parents),'Candidate SHA/tree/raw ordered parents mismatch');return {head,tree,parents};
}
function candidateContract(repository,git=gitAt(repository)) {
  const identity=candidateIdentity(repository,git),pkg=json(physical(repository,'package.json'));
  demand(pkg.scripts.prebuild==='node scripts/node-runtime-contract.mjs verify'&&pkg.scripts.build==='next build'&&pkg.scripts.postbuild==='node scripts/node-runtime-contract.mjs write-standalone-manifest && node scripts/check-standalone-runtime-bundle.mjs','Original lifecycle changed');
  demand(fs.readFileSync(physical(repository,'.nvmrc'),'utf8').trim()==='24'&&pkg.engines.node==='>=24 <25','Source Node contract changed');
  demand(git(['status','--porcelain','--untracked-files=all'])==='','Candidate source is not clean');return identity;
}
export function checkContext(env,event,diagnosticHead) {
  demand(env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_REF==='refs/heads/'+BRANCH&&env.GITHUB_RUN_ATTEMPT==='1','Wrong event/ref or repeated attempt');
  demand(event.ref===env.GITHUB_REF&&event.created===true&&event.deleted===false&&event.forced===false&&event.before==='0'.repeat(40),'Only first branch-creation push is allowed');
  demand(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA??'')&&event.after===env.GITHUB_SHA&&diagnosticHead===env.GITHUB_SHA,'Diagnostic checkout does not match push SHA');
  demand(/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??''),'Missing run ID');return {diagnosticSHA:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,attempt:1,branch:BRANCH};
}
export function verifySources(source=SOURCE,pinsFile=path.join(HERE,'source-pins.json')) {
  source=fs.realpathSync(source);const bytes=fs.readFileSync(physical(path.dirname(pinsFile),path.basename(pinsFile)));demand(sha(bytes)===PINS_SHA256,'Reviewed source-pins digest mismatch');const pins=JSON.parse(bytes);
  demand(pins.schemaVersion===1&&pins.reviewedSourcePatchSHA256===REVIEWED_PATCH&&pins.files.length===39,'Reviewed source pin identity');
  for(const entry of pins.files){const bytes=fs.readFileSync(physical(source,entry.path));demand(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'Reviewed LF source/asset mismatch: '+entry.path);}
  return {reviewedSourcePatchSHA256:REVIEWED_PATCH,sourcePinsSHA256:PINS_SHA256,corpusSHA256:pins.corpusSHA256};
}
async function harness(source=SOURCE){verifySources(source);const h=await import(pathToFileURL(path.join(source,'run-ab.mjs')).href);h.verifyCorpus(source);return h;}
function write(file,value) {const data=Buffer.from(JSON.stringify(value,null,2)+'\n');demand(data.length<=262144,'Activation receipt bound');const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function exactRuntime(value=runtime()){demand(value.node==='24.21.0'&&value.modules==='137'&&value.platform==='win32'&&value.arch==='x64','Exact Windows Node24.21.0/x64/ABI137 required');}
function state(receipts){return json(physical(receipts,'activation.json'));}
function requirePhase(receipts,name){const value=json(physical(receipts,name+'-exit.json')),initial=state(receipts);demand(value.phase===name&&value.exitCode===0&&value.diagnosticSHA===initial.diagnosticSHA&&value.runId===initial.runId,'Required successful phase: '+name);}
export async function prepare({candidate,receipts,diagnostic=DIAGNOSTIC,env=process.env,event,git=gitAt(candidate),diagnosticGit=gitAt(diagnostic),selectedRuntime=runtime(),source=SOURCE}) {
  exactRuntime(selectedRuntime);candidate=fs.realpathSync(candidate);diagnostic=fs.realpathSync(diagnostic);
  event??=json(physical(fs.realpathSync(path.dirname(env.GITHUB_EVENT_PATH)),path.basename(env.GITHUB_EVENT_PATH)));
  const context=checkContext(env,event,diagnosticGit(['rev-parse','HEAD'])),identity=candidateContract(candidate,git),pins=verifySources(source);
  demand(diagnosticGit(['status','--porcelain','--untracked-files=all'])==='','Diagnostic checkout changed');demand(!fs.existsSync(path.join(candidate,'.next')),'Compiled output already exists; no warming/reuse');
  await harness(source);fs.mkdirSync(receipts,{recursive:true});write(path.join(receipts,'activation.json'),{schemaVersion:1,...context,candidate:identity,...pins,qualification:'always nonqualifying; one creation-push attempt',planned:{materializations:8,renders:16,retries:0},runtime:selectedRuntime});return identity;
}
export function recordPhase(receipts,name,exitCode) {
  demand(['install','prebuild','compile','manifest','seal','observation'].includes(name)&&Number.isSafeInteger(exitCode)&&Math.abs(exitCode)<=2147483648,'Invalid phase/exit code');const initial=state(receipts);
  write(path.join(receipts,name+'-exit.json'),{phase:name,exitCode,diagnosticSHA:initial.diagnosticSHA,runId:initial.runId,qualification:'nonqualifying'});
}
export function beginCompile({candidate,receipts,git=gitAt(candidate)}) {
  requirePhase(receipts,'install');const identity=candidateContract(candidate,git);demand(!fs.existsSync(path.join(candidate,'.next')),'Fresh compile requires absent .next');
  const initial=state(receipts);write(path.join(receipts,'compile-claim.json'),{...identity,diagnosticSHA:initial.diagnosticSHA,runId:initial.runId,compileAttempts:1,priorRendererCalls:0,distDirectory:'.next'});
}
export async function seal({candidate,receipts,git=gitAt(candidate),selectedRuntime=runtime(),source=SOURCE,check}) {
  exactRuntime(selectedRuntime);candidate=fs.realpathSync(candidate);const identity=candidateContract(candidate,git),pins=verifySources(source),h=await harness(source);
  for(const phase of ['install','prebuild','compile','manifest'])requirePhase(receipts,phase);
  const initial=state(receipts),claim=json(physical(receipts,'compile-claim.json'));
  demand(claim.diagnosticSHA===initial.diagnosticSHA&&claim.runId===initial.runId&&claim.compileAttempts===1&&claim.priorRendererCalls===0&&JSON.stringify(claim.parents)===JSON.stringify(identity.parents)&&claim.head===identity.head&&claim.tree===identity.tree&&claim.distDirectory==='.next','Compilation claim mismatch');
  const worker=physical(candidate,'.next/standalone/scripts/anydoc-pdf-page-worker.mjs'),manifestBytes=fs.readFileSync(physical(candidate,'.next/standalone/mediflow-runtime-contract.json')),buildId=fs.readFileSync(physical(candidate,'.next/BUILD_ID'),'utf8').trim();
  demand(/^[A-Za-z0-9_-]{1,128}$/.test(buildId)&&fs.readFileSync(physical(candidate,'.next/standalone/.next/BUILD_ID'),'utf8').trim()===buildId,'Build output IDs differ');demand(sha(fs.readFileSync(worker))===h.WORKER_SHA256,'Compiled worker pin mismatch');
  const value={schemaVersion:1,candidateHead:identity.head,candidateTree:identity.tree,candidateParents:identity.parents,standaloneRelativePath:'.next/standalone',buildId,runtimeManifestSHA256:sha(manifestBytes),workerSHA256:h.WORKER_SHA256};
  const sealPath=path.join(candidate,'.next','font-ab-build-identity.json');write(sealPath,value);
  const compiled=(check??((candidate,worker)=>h.preflight(candidate,worker,'observe-windows')))(candidate,worker,selectedRuntime);
  write(path.join(receipts,'seal-receipt.json'),{candidate:identity,...pins,diagnosticSHA:initial.diagnosticSHA,runId:initial.runId,compileClaimSHA256:sha(fs.readFileSync(physical(receipts,'compile-claim.json'))),sealSHA256:sha(fs.readFileSync(sealPath)),seal:value,compiled,qualification:'nonqualifying'});return value;
}
export async function claimObservation({candidate,receipts,git=gitAt(candidate),source=SOURCE,selectedRuntime=runtime(),check}) {
  exactRuntime(selectedRuntime);candidate=fs.realpathSync(candidate);candidateContract(candidate,git);verifySources(source);const h=await harness(source);requirePhase(receipts,'seal');
  const initial=state(receipts),sealed=json(physical(receipts,'seal-receipt.json'));
  demand(sealed.diagnosticSHA===initial.diagnosticSHA&&sealed.runId===initial.runId&&sealed.reviewedSourcePatchSHA256===REVIEWED_PATCH&&sealed.sourcePinsSHA256===PINS_SHA256&&sealed.sealSHA256===sha(fs.readFileSync(physical(candidate,'.next/font-ab-build-identity.json'))),'Selected compile seal changed');
  const worker=physical(candidate,'.next/standalone/scripts/anydoc-pdf-page-worker.mjs');(check??((candidate,worker)=>h.preflight(candidate,worker,'observe-windows')))(candidate,worker,selectedRuntime);
  demand(!fs.existsSync(path.join(receipts,'observation')),'Observation output already exists');write(path.join(receipts,'observation-claim.json'),{diagnosticSHA:initial.diagnosticSHA,runId:initial.runId,attempt:1,materializationCeiling:8,renderCeiling:16,retries:0,sealSHA256:sealed.sealSHA256,reviewedSourcePatchSHA256:REVIEWED_PATCH,qualification:'always nonqualifying'});
}
function allowed(relative) {
  if(/^(activation|compile-claim|seal-receipt|observation-claim|(install|prebuild|compile|manifest|seal|observation)-exit)\.json$/.test(relative))return true;
  if(/^observation\/(budget|persistence-failure|verification-failure)\.json(\.pending)?$/.test(relative))return true;
  if(/^observation\/F[0-7]-materialize\.(stdout\.bin|stderr\.bin|receipt\.json(\.pending)?)$/.test(relative))return true;
  return /^observation\/slot-(0[1-9]|1[0-6])\/(stdout\.bin|stderr\.bin|receipt\.json(\.pending)?)$/.test(relative);
}
export function collect(receipts,upload,maxTotal=ARTIFACT_BYTES_MAX) {
  fs.mkdirSync(upload);let files=[],total=0;
  try {
    if(fs.existsSync(receipts)){
      receipts=fs.realpathSync(receipts);
      const visit=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,item.name),relative=path.relative(receipts,full).split(path.sep).join('/');demand(!item.isSymbolicLink()&&fs.realpathSync(full)===full,'Artifact symlink');if(item.isDirectory()){demand(relative==='observation'||/^observation\/slot-(0[1-9]|1[0-6])$/.test(relative),'Unexpected artifact directory');visit(full);}else{demand(item.isFile()&&allowed(relative),'Unexpected artifact file');const bytes=fs.statSync(full).size;demand(bytes<=(relative.endsWith('.bin')?8*1024*1024:262144),'Artifact file byte bound');total+=bytes;demand(files.length<128&&total<=maxTotal,'Artifact aggregate bound');files.push({relative,bytes,sha256:sha(fs.readFileSync(full))});}}};visit(receipts);
      for(const entry of files){const target=path.join(upload,...entry.relative.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(receipts,...entry.relative.split('/')),target,fs.constants.COPYFILE_EXCL);}
    }
    write(path.join(upload,'retention.json'),{state:'retained',files,totalBytes:total,aggregateCapBytes:ARTIFACT_BYTES_MAX,sourceMissing:!fs.existsSync(receipts),releaseQualified:false,originalSmokePassed:false});return {files,total};
  }catch(error){write(path.join(upload,'retention.json'),{state:'retention-failed',failure:error.message,evidenceLoss:true,releaseQualified:false,originalSmokePassed:false});throw error;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const [command,candidate,receipts,extra,...rest]=process.argv.slice(2);demand(command&&candidate&&receipts&&!rest.length&&(command==='record'?extra!==undefined:extra===undefined),'Activation arguments');
    if(command==='prepare')await prepare({candidate,receipts});
    else if(command==='record')recordPhase(candidate,receipts,Number(extra));
    else if(command==='begin-compile')beginCompile({candidate,receipts});
    else if(command==='seal')await seal({candidate,receipts});
    else if(command==='claim')await claimObservation({candidate,receipts});
    else if(command==='collect')collect(candidate,receipts);
    else throw Error('Unknown activation command');
  }catch(error){console.error(JSON.stringify({activationFailure:error.message,qualification:'nonqualifying'}));process.exitCode=1;}
}
