import {expect,test} from '@playwright/test';
import {bootstrapUnlockedSession,openPatientSection} from './utils';

for (const width of [1440, 390]) for (const theme of ['giorno', 'grafite']) test(`patient header keeps two entrances, fixed menu destinations and hands priority to a form ${theme} ${width}`,async({page})=>{
 await page.setViewportSize({width,height:960});
 await bootstrapUnlockedSession(page,process.env.E2E_PIN||'1234');
 const id=await page.evaluate(async()=>{
  const response=await fetch('/api/patients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:'Ada',lastName:'Testata sintetica',taxCode:`HEADER-SYNTHETIC-${crypto.randomUUID()}`,birthDate:'1980-12-31T00:00:00Z'})});
  if(!response.ok)throw new Error(`fixture: ${response.status}`);
  return (await response.json()).id as string;
 });
 await page.goto(`/patients/${id}/modules`);
 await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='grafite');document.documentElement.classList.toggle('light',theme==='giorno');},theme);
 const header=page.getByTestId('lume-scheda-header');
 const checkPanel=async(name:string)=>{
  const panel=page.getByRole('dialog',{name,exact:true});
  await expect(panel).toBeFocused();
  const panelBox=await panel.boundingBox(), headerBox=await header.boundingBox();
  expect(panelBox).not.toBeNull();expect(headerBox).not.toBeNull();
  expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y+headerBox!.height);
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);expect(panelBox!.x+panelBox!.width).toBeLessThanOrEqual(width);
  expect(panelBox!.y+panelBox!.height).toBeLessThanOrEqual(960);
  for(const control of await header.locator('a:visible,button:visible').all()){
   if(await control.evaluate(el=>Boolean(el.closest('[role=dialog]'))))continue;
   if(await control.getAttribute('aria-label')==='Chiudi pannello azioni')continue;
   expect(await control.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  }
 };
 await expect(header.getByRole('link',{name:'Nuova voce',exact:true})).toHaveAttribute('href',`/patients/${id}/entries/new`);
 await expect(header.locator('a:visible,button:visible,summary:visible')).toHaveCount(2);
 const trigger=header.getByRole('button',{name:'Azioni',exact:true});
 await trigger.focus();await page.keyboard.press('ArrowDown');
 const menu=page.getByRole('menu',{name:'Azioni scheda',exact:true});
 await expect(menu).toBeVisible();
 const names=['Accesso assistente','Gestisci checkup','Modifica','Esporta FHIR','Report PDF','Archivia'];
 await expect(menu.getByRole('menuitem')).toHaveText(names);
 await expect(menu.locator('svg, img, [role="img"]')).toHaveCount(0);
 await expect(menu.getByRole('menuitem',{name:'Accesso assistente',exact:true})).toBeFocused();
 await page.keyboard.press('ArrowUp');await expect(menu.getByRole('menuitem',{name:'Archivia',exact:true})).toBeFocused();
 await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');
 await expect(menu.getByRole('menuitem',{name:'Gestisci checkup',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
 await trigger.click();await menu.getByRole('menuitem',{name:'Accesso assistente',exact:true}).click();
 await checkPanel('Accesso assistente');
 await expect(page.getByLabel('Dati consentiti')).toHaveValue('none');
 await expect(page.getByRole('button',{name:'Conferma e attiva assistente',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 await trigger.click();await menu.getByRole('menuitem',{name:'Gestisci checkup',exact:true}).click();
 await checkPanel('Gestisci checkup');
 const steps=page.getByRole('list',{name:'Passi per gestire il checkup'});
 await expect(steps.getByRole('listitem')).toHaveCount(3);
 await expect(page.getByRole('button',{name:'Revoca definitivamente la gestione',exact:true})).toHaveClass(/mf-button-destructive/);
 await expect(page.getByRole('button',{name:'Abilita gestione checkup',exact:true})).toHaveAccessibleDescription('Abilitazione e revoca richiedono il PIN di almeno 4 caratteri.');
 await expect(page.getByLabel('Reinserisci il PIN per autorizzare')).toBeVisible();
 await expect(page.getByRole('button',{name:'Abilita gestione checkup',exact:true})).toBeDisabled();
 await page.keyboard.press('Escape');
 await trigger.click();await expect(menu.getByRole('menuitem',{name:'Modifica',exact:true})).toHaveAttribute('href',`/patients/${id}/edit`);
 await expect(menu.getByRole('menuitem',{name:'Archivia',exact:true})).toHaveAttribute('href',`/patients/${id}/edit`);
 await menu.getByRole('menuitem',{name:'Esporta FHIR',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Esporta FHIR');
 await page.getByRole('dialog').getByRole('button',{name:/Annulla|Chiudi/}).first().click();
 await openPatientSection(page,'terapie');await page.locator('#terapie').getByRole('button',{name:'Nuova terapia',exact:true}).click();
 await expect(header.locator('.mf-button-primary')).toHaveCount(0);
 await expect(header.getByRole('link',{name:'Nuova voce',exact:true})).toHaveClass(/mf-button-secondary/);
 await page.locator('#terapie').getByRole('button',{name:'Annulla',exact:true}).click();
 await expect(header.locator('.mf-button-primary')).toHaveCount(1);
});
