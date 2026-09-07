/* @Codex: isolated React fixture and synthetic HTTP; no product server or real models. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
if (!process.env.MEDIFLOW_DATA_DIR) throw new Error('Temporary MEDIFLOW_DATA_DIR required');
const root = process.cwd(); const output = resolve(process.argv[2] ?? '/private/tmp/mediflow-086-release-followup/WUL-691-model-picker-ui');
await mkdir(output, { recursive: true, mode: 0o700 });
const entry = join(output, 'fixture.tsx'); const security = join(output, 'security.ts');
await writeFile(security, 'export function useSecurity(){return {user:null,isAuthenticated:!window.fixtureLocked,isLocked:!!window.fixtureLocked,authRecoveryState:"ready"}}');
await writeFile(entry, `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FunctionPreferencesContent} from '${root}/components/function-models/function-preferences-panel.tsx';
import {FunctionModelPicker,useFunctionModelPicker} from '${root}/components/function-models/function-model-picker.tsx';
function Preview({context,active}){const picker=useFunctionModelPicker('patient_insight',context);const [result,setResult]=useState('');return <section id="preview"><h2>Proposta sintetica</h2><FunctionModelPicker picker={picker}/><button className="ui-btn-primary" disabled={!active||!picker.canGenerate} onClick={async()=>{try{const token=await picker.client.begin();const res=await picker.client.fetch('/api/ai/patient-insight/preview',{method:'POST',body:'{}'});await res.json();if(picker.client.isCurrent(token))setResult('Proposta sintetica ricevuta')}catch{setResult('Nessuna proposta')}}}>Genera fixture</button><p>{result}</p></section>}
function Fixture(){const[active,setActive]=useState(true);const[context,setContext]=useState(1);return <main><h1>Preferenze AI · fixture sintetica</h1><FunctionPreferencesContent active={active}/><Preview context={context} active={active}/><button id="context" onClick={()=>setContext(x=>x+1)}>Cambia contesto</button><button id="lock" onClick={()=>{window.fixtureLocked=true;setActive(false)}}>Blocca fixture</button></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`);
await build({ entryPoints: [entry], bundle: true, outfile: join(output,'fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: join(root,'tsconfig.json'), alias: { '@/components/security-provider': security, 'react/jsx-runtime': join(root,'node_modules/react/jsx-runtime.js') }, define: { 'process.env.NODE_ENV': '"test"' } });
const utilities = await postcss([tailwind({ base: root })]).process(`@import "tailwindcss" source(none); @source "${root}/components/settings/settings-ui.tsx"; @source "${root}/components/function-models";`, { from: join(root,'app/model-fixture.css') });
const tokens = (await Promise.all(['lume-tokens.css','lume-motion.css','runtime-twin.css'].map(file=>readFile(join(root,'app',file),'utf8')))).join('\n');
await writeFile(join(output,'base.css'), utilities.css+'\n'+tokens+'\nbody{margin:0;background:var(--lume-surface-canvas);color:var(--lume-ink);font-family:system-ui}main{width:calc(100% - 32px);max-width:1080px;margin:32px auto}#preview{margin-top:32px;max-width:480px}button{min-height:44px}');
await writeFile(join(output,'index.html'), '<!doctype html><html lang="it" data-runtime-twin-design="proposal" data-ui-style="redesign" data-twin-composition="stream"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fixture sintetica picker</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
const server=createServer(async(req,res)=>{const name=req.url==='/'?'index.html':req.url?.slice(1); if(!['index.html','base.css','fixture.css','fixture.js'].includes(name)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(join(output,name)))});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const origin=`http://127.0.0.1:${server.address().port}`;
const r=d=>`sha256_${d.repeat(64)}`,o=d=>`model_option_${d.repeat(32)}`;
function initial(){return {schemaVersion:'mediflow.function-preferences.v1',revision:r('a'),catalogRevision:r('b'),check:'configuration_only',apply:'denied',presets:['host_defaults','all_off'],functions:['patient_insight','smart_import','document_synthesis','treatment_reasoning'].map(id=>({id,enabled:true,defaultModelOptionId:o('a'),defaultSource:'host_configuration',bindingState:'current',options:[{modelOptionId:o('a'),label:'synthetic-local:small',provider:'ollama',state:'available_unqualified'},{modelOptionId:o('b'),label:'synthetic-local:large',provider:'ollama',state:'available_unqualified'}]}))}}
let state=initial(), revision=12, conflict=false, unavailable=false, calls=[], login='connected';
const browser=await chromium.launch({headless:true});
const results=[];
try {
 const page=await browser.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url()); if(url.origin!==origin)throw new Error('Unexpected external request');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  calls.push({path:url.pathname,method:req.method(),headers:req.headers(),body:req.postData()});
  let body;
  if(url.pathname==='/api/settings/ai/chatgpt/status')body={state:login,notice:null,plan:null,loginExpiresAt:null,actions:[],inferenceEnabled:false,executionBlock:'data_boundary_unqualified'};
  else if(url.pathname==='/api/ai/patient-insight/preview')body={synthetic:true};
  else if(url.pathname.startsWith('/api/settings/ai/functions')){
   if(unavailable)return route.fulfill({status:503,body:'{}'});
   if(req.method()==='GET')body=state;
   else {if(conflict)return route.fulfill({status:409,body:'{}'});const command=req.postDataJSON();const proposed=structuredClone(state);proposed.revision=r((revision%16).toString(16));
    for(const row of proposed.functions){if(command.action==='preset'){if(command.presetId==='all_off')row.enabled=false;else {row.defaultSource='host_configuration';row.defaultModelOptionId=o('a')}}else if(row.id===command.functionId){row.enabled=command.enabled;row.defaultModelOptionId=command.defaultModelOptionId??o('a');row.defaultSource=command.defaultModelOptionId?'saved_preference':'host_configuration'}}
    if(url.pathname.endsWith('/preview'))body={schemaVersion:'mediflow.function-preferences-preview.v1',command,proposed,writesPerformed:0};else{state=proposed;revision++;body=state}}
  }else throw new Error(`Unexpected API ${url.pathname}`);
  return route.fulfill({json:body});
 });
 for(const width of [390,965,1440]){
  state=initial();await page.setViewportSize({width,height:1000});await page.goto(origin);await page.getByRole('heading',{name:'Quadro paziente',exact:true}).waitFor();
  assert.equal(await page.locator('[data-testid="function-preferences"] article').count(),4);
  assert.equal(calls.some(c=>c.path==='/api/settings/ai/chatgpt/models'),false);
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('article')].map(e=>({radius:getComputedStyle(e).borderRadius,width:e.getBoundingClientRect().width})),targets:[...document.querySelectorAll('[data-testid="function-preferences"] button,[data-testid="function-preferences"] select')].map(e=>e.getBoundingClientRect().height)}));
  assert.ok(geometry.scroll<=width);assert.ok(geometry.cards.every(c=>c.radius==='12px'));assert.ok(geometry.targets.every(h=>h>=44));results.push(geometry);
  await page.screenshot({path:join(output,`preferences-${width}.png`),fullPage:true});
 }
 const first=page.locator('article').first();await first.getByText('Stato e dettagli',{exact:true}).focus();await page.keyboard.press('Enter');await first.getByText(/ChatGPT collegato/).waitFor();
 const select=first.getByLabel('Modello predefinito · Quadro paziente', {exact:true});await select.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await select.evaluate(e=>document.activeElement===e),true);
 await page.getByRole('button',{name:'Spegni tutte',exact:true}).click();const proposal=page.getByRole('region',{name:'Anteprima impostazioni'});await proposal.waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Anteprima impostazioni');await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Applica alle impostazioni'}).evaluate(e=>document.activeElement===e),true);
 assert.equal(calls.filter(c=>c.path==='/api/settings/ai/functions'&&c.method==='POST').length,0);assert.match(await proposal.innerText(),/spento/);
 await page.getByRole('button',{name:'Annulla proposta'}).click();assert.equal(await proposal.count(),0);
 await page.getByRole('button',{name:'Spegni tutte',exact:true}).click();await page.getByRole('button',{name:'Applica alle impostazioni'}).click();await page.getByText('Impostazioni salvate e rilette. Nessuna modifica clinica.').waitFor();
 assert.ok(state.functions.every(f=>!f.enabled));
 await page.getByRole('button',{name:'Ripristina modelli host'}).click();await proposal.waitFor();conflict=true;await page.getByRole('button',{name:'Applica alle impostazioni'}).click();await page.getByRole('alert').filter({hasText:/decidi di nuovo/}).waitFor();assert.equal(await page.getByText('Impostazioni salvate e rilette. Nessuna modifica clinica.').count(),0);conflict=false;
 state=initial();await page.goto(origin);const picker=page.locator('#preview');assert.equal(await picker.locator('select').count(),0);await picker.getByRole('button',{name:'Modello per questa proposta',exact:true}).click();await picker.getByLabel('Modello per questa proposta',{exact:true}).waitFor({timeout:3000}).catch(async error=>{console.log(await picker.innerText());console.log(errors);throw error});await picker.getByLabel('Modello per questa proposta',{exact:true}).selectOption(o('b'));await picker.getByRole('button',{name:'Genera fixture'}).click();await picker.getByText('Proposta sintetica ricevuta').waitFor();
 const preview=calls.filter(c=>c.path==='/api/ai/patient-insight/preview').at(-1);assert.deepEqual(JSON.parse(preview.headers['x-mediflow-function-model']),{modelOptionId:o('b'),expectedCatalogRevision:r('b')});assert.equal(await picker.getByRole('button',{name:'Genera fixture'}).isDisabled(),true);
 await page.locator('#context').click();assert.equal(await picker.locator('select').count(),0);
 await picker.getByRole('button',{name:'Modello per questa proposta',exact:true}).click();await picker.getByLabel('Modello per questa proposta',{exact:true}).waitFor({timeout:3000}).catch(async error=>{console.log(await picker.innerText());console.log(errors);throw error});await picker.getByLabel('Modello per questa proposta',{exact:true}).selectOption(o('b'));state.catalogRevision=r('e');await picker.getByRole('button',{name:'Genera fixture'}).click();await picker.getByRole('alert').filter({hasText:/nessun modello alternativo/}).waitFor();
 assert.equal(calls.filter(c=>c.path==='/api/ai/patient-insight/preview').length,1);
 unavailable=true;await page.getByRole('button',{name:'Rileggi impostazioni',exact:true}).click();await page.locator('[data-testid="function-preferences"]').getByRole('alert').waitFor();unavailable=false;
 state=initial();state.functions[0].options=[];state.functions[0].bindingState='unsupported';state.functions[1].options.forEach(o=>o.state='unavailable');await page.goto(origin);await page.getByText('Default non disponibile.',{exact:true}).waitFor();await page.screenshot({path:join(output,'unavailable.png'),fullPage:true});
 await page.locator('#lock').click();await page.getByText('Sblocca MediFlow per gestire le preferenze.').waitFor();assert.equal(await page.locator('[data-testid="function-preferences"] article').count(),0);
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 await writeFile(join(output,'browser-results.json'),JSON.stringify({geometries:results,states:['presets','preview','cancel','apply_reread','CAS409','connected_unqualified','empty','unavailable','override','single_use','context_reset','stale_selection','locked'],externalRequests:0,pageErrors:errors},null,2));
 console.log('PASS: 3 widths, keyboard, 44px, 12px, preview/apply/CAS, picker header/currentness/lock; synthetic only.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
