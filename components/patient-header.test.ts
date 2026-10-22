import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {build} from 'esbuild';

const origin='http://127.0.0.1:48977';
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Plus} from 'lucide-react';
import {PrivacyProvider} from './components/privacy-provider';
import {RuntimeTwinDesignProvider,useRuntimeTwinPendingForm} from './components/runtime-twin-design';
import {Kree8WorkspaceShell} from './components/kree8/kree8-workspace-shell';
function Form({name}){const [open,setOpen]=useState(false);useRuntimeTwinPendingForm(open);return <><button onClick={()=>setOpen(!open)}>{name}</button>{open?<form><input aria-label={name+' bozza'} defaultValue="Bozza sintetica"/><button className="mf-button-primary">Registra</button></form>:null}</>}
function Fixture(){const [full,setFull]=useState(true);return <PrivacyProvider><RuntimeTwinDesignProvider>
<Kree8WorkspaceShell variant="clinical" eyebrow="Scheda" title="Nome sintetico molto lungo per la testata" subtitle="" backHref="/" backLabel="Pazienti"
patientDetails={full?{sexLabel:'Femminile',ageLabel:'68 anni',birthDateLabel:'17/04/1958',taxCode:'SYNTHETIC-HEADER-2026',allergies:['Amoxicillina sintetica','Allergia sintetica con descrizione molto lunga per verificare il ritorno a capo']}: {}}
primaryAction={{href:'/patients/synthetic/entries/new',label:'Nuova voce',icon:Plus}}><Form name="Primo form"/><Form name="Secondo form"/><button onClick={()=>setFull(!full)}>Cambia dati</button></Kree8WorkspaceShell>
</RuntimeTwinDesignProvider></PrivacyProvider>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;

test('patient header shows only explicit identity, preserves allergy text and yields to every registered form', {timeout:30000},async t=>{
 assert.ok(process.env.MEDIFLOW_DATA_DIR?.trim());
 const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'fixture/bundle.js',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'pathname',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'pathname',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const usePathname=()=>'/patients/synthetic/modules';"}));}}]});
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:320,height:720}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/')await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="it"><head><link rel="stylesheet" href="/bundle.css"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>'});
  else if(pathname==='/bundle.js')await route.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text});
  else if(pathname==='/bundle.css')await route.fulfill({contentType:'text/css',body:bundle.outputFiles.find(f=>f.path.endsWith('.css'))!.text});
  else await route.abort();
 });
 await page.goto(origin);
 const header=page.getByTestId('lume-scheda-header');
 await expect(header).toContainText('Femminile');await expect(header).toContainText('17/04/1958');await expect(header).toContainText('68 anni');
 await expect(header.locator('.type-code')).toHaveText('SYNTHETIC-HEADER-2026');
 await expect(header.getByRole('list',{name:'Allergie'}).getByRole('listitem')).toHaveCount(2);
 await expect(header.getByRole('list',{name:'Allergie'})).toContainText('▲');
 await expect(header.locator('.mf-button-primary')).toHaveCount(1);
 const draft=page.getByRole('textbox',{name:'Primo form bozza',exact:true});
 await page.getByRole('button',{name:'Primo form',exact:true}).click();await draft.fill('Bozza conservata');
 await expect(header.locator('.mf-button-primary')).toHaveCount(0);await expect(header.locator('.mf-button-secondary')).toHaveCount(1);
 await page.getByRole('button',{name:'Secondo form',exact:true}).click();
 await page.getByRole('button',{name:'Secondo form',exact:true}).click();
 await expect(header.locator('.mf-button-primary')).toHaveCount(0);await expect(draft).toHaveValue('Bozza conservata');
 await page.getByRole('button',{name:'Primo form',exact:true}).click();await expect(header.locator('.mf-button-primary')).toHaveCount(1);
 await expect(header.getByRole('link',{name:'Nuova voce',exact:true})).toHaveAttribute('href','/patients/synthetic/entries/new');
 await page.getByRole('button',{name:'Cambia dati',exact:true}).click();
 await expect(header.getByRole('list',{name:'Allergie'})).toHaveCount(0);await expect(header).not.toContainText(/non disponibile|Femminile|SYNTHETIC-HEADER-2026|Amoxicillina/);
 assert.deepEqual(errors,[]);
});
