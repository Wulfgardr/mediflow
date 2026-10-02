import assert from 'node:assert/strict';
import test from 'node:test';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {verifyWindowsIcuTextOutput} from './anydoc-windows-icu-text-smoke.mjs';

// Independent synthetic PNG encoder: no canvas, child process or decoder helper.
function chunk(type,data){
 const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
 for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 const prefix=Buffer.alloc(4),suffix=Buffer.alloc(4);prefix.writeUInt32BE(data.length);suffix.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([prefix,body,suffix]);
}
function fixture({ink=8,alpha=255,filter=0,color=6,invalidData=false,extraRow=false,wrongWidth=false,compressedTail=false}={}){
 const channels=({0:1,2:3,4:2,6:4})[color],stride=256*channels,raw=Buffer.alloc(stride*64,255);
 for(let i=0;i<ink;i++){const at=(256+16+i)*channels;for(let c=0;c<(channels<=2?1:3);c++)raw[at+c]=0;if(channels===2||channels===4)raw[at+channels-1]=alpha;}
 const rows=Buffer.alloc((stride+1)*64+(extraRow?1:0));
 for(let y=0;y<64;y++){
  rows[y*(stride+1)]=filter;
  for(let x=0;x<stride;x++){
   const at=y*stride+x,left=x>=channels?raw[at-channels]:0,above=y?raw[at-stride]:0,corner=y&&x>=channels?raw[at-stride-channels]:0;
   const p=left+above-corner,dl=Math.abs(p-left),da=Math.abs(p-above),dc=Math.abs(p-corner);
   const paeth=dl<=da&&dl<=dc?left:da<=dc?above:corner;
   const prediction=[0,left,above,Math.floor((left+above)/2),paeth][filter]??0;
   rows[y*(stride+1)+1+x]=(raw[at]-prediction)&255;
  }
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(wrongWidth?255:256);header.writeUInt32BE(64,4);header[8]=8;header[9]=color;
 let data=invalidData?Buffer.from('invalid zlib'):deflateSync(rows);if(compressedTail)data=Buffer.concat([data,Buffer.from([0])]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',data),chunk('IEND',Buffer.alloc(0))]);
}
function envelope(png,claimedInk=8){return Buffer.from(JSON.stringify({schemaVersion:'mediflow.windows_icu_text_probe.v1',width:256,height:64,inkPixels:claimedInk,pngBytes:png.length,pngSHA256:createHash('sha256').update(png).digest('hex'),pngBase64:png.toString('base64')}));}

test('rejects white PNG even when child claims eight ink pixels',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture({ink:0}))),/independently decoded text is empty/));
test('rejects seven real dark pixels even when child claims eight',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture({ink:7}))),/independently decoded text is empty/));
test('transparent black pixels remain empty after compositing on white',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture({alpha:0}))),/independently decoded text is empty/));
for(const filter of [0,1,2,3,4])test(`independently accepts exactly eight real pixels with PNG filter ${filter}`,()=>{
 const result=verifyWindowsIcuTextOutput(envelope(fixture({filter}),0));assert.equal(result.decodedInkPixels,8);assert.equal(result.inkPixels,0);
});
for(const color of [0,2,4])test(`decodes nonempty 8-bit PNG color ${color}`,()=>assert.equal(verifyWindowsIcuTextOutput(envelope(fixture({color}))).decodedInkPixels,8));
test('rejects corrupt chunk CRC despite matching child PNG digest',()=>{const png=fixture();png[45]^=1;assert.throws(()=>verifyWindowsIcuTextOutput(envelope(png)),/PNG CRC/);});
test('rejects invalid IDAT with valid chunk CRC and matching digest',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture({invalidData:true}))),/header|compression|data/i));
test('rejects inflated bytes exceeding the exact image bound',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture({extraRow:true}))),/larger|bound/i));
test('rejects PNG trailing bytes despite matching digest',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(Buffer.concat([fixture(),Buffer.from([0])]))),/IEND\/trailing/));
test('rejects truncated PNG chunk despite matching digest',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture().subarray(0,-1))),/truncated/));
test('rejects wrong decoded dimensions even when receipt claims 256x64',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture({wrongWidth:true}))),/dimensions/));
test('rejects unsupported scanline filter',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture({filter:5}))),/PNG filter/));
test('rejects compressed trailing bytes within a valid IDAT chunk',()=>assert.throws(()=>verifyWindowsIcuTextOutput(envelope(fixture({compressedTail:true}))),/trailing compressed/));
for(const name of ['IHDR','IDAT'])test(`rejects high-bit ${name} alias with recomputed CRC and digest`,()=>{
 const png=fixture();let cursor=8;
 while(png.toString('latin1',cursor+4,cursor+8)!==name)cursor+=png.readUInt32BE(cursor)+12;
 const end=cursor+12+png.readUInt32BE(cursor),type=Buffer.from(name);type[0]|=0x80;
 const malformed=Buffer.concat([png.subarray(0,cursor),chunk(type,png.subarray(cursor+8,end-4)),png.subarray(end)]);
 assert.throws(()=>verifyWindowsIcuTextOutput(envelope(malformed)),/PNG chunk bound\/type/);
});
