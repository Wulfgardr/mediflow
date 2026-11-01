import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

for (const mask of ['smask', 'mask']) test(`real PDF ${mask} refuses the resolved oversized image; predecode mask quota remains open`, t => {
    const script = `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      globalThis.DOMMatrix=class {}; globalThis.Path2D=class {}; globalThis.ImageData=class {};
      const allocations=[], Original=Uint8ClampedArray;
      globalThis.Uint8ClampedArray=new Proxy(Original,{construct(target,args){
        if(typeof args[0]==='number' && args[0]>=12000000) allocations.push(args[0]);
        return Reflect.construct(target,args);
      }});
      const pdfjs=await import(${JSON.stringify(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href)});
      const {assertImageSize}=await import(${JSON.stringify(new URL('./document-viewer-policy.ts', import.meta.url).href)});
      const {rejectPdfWorkerFailure}=await import(${JSON.stringify(new URL('./document-viewer-pdf-core.ts', import.meta.url).href)});
      const task=pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(new URL(${JSON.stringify(new URL('../scripts/fixtures/preview-large-' + mask + '.pdf', import.meta.url).href)}))),
        maxImageSize:12000000, stopAtErrors:true, isOffscreenCanvasSupported:false, isEvalSupported:false, verbosity:0});
      const messages=[];
      try {
        const doc=await task.promise;
        task._worker.port.addEventListener('message', e=>rejectPdfWorkerFailure(e.data,error=>messages.push(error.code)));
        const page=await doc.getPage(1), list=await page.getOperatorList();
        if(!messages.length) {
          const at=list.fnArray.findIndex(code=>code===pdfjs.OPS.paintImageXObject);
          assert.ok(at>=0);
          const image=await new Promise(resolve=>page.objs.get(list.argsArray[at][0],resolve));
          assert.throws(()=>assertImageSize(image.width,image.height),{code:'image_limit'});
        }
        console.log(JSON.stringify({mask:${JSON.stringify(mask)},allocations,predecodeBounded:allocations.length===0,messages}));
      } finally {await task.destroy();}
    `;
    const result = spawnSync(process.execPath, ['--no-addons', '--import', new URL('../scripts/register-strip-types-loader.mjs', import.meta.url).href,
        '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const observation = JSON.parse(result.stdout.trim().split('\n').at(-1));
    t.diagnostic(JSON.stringify(observation));
});
