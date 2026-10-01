import { inflateSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(a,b,c) { const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c; }
export function decodePng(bytes, expectedWidth, expectedHeight) {
  if (!Buffer.isBuffer(bytes) || bytes.length>4*1024*1024 || !bytes.subarray(0,8).equals(signature)) throw Error('PNG signature/byte bound');
  let cursor=8, width, height, channels, ended=false, idat=[], idatEnded=false;
  while(cursor<bytes.length) {
    if(cursor+12>bytes.length) throw Error('PNG truncated chunk');
    const size=bytes.readUInt32BE(cursor),type=bytes.toString('ascii',cursor+4,cursor+8),end=cursor+12+size;
    if(size>4*1024*1024 || end>bytes.length || !/^[A-Za-z]{4}$/.test(type)) throw Error('PNG chunk bound');
    const data=bytes.subarray(cursor+8,end-4);
    if(crc32(bytes.subarray(cursor+4,end-4))!==bytes.readUInt32BE(end-4)) throw Error('PNG CRC');
    if(type==='IHDR') {
      if(cursor!==8 || size!==13) throw Error('PNG IHDR order');
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=({0:1,2:3,4:2,6:4})[data[9]];
      if(width!==expectedWidth || height!==expectedHeight || width<1 || width>512 || height<1 || height>256
        || data[8]!==8 || !channels || data[10]!==0 || data[11]!==0 || data[12]!==0) throw Error('PNG frozen dimensions/encoding');
    } else if(type==='IDAT') {
      if(!width || idatEnded) throw Error('PNG IDAT order'); idat.push(data);
    } else if(type==='IEND') {
      if(size!==0 || !idat.length || end!==bytes.length) throw Error('PNG IEND/trailing bytes'); ended=true;
    } else {
      if(idat.length) idatEnded=true;
      if(type[0]===type[0].toUpperCase()) throw Error('PNG unsupported critical chunk');
    }
    cursor=end;
  }
  if(!ended || !width) throw Error('PNG incomplete');
  const stride=width*channels, size=(stride+1)*height;
  const filtered=inflateSync(Buffer.concat(idat),{maxOutputLength:size});
  if(filtered.length!==size) throw Error('PNG decoded byte bound');
  const raw=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++) {
    const filter=filtered[y*(stride+1)]; if(filter>4) throw Error('PNG filter');
    for(let x=0;x<stride;x++) {
      const at=y*stride+x,a=x>=channels?raw[at-channels]:0,b=y?raw[at-stride]:0,c=y&&x>=channels?raw[at-stride-channels]:0;
      const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      raw[at]=(filtered[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  const rgba=Buffer.alloc(width*height*4);
  for(let i=0;i<width*height;i++) {
    const at=i*channels;rgba[i*4]=raw[at];rgba[i*4+1]=channels<=2?raw[at]:raw[at+1];rgba[i*4+2]=channels<=2?raw[at]:raw[at+2];
    rgba[i*4+3]=channels===2?raw[at+1]:channels===4?raw[at+3]:255;
  }
  return {width,height,rgba,sha256:digest(rgba)};
}
export function encodePng(width,height,rgba) {
  if(rgba.length!==width*height*4) throw Error('RGBA size');
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const rows=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)rgba.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  const chunk=(name,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(name,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;};
  return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function unpackMask(encoded,length) {
  const bytes=Buffer.from(encoded,'base64');if(bytes.length!==Math.ceil(length/8))throw Error('Oracle mask size');
  return Uint8Array.from({length},(_,i)=>(bytes[i>>>3]>>>(7-i%8))&1);
}
function dilate(mask,width,height,radius) {
  const result=new Uint8Array(mask.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x])
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)result[(y+dy)*width+x+dx]=1;
  return result;
}
const bounds=(mask,w)=>{let x0=w,y0=mask.length/w,x1=-1,y1=-1;for(let i=0;i<mask.length;i++)if(mask[i]){x0=Math.min(x0,i%w);x1=Math.max(x1,i%w);y0=Math.min(y0,Math.floor(i/w));y1=Math.max(y1,Math.floor(i/w));}return x1<0?null:[x0,y0,x1,y1];};
export const FROZEN_THRESHOLDS=Object.freeze({inkLuminance:128,dilationRadiusPx:1,minimumPrecision:0.96,minimumRecall:0.96,minimumAreaRatio:0.8,maximumAreaRatio:1.25,bboxTolerancePx:2});
export function checkGlyphs(decoded,oracle) {
  if(decoded.width!==oracle.width||decoded.height!==oracle.height||JSON.stringify(oracle.thresholds)!==JSON.stringify(FROZEN_THRESHOLDS))throw Error('Oracle dimensions/threshold drift');
  if(!oracle.glyphs.length){if(oracle.id!=='F0')throw Error('Text fixture cannot have empty oracle');return {pass:decoded.sha256===oracle.referenceRGBASHA256,glyphCount:0,failedGlyphs:[],results:[]};}
  const results=[];
  for(const glyph of oracle.glyphs) {
    const {x,y,width,height}=glyph.roi;
    if(![x,y,width,height].every(Number.isSafeInteger)||x<0||y<0||width<1||height<1||x+width>decoded.width||y+height>decoded.height)throw Error('Oracle ROI');
    const reference=unpackMask(glyph.maskBase64,width*height),observed=new Uint8Array(reference.length);
    let refInk=0,ink=0;
    for(let j=0;j<height;j++)for(let i=0;i<width;i++){
      const at=((y+j)*decoded.width+x+i)*4,a=decoded.rgba[at+3]/255;
      const lum=Math.min(decoded.rgba[at],decoded.rgba[at+1],decoded.rgba[at+2])*a+255*(1-a);
      observed[j*width+i]=lum<128?1:0;ink+=observed[j*width+i];refInk+=reference[j*width+i];
    }
    if(refInk!==glyph.inkPixels||refInk<8||JSON.stringify(bounds(reference,width))!==JSON.stringify(glyph.bbox))throw Error('Empty/corrupt reference glyph');
    const refDilated=dilate(reference,width,height,1),actualDilated=dilate(observed,width,height,1);
    let matchingActual=0,matchingRef=0;
    for(let i=0;i<reference.length;i++){matchingActual+=observed[i]&&refDilated[i]?1:0;matchingRef+=reference[i]&&actualDilated[i]?1:0;}
    const precision=ink?matchingActual/ink:0,recall=matchingRef/refInk,ratio=ink/refInk,bbox=bounds(observed,width);
    const aligned=!!bbox&&bbox.every((n,i)=>Math.abs(n-glyph.bbox[i])<=2);
    const pass=ink>=8&&precision>=0.96&&recall>=0.96&&ratio>=0.8&&ratio<=1.25&&aligned;
    results.push({id:glyph.id,label:glyph.label,inkPixels:ink,referenceInkPixels:refInk,precision,recall,areaRatio:ratio,bbox,pass});
  }
  return {pass:results.every(g=>g.pass),glyphCount:results.length,failedGlyphs:results.filter(g=>!g.pass).map(g=>g.id),results};
}
