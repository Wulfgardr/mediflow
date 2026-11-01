import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.argv[2],file=process.argv[3];
globalThis.DOMMatrix=class {};globalThis.Path2D=class {};globalThis.ImageData=class {};
const pdfjs=await import(pathToFileURL(root+'/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const {checkPdfOperators}=await import(pathToFileURL(root+'/components/document-viewer-pdf-resources.ts'));
const {rejectPdfWorkerFailure}=await import(pathToFileURL(root+'/components/document-viewer-pdf-core.ts'));
const {assertImageSize}=await import(pathToFileURL(root+'/components/document-viewer-policy.ts'));
class Fonts{async fetch({filename}){return new Uint8Array(fs.readFileSync(root+'/node_modules/pdfjs-dist/standard_fonts/'+filename));}}
class NoAuxiliary{async fetch(){throw new Error('auxiliary resource unavailable');}}
const task=pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(file)),fontExtraProperties:true,isEvalSupported:false,enableXfa:false,useWorkerFetch:false,CMapReaderFactory:NoAuxiliary,StandardFontDataFactory:Fonts,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,disableRange:true,disableStream:true,disableAutoFetch:true,isOffscreenCanvasSupported:false,maxImageSize:12000000,verbosity:0});
const result={glyphs:[],fonts:[],failures:[]};
try{
 const doc=await task.promise;task._worker.port.addEventListener('message',e=>rejectPdfWorkerFailure(e.data,error=>result.failures.push(error.code)));
 for(let n=1;n<=doc.numPages;n++){
  const page=await doc.getPage(n),list=await page.getOperatorList({intent:'display',annotationMode:pdfjs.AnnotationMode.DISABLE});
  try{checkPdfOperators(list,{image:pdfjs.OPS.paintImageXObject,inline:pdfjs.OPS.paintInlineImageXObject,mask:pdfjs.OPS.paintImageMaskXObject,repeat:pdfjs.OPS.paintImageXObjectRepeat});}catch(e){result.failures.push(e.code??'invalid_pdf');}
  const seen=new Set();
  for(let i=0;i<list.fnArray.length;i++){
   const op=list.fnArray[i],args=list.argsArray[i];
   if(op===pdfjs.OPS.showText)result.glyphs.push(...args[0].filter(x=>x&&typeof x==='object'));
   if(op===pdfjs.OPS.setFont){const font=page.commonObjs.get(args[0]);const properties=Object.fromEntries(Object.entries(font).filter(([k])=>k!=='data'));result.fonts.push({properties,dataSha256:font.data?createHash('sha256').update(font.data).digest('hex'):null});}
   if(op===pdfjs.OPS.paintImageXObject||op===pdfjs.OPS.paintImageXObjectRepeat){const id=args[0];if(seen.has(id))continue;seen.add(id);const pool=id.startsWith('g_')?page.commonObjs:page.objs;const image=await new Promise(resolve=>pool.get(id,resolve));try{assertImageSize(image.width,image.height);}catch(e){result.failures.push(e.code??'invalid_pdf');}}
  }
  page.cleanup();
 }
}catch(e){result.failures.push(e.code??e.name);}finally{await task.destroy();}
console.log(JSON.stringify(result));
