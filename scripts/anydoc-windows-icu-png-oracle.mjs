// Pure parent-side oracle for the single synthetic text probe; no renderer imports.
import {inflateSync} from 'node:zlib';

const demand=(condition,message)=>{if(!condition)throw Error(message);};
function crc32(bytes){
 let crc=0xffffffff;
 for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function paeth(a,b,c){const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;}

export function countWindowsIcuPngInk(png){
 demand(Buffer.isBuffer(png)&&png.length>=57&&png.length<=128*1024
  &&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG signature/byte bound');
 let cursor=8,channels=0,ended=false,dataEnded=false;const parts=[];
 while(cursor<png.length){
  demand(cursor+12<=png.length,'PNG truncated chunk');
  const length=png.readUInt32BE(cursor),type=png.toString('latin1',cursor+4,cursor+8),end=cursor+12+length;
  demand(end<=png.length&&/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type),'PNG chunk bound/type');
  demand(crc32(png.subarray(cursor+4,end-4))===png.readUInt32BE(end-4),'PNG CRC');
  const data=png.subarray(cursor+8,end-4);
  if(type==='IHDR'){
   demand(cursor===8&&length===13,'PNG IHDR order');
   channels=({0:1,2:3,4:2,6:4})[data[9]];
   demand(data.readUInt32BE(0)===256&&data.readUInt32BE(4)===64&&data[8]===8&&channels
    &&data[10]===0&&data[11]===0&&data[12]===0,'PNG dimensions/encoding');
  }else if(type==='IDAT'){
   demand(channels&&!dataEnded,'PNG IDAT order');parts.push(data);
  }else if(type==='IEND'){
   demand(length===0&&parts.length&&end===png.length,'PNG IEND/trailing bytes');ended=true;
  }else{
   demand(channels&&type[0]===type[0].toLowerCase()&&type!=='tRNS','PNG unsupported chunk');
   if(parts.length)dataEnded=true;
  }
  cursor=end;
 }
 demand(ended,'PNG incomplete');
 const stride=256*channels,expected=(stride+1)*64,compressed=Buffer.concat(parts);
 const inflated=inflateSync(compressed,{maxOutputLength:expected,info:true});
 demand(inflated.buffer.length===expected&&inflated.engine.bytesWritten===compressed.length,'PNG decoded byte bound/trailing compressed data');
 const rows=inflated.buffer,raw=Buffer.alloc(stride*64);
 for(let y=0;y<64;y++){
  const filter=rows[y*(stride+1)];demand(filter<=4,'PNG filter');
  for(let x=0;x<stride;x++){
   const at=y*stride+x,a=x>=channels?raw[at-channels]:0,b=y?raw[at-stride]:0,c=y&&x>=channels?raw[at-stride-channels]:0;
   const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
   raw[at]=(rows[y*(stride+1)+1+x]+predictor)&255;
  }
 }
 let inkPixels=0;
 for(let i=0;i<256*64;i++){
  const at=i*channels,shade=channels<=2?raw[at]:Math.min(raw[at],raw[at+1],raw[at+2]);
  const alpha=channels===2?raw[at+1]:channels===4?raw[at+3]:255;
  if(shade*alpha/255+255*(1-alpha/255)<128)inkPixels++;
 }
 demand(inkPixels>=8,'PNG independently decoded text is empty');
 return inkPixels;
}
