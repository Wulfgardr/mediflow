import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {build} from 'esbuild';

const origin='http://127.0.0.1:48976';
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
import {PatientSheetActionsMenu} from './components/patient-sheet-actions-menu';
window.calls=[];
createRoot(document.getElementById('root')).render(<PatientSheetActionsMenu editHref="/patients/synthetic/edit" canShareFhirFile={true}
 onExportFhir={()=>window.calls.push('export')} onShareFhir={()=>window.calls.push('share')} onReportPdf={()=>window.calls.push('pdf')}
 leadingActions={[{label:'Accesso assistente',onSelect:()=>window.calls.push('assistant')},{label:'Gestisci checkup',onSelect:()=>window.calls.push('checkup')}]}/>);`;

test('header actions are an accessible ordered menu with unchanged links and callbacks', {timeout:30000},async t=>{
 assert.ok(process.env.MEDIFLOW_DATA_DIR?.trim());
 const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'fixture/bundle.js',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env':'{}','process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:320,height:720}});
 await page.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="it"><body><div id="root"></div><button id="outside">Fuori</button><script src="/bundle.js"></script></body></html>'});
  else if(path==='/bundle.js')await route.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text});
  else await route.abort();
 });
 await page.goto(origin);
 const trigger=page.getByRole('button',{name:'Azioni',exact:true});
 await trigger.focus();await page.keyboard.press('ArrowDown');
 const menu=page.getByRole('menu',{name:'Azioni scheda',exact:true});
 await expect(menu).toBeVisible({timeout:1000});
 const names=['Accesso assistente','Gestisci checkup','Modifica','Esporta FHIR','Condividi FHIR','Report PDF','Archivia'];
 await expect(menu.getByRole('menuitem')).toHaveText(names);
 await expect(menu.getByRole('menuitem').first()).toBeFocused();
 await page.keyboard.press('ArrowUp');await expect(menu.getByRole('menuitem').last()).toBeFocused();
 await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
 await page.keyboard.press('End');await expect(menu.getByRole('menuitem').last()).toBeFocused();
 for(const label of ['Modifica','Archivia'])await expect(menu.getByRole('menuitem',{name:label,exact:true})).toHaveAttribute('href','/patients/synthetic/edit');
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
 for(const [label,call] of [['Accesso assistente','assistant'],['Gestisci checkup','checkup'],['Esporta FHIR','export'],['Condividi FHIR','share'],['Report PDF','pdf']]){
  await trigger.click();await menu.getByRole('menuitem',{name:label,exact:true}).click();await expect(menu).toBeHidden();
  assert.equal(await page.evaluate(()=> (window as unknown as {calls:string[]}).calls.at(-1)),call);
 }
 await trigger.focus();await page.keyboard.press('ArrowUp');await expect(menu.getByRole('menuitem').last()).toBeFocused();
 await page.keyboard.press('Tab');await expect(menu).toBeHidden();
 await trigger.click();await page.locator('#outside').click();await expect(menu).toBeHidden();
});
