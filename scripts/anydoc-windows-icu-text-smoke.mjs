// One explicitly requested Windows text discriminator; never imported by product code.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {countWindowsIcuPngInk} from './anydoc-windows-icu-png-oracle.mjs';
const SOURCE_ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROFILE_SHA256='e18c156831781d8324331d37b71c0f702165d731b77d2bf719c499d3267a75bf';
const WORKER_SHA256='438a8a5c417abbdc7268888a4202c4bad112089425cf5dfda952e9981844d9ae';
const FONT_SHA256='f8ace1f892b2bd9dc1792ba7f097fa7588f84fed48321480e04de5390828221f';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const demand=(condition,message)=>{if(!condition)throw Error(message);};
function physical(root,relative){const file=path.join(root,relative);demand(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink()&&fs.realpathSync(file)===file,'Nonphysical probe input');return file;}

export function verifyWindowsIcuTextOutput(bytes){
 demand(Buffer.isBuffer(bytes)&&bytes.length<=256*1024,'Text probe receipt bound');const result=JSON.parse(bytes.toString('utf8'));
 demand(result.schemaVersion==='mediflow.windows_icu_text_probe.v1'&&result.width===256&&result.height===64&&Number.isInteger(result.inkPixels)&&result.inkPixels>=0&&result.inkPixels<=256*64,'Text probe diagnostic count is invalid');
 const png=Buffer.from(result.pngBase64,'base64');demand(png.toString('base64')===result.pngBase64&&png.length===result.pngBytes&&png.length>=57&&png.length<=128*1024&&sha(png)===result.pngSHA256,'Text probe PNG identity');
 const decodedInkPixels=countWindowsIcuPngInk(png);return {...result,decodedInkPixels};
}

const CHILD=String.raw`
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
const root=fs.realpathSync(process.argv[1]),sha=b=>createHash('sha256').update(b).digest('hex');
const profileBytes=fs.readFileSync(path.join(root,'scripts/anydoc-pdf-renderer-profiles.json'));
if(sha(profileBytes)!=='e18c156831781d8324331d37b71c0f702165d731b77d2bf719c499d3267a75bf')throw Error('Probe profile drift');
const profile=JSON.parse(profileBytes).find(p=>p.platform==='win32'&&p.arch==='x64');
for(const [file,size,digest] of [[profile.binary,profile.binaryByteLength,profile.binarySha256],[profile.icuData.file,profile.icuData.byteLength,profile.icuData.sha256]]){
 const filePath=path.join(root,'node_modules',profile.package,file),stat=fs.lstatSync(filePath);
 if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(filePath)!==filePath||stat.size!==size||sha(fs.readFileSync(filePath))!==digest)throw Error('Probe renderer asset invalid');
}
const font=fs.readFileSync(0);if(font.length>262144||sha(font)!=='f8ace1f892b2bd9dc1792ba7f097fa7588f84fed48321480e04de5390828221f')throw Error('Probe font drift');
const require=createRequire(path.join(root,'package.json'));const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
const family='MediFlow ICU text probe';if(!GlobalFonts.register(font,family)||!GlobalFonts.has(family))throw Error('Explicit pinned font registration failed');
const canvas=createCanvas(256,64),context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,256,64);context.fillStyle='#000';context.font='24px "'+family+'"';context.fillText('ICU 012345',8,40);
const pixels=context.getImageData(0,0,256,64).data;let inkPixels=0;for(let i=0;i<pixels.length;i+=4)if(Math.min(pixels[i],pixels[i+1],pixels[i+2])*pixels[i+3]/255+255*(1-pixels[i+3]/255)<128)inkPixels++;
if(inkPixels<8)throw Error('Explicit text yielded an empty image');const png=canvas.toBuffer('image/png');
process.stdout.write(JSON.stringify({schemaVersion:'mediflow.windows_icu_text_probe.v1',width:256,height:64,inkPixels,pngBytes:png.length,pngSHA256:sha(png),pngBase64:png.toString('base64')}));
`;

