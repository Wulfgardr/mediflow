// Single nonqualifying observation producer; never imported by the product.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export const BRANCH='diagnostic/windows-icu-text-20261002';
const PINS_SHA='3c68fa0f5f769e79d2eb1976f55c276f6c75c2129dd5193128ee65a9d52586e1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const demand=(ok,why)=>{if(!ok)throw Error(why);};
function physical(root,relative){const p=path.join(root,relative),s=fs.lstatSync(p);demand(s.isFile()&&!s.isSymbolicLink()&&fs.realpathSync(p)===p,'Nonphysical activation input');return p;}
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function write(root,name,value){const b=Buffer.from(JSON.stringify(value,null,2)+'\n');demand(b.length<=262144,'Receipt byte bound');const fd=fs.openSync(path.join(root,name),'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function pins(){const b=fs.readFileSync(physical(HERE,'candidate-pins.json'));demand(sha(b)===PINS_SHA,'Candidate pins changed');return JSON.parse(b);}
export function checkContext(env,event){
 demand(env.GITHUB_REPOSITORY==='Wulfgardr/mediflow'&&env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_REF==='refs/heads/'+BRANCH&&env.GITHUB_RUN_ATTEMPT==='1'
  &&/^[0-9a-f]{40}$/.test(env.GITHUB_SHA??'')&&/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??'')
  &&event.created===true&&event.forced===false&&event.deleted===false&&event.before==='0'.repeat(40)&&event.after===env.GITHUB_SHA&&event.ref===env.GITHUB_REF,'Only one new branch creation push/attempt1 allowed');
 return {diagnosticSHA:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID};
}
export function parseCommit(raw){const header=raw.split(/\r?\n\r?\n/,1)[0].split(/\r?\n/);return {tree:header.find(l=>l.startsWith('tree '))?.slice(5),parents:header.filter(l=>l.startsWith('parent ')).map(l=>l.slice(7))};}
function candidate(root){
 root=fs.realpathSync(root);const p=pins(),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 const head=git('rev-parse','HEAD'),identity=parseCommit(git('cat-file','-p','HEAD'));
 demand(head===p.candidateHead&&identity.tree===p.candidateTree&&JSON.stringify(identity.parents)===JSON.stringify(p.candidateParents)&&git('status','--porcelain')==='','Candidate commit/tree/parents/clean status differ');
 for(const f of p.files){const b=fs.readFileSync(physical(root,f.file));demand(b.length===f.bytes&&sha(b)===f.sha256,'Candidate physical source drift');}
 const pkg=json(path.join(root,'package.json'));demand(pkg.scripts.prebuild==='node scripts/node-runtime-contract.mjs verify'&&pkg.scripts.build==='next build'&&pkg.scripts.postbuild==='node scripts/node-runtime-contract.mjs write-standalone-manifest && node scripts/check-standalone-runtime-bundle.mjs','Original lifecycle changed');
 return {head,tree:identity.tree,parents:identity.parents};
}
const state=receipts=>json(physical(receipts,'prepare.json'));
function phaseOk(receipts,name){demand(json(physical(receipts,name+'-exit.json')).exitCode===0,'Successful prior phase required: '+name);}
function runtime(){demand(process.platform==='win32'&&process.arch==='x64'&&process.versions.node==='24.21.0'&&process.versions.modules==='137','Exact Windows runtime required');}
export function prepare(root,receipts){
 runtime();root=fs.realpathSync(root);const identity=candidate(root),context=checkContext(process.env,json(process.env.GITHUB_EVENT_PATH));
 const diagnosticRoot=fs.realpathSync(path.resolve(HERE,'../..')),diagnosticGit=(...args)=>execFileSync('git',['-C',diagnosticRoot,...args],{encoding:'utf8'}).trim();
 demand(diagnosticGit('rev-parse','HEAD')===context.diagnosticSHA&&diagnosticGit('status','--porcelain')==='','Diagnostic checkout identity/clean status differs');
 const sourceFiles=['.gitattributes','.github/workflows/windows-icu-text-diagnostic.yml','.diagnostics/windows-icu-text/activate.mjs','.diagnostics/windows-icu-text/activate.test.mjs','.diagnostics/windows-icu-text/candidate-pins.json','.diagnostics/windows-icu-text/README.md'];
 const sourceDigests=sourceFiles.map(file=>{const b=fs.readFileSync(physical(diagnosticRoot,file)),gitBytes=execFileSync('git',['-C',diagnosticRoot,'show','HEAD:'+file]);demand(b.equals(gitBytes),'Diagnostic source checkout byte drift');return {file,bytes:b.length,sha256:sha(b)};});
 demand(!fs.existsSync(path.join(root,'.next')),'Previous compiled output exists');fs.mkdirSync(receipts);receipts=fs.realpathSync(receipts);
 write(receipts,'prepare.json',{schemaVersion:1,...context,candidate:identity,sourceDigests,releaseQualified:false,originalWindowsPostbuildSmokePassed:false,expectedTextChildren:1});
}
export function record(receipts,name,exitCode){
 demand(['install','prebuild','compile','manifest','observation'].includes(name)&&Number.isSafeInteger(exitCode)&&exitCode>=-2147483648&&exitCode<=4294967295,'Phase/exit invalid');
 write(receipts,name+'-exit.json',{...state(receipts),phase:name,exitCode});
}
export function begin(root,receipts){runtime();candidate(root);phaseOk(receipts,'install');demand(!fs.existsSync(path.join(root,'.next')),'Previous compiled output exists');write(receipts,'compile-claim.json',{...state(receipts),compileAttempts:1,priorTextChildren:0});}
export function verifyBuilt(root){
 root=fs.realpathSync(root);const identity=candidate(root),bundlePath=path.join(root,'.next/standalone');
 demand(fs.lstatSync(bundlePath).isDirectory()&&!fs.lstatSync(bundlePath).isSymbolicLink()&&fs.realpathSync(bundlePath)===bundlePath,'Nonphysical selected bundle');const bundle=bundlePath;
 const buildId=fs.readFileSync(physical(root,'.next/BUILD_ID'),'utf8').trim();demand(/^[A-Za-z0-9_-]{1,128}$/.test(buildId)&&fs.readFileSync(physical(bundle,'.next/BUILD_ID'),'utf8').trim()===buildId,'Build IDs differ');
 const manifestBytes=fs.readFileSync(physical(bundle,'mediflow-runtime-contract.json')),manifest=JSON.parse(manifestBytes);
 demand(manifest.platform==='win32'&&manifest.arch==='x64'&&manifest.node.version==='24.21.0'&&manifest.node.moduleVersion==='137','Compiled runtime differs');
 for(const file of ['scripts/anydoc-pdf-page-worker.mjs','scripts/anydoc-pdf-renderer-profiles.json'])demand(fs.readFileSync(physical(bundle,file)).equals(fs.readFileSync(physical(root,file))),'Compiled worker/profile differs');
 const profile=json(path.join(bundle,'scripts/anydoc-pdf-renderer-profiles.json')).find(p=>p.platform==='win32'&&p.arch==='x64');
 for(const [file,size,digest] of [[profile.binary,profile.binaryByteLength,profile.binarySha256],[profile.icuData.file,profile.icuData.byteLength,profile.icuData.sha256]]){const b=fs.readFileSync(physical(bundle,path.join('node_modules',profile.package,file)));demand(b.length===size&&sha(b)===digest,'Compiled Windows asset differs');}
 const font=fs.readFileSync(physical(root,'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));demand(font.length===139512&&sha(font)==='f8ace1f892b2bd9dc1792ba7f097fa7588f84fed48321480e04de5390828221f','Physical source font differs');
 return {candidate:identity,buildId,runtimeManifestSHA256:sha(manifestBytes),workerSHA256:sha(fs.readFileSync(physical(bundle,'scripts/anydoc-pdf-page-worker.mjs'))),profileSHA256:sha(fs.readFileSync(physical(bundle,'scripts/anydoc-pdf-renderer-profiles.json')))};
}
export function seal(root,receipts){runtime();for(const p of ['install','prebuild','compile','manifest'])phaseOk(receipts,p);const claim=json(physical(receipts,'compile-claim.json'));demand(claim.compileAttempts===1&&claim.runId===state(receipts).runId,'Compile claim differs');write(receipts,'build-seal.json',{...state(receipts),...verifyBuilt(root),compileClaimSHA256:sha(fs.readFileSync(path.join(receipts,'compile-claim.json')))});}
export function claim(root,receipts){
 runtime();const sealed=json(physical(receipts,'build-seal.json')),built=verifyBuilt(root);
 demand(JSON.stringify(built.candidate)===JSON.stringify(sealed.candidate)&&built.buildId===sealed.buildId&&built.runtimeManifestSHA256===sealed.runtimeManifestSHA256&&built.workerSHA256===sealed.workerSHA256&&built.profileSHA256===sealed.profileSHA256,'Selected compiled output changed after seal');
 demand(!fs.existsSync(path.join(receipts,'observation')),'Observation output already exists');write(receipts,'observation-claim.json',{...state(receipts),sealSHA256:sha(fs.readFileSync(path.join(receipts,'build-seal.json'))),textChildren:1,retries:0});
}
const ALLOWED=new Set(['prepare.json','install-exit.json','prebuild-exit.json','compile-exit.json','manifest-exit.json','observation-exit.json','compile-claim.json','build-seal.json','observation-claim.json','observation/stdout.bin','observation/stderr.bin','observation/receipt.json','observation/text.png']);
export function collect(receipts,output){
 fs.mkdirSync(output);const entries=[],failures=[];let total=0;
 function walk(root,prefix=''){
  for(const name of fs.readdirSync(root)){const relative=prefix+name,source=path.join(root,name),stat=fs.lstatSync(source);
   try{
    demand(!stat.isSymbolicLink()&&fs.realpathSync(source)===source,'Nonphysical receipt');
    if(stat.isDirectory()){demand(relative==='observation','Unexpected receipt directory');walk(source,relative+'/');continue;}
    demand(stat.isFile()&&ALLOWED.has(relative)&&entries.length<24,'Unexpected receipt file');
    const bound=relative.endsWith('.bin')?8*1024*1024:relative.endsWith('.png')?128*1024:262144;
    demand(stat.size<=bound&&total+stat.size<=20*1024*1024,'Retention byte bound');const b=fs.readFileSync(source);demand(b.length===stat.size,'Receipt changed during read');
    const target=path.join(output,relative);fs.mkdirSync(path.dirname(target),{recursive:true});const fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    entries.push({file:relative,bytes:b.length,sha256:sha(b)});total+=b.length;
   }catch(error){failures.push({file:relative,failure:error.message});}
  }
 }
 try{
  demand(fs.lstatSync(receipts).isDirectory()&&!fs.lstatSync(receipts).isSymbolicLink(),'Nonphysical receipt root');receipts=fs.realpathSync(receipts);output=fs.realpathSync(output);walk(receipts);
  const kept=new Set(entries.map(e=>e.file));demand(kept.has('prepare.json'),'Initial receipt missing');
  if(fs.existsSync(path.join(receipts,'observation')))demand(kept.has('observation/stdout.bin')&&kept.has('observation/stderr.bin'),'Raw pair incomplete');
  if(kept.has('observation/receipt.json')&&json(path.join(receipts,'observation/receipt.json')).evidenceLoss===true)failures.push({failure:'Probe reported evidence loss'});
 }catch(error){failures.push({failure:error.message});}
 const result={schemaVersion:1,releaseQualified:false,evidenceLoss:failures.length>0,entries,failures,totalBytes:total};write(output,'retention.json',result);return result;
}
function main(){const [command,a,b,c]=process.argv.slice(2);try{if(command==='prepare')prepare(a,path.resolve(b));else if(command==='record')record(fs.realpathSync(a),b,Number(c));else if(command==='begin')begin(fs.realpathSync(a),fs.realpathSync(b));else if(command==='seal')seal(fs.realpathSync(a),fs.realpathSync(b));else if(command==='claim')claim(fs.realpathSync(a),fs.realpathSync(b));else if(command==='collect'){const result=collect(path.resolve(a),path.resolve(b));if(result.evidenceLoss)process.exitCode=1;}else throw Error('Unknown activation operation');}catch(error){console.error(error.message);process.exitCode=1;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