function main(){
 const [bundle,output,...extra]=process.argv.slice(2);demand(bundle&&output&&!extra.length,'Usage: anydoc-windows-icu-text-smoke.mjs STANDALONE NEW_RECEIPTS');
 demand(process.platform==='win32'&&process.arch==='x64'&&process.versions.node==='24.21.0'&&process.versions.modules==='137','Exact Windows Node24.21.0/x64/ABI137 required');
 const root=fs.realpathSync(bundle),directory=path.resolve(output);fs.mkdirSync(directory);
 let receipt={schemaVersion:1,kind:'single synthetic Windows ICU text discriminator',releaseQualified:false,rendererCalls:0,retries:0,contract:{timeoutMs:30000,oldSpaceMiB:256,maxBuffer:4194304},fontSHA256:FONT_SHA256};
 try{
  const profilesBytes=fs.readFileSync(physical(root,'scripts/anydoc-pdf-renderer-profiles.json'));demand(sha(profilesBytes)===PROFILE_SHA256,'Probe profile digest differs');
  demand(sha(fs.readFileSync(physical(root,'scripts/anydoc-pdf-page-worker.mjs')))===WORKER_SHA256,'Probe candidate worker differs');
  const profile=JSON.parse(profilesBytes).find(p=>p.platform==='win32'&&p.arch==='x64');
  for(const [file,size,digest] of [[profile.binary,profile.binaryByteLength,profile.binarySha256],[profile.icuData.file,profile.icuData.byteLength,profile.icuData.sha256]]){const asset=physical(root,path.join('node_modules',profile.package,file));demand(fs.statSync(asset).size===size&&sha(fs.readFileSync(asset))===digest,'Probe renderer asset differs');}
  const manifest=JSON.parse(fs.readFileSync(physical(root,'mediflow-runtime-contract.json')));demand(manifest.platform==='win32'&&manifest.arch==='x64'&&manifest.node.version===process.versions.node&&manifest.node.moduleVersion===process.versions.modules,'Probe compiled runtime differs');
  const require=createRequire(physical(root,'package.json'));const entry=require.resolve('@napi-rs/canvas');demand(entry===fs.realpathSync(entry)&&path.relative(root,entry)!==''&&!path.relative(root,entry).startsWith('..')&&!path.isAbsolute(path.relative(root,entry)),'Probe canvas resolves outside bundle');
  demand(require('@napi-rs/canvas/package.json').version==='0.1.100'&&require(profile.package+'/package.json').version==='0.1.100','Probe canvas version differs');
  const font=fs.readFileSync(physical(fs.realpathSync(SOURCE_ROOT),'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));demand(font.length<=262144&&sha(font)===FONT_SHA256,'Probe font differs');
  receipt={...receipt,workerSHA256:WORKER_SHA256,profileSHA256:PROFILE_SHA256,rendererCalls:1};
  const child=spawnSync(process.execPath,['--max-old-space-size=256','--permission','--disable-warning=SecurityWarning','--allow-fs-read='+root,'--allow-addons','--input-type=module','--eval',CHILD,root],{cwd:root,env:{NODE_ENV:'production',NAPI_RS_ENFORCE_VERSION_CHECK:'1'},input:font,timeout:30000,maxBuffer:4194304,encoding:'buffer',windowsHide:true});
  receipt={...receipt,transport:{status:child.status,signal:child.signal,errorCode:child.error?.code??null,stdoutBytes:child.stdout?.length??0,stderrBytes:child.stderr?.length??0}};
  const persistenceFailures=[];
  for(const [name,bytes] of [['stdout.bin',child.stdout],['stderr.bin',child.stderr]]){
   try{const fd=fs.openSync(path.join(directory,name),'wx',0o600);try{fs.writeFileSync(fd,bytes??Buffer.alloc(0));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
   catch(error){persistenceFailures.push({file:name,error:error.message});}
  }
  if(persistenceFailures.length){receipt={...receipt,evidenceLoss:true,persistenceFailures};throw Error('Text probe raw persistence failed');}
  demand(!child.error&&child.status===0&&child.signal===null&&child.stderr?.length===0,'Text probe child transport failed');const result=verifyWindowsIcuTextOutput(child.stdout);receipt={...receipt,state:'text-produced',inkPixels:result.decodedInkPixels,childInkPixels:result.inkPixels,pngSHA256:result.pngSHA256};
  fs.writeFileSync(path.join(directory,'text.png'),Buffer.from(result.pngBase64,'base64'),{flag:'wx'});
 }catch(error){receipt={...receipt,state:'failed',failure:error.message};process.exitCode=1;}
 fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
