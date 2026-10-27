import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

async function installWorklistFixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const patient = (id: string, birthDate: string | null, isArchived = false) => ({ id, firstName: 'Persona', lastName: `Inventata ${id}`,
    taxCode: `W21SYNTH${id}`, birthDate, isArchived, isAdi: true, status: 'active',
    diagnoses: [{ system: 'TEST', code: id, description: `Categoria sintetica ${id}` }],
    createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' });
  const known = patient('A', '1970-04-12T00:00:00.000Z');
  const state = { patients: [known], status: 200, hold: null as Promise<void> | null };
  const calls: { path: string; search: string; status: number; scope: string | null; patientIds?: string[] }[] = [];
  const blocked: string[] = [], uiWrites: unknown[] = [];
  const uiDefaults: Record<string, boolean> = { uiReduceMotion: false, uiReduceTransparency: false };
  const handler = async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const deny = () => { blocked.push(`${method} ${url.href}`); return route.abort(); };
    if (url.origin !== origin) return deny();
    const key = path.startsWith('/api/settings/') ? path.slice('/api/settings/'.length) : undefined;
    if (method === 'GET' && key && Object.hasOwn(uiDefaults, key)) return route.fulfill({ json: { key, value: false } });
    if (method === 'GET' && key) return route.fulfill({ json: { key, value: null } });
    if (method === 'GET' && path === '/api/settings') return route.fulfill({ json: {} });
    if (method === 'POST' && path === '/api/settings') {
      const body = request.postDataJSON();
      if (body && Object.keys(body).length === 2 && Object.hasOwn(uiDefaults, body.key) && body.value === false) {
        uiWrites.push(body); return route.fulfill({ json: body });
      }
      return deny();
    }
    if (path === '/api/plugin-local-ui/pairing' && method === 'GET') return route.fulfill({ json: { available: false, pending: [], active: [] } });
    if (path === '/api/siss/session-status' && method === 'GET') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
    if (path === '/api/clinical-agenda/candidates' && method === 'GET') return route.fulfill({ json: { enabled: false,
      stats: { candidates: 0, parsed: 0, ignored: 0, invalid: 0 }, candidates: [], sources: [] } });
    if (path === '/api/patients' && method === 'GET') {
      const status = state.status, rows = structuredClone(state.patients), hold = state.hold;
      const cookie = await request.headerValue('cookie');
      const scope = cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('ambulatory_id=')) ?? null;
      calls.push({ path, search: url.search, status, scope, patientIds: rows.map(row => row.id) });
      if (hold) await hold;
      return route.fulfill({ status, json: status === 200 ? rows : { error: 'SYNTHETIC_WORKLIST_UNAVAILABLE' } });
    }
    if (path === '/api/system/audit' && method === 'GET' && url.searchParams.get('view') === 'summary') {
      calls.push({ path, search: url.search, status: 200, scope: null });
      return route.fulfill({ json: { days: Number(url.searchParams.get('days')), totalEvents: 7, distinctActors: 2,
        outcomes: { success: 5, failure: 1, denied: 1 }, sourceSurfaces: { web: 7, native: 0, api: 0, job: 0 },
        topEventTypes: [{ eventType: 'synthetic_event', count: 7 }], isTruncated: false } });
    }
    if (/^\/api\/(checkups|entries|therapies|observations|attachments|conversations|messages)(?:\/|$)/.test(path)) return method === 'GET' ? route.fulfill({ json: [] }) : deny();
    const ownedAuth = ['/api/auth/check', '/api/auth/setup', '/api/auth/login', '/api/auth/lock', '/api/auth/rewrap-master-key'].includes(path);
    const ownedRead = method === 'GET' && (path === '/api/onboarding/work-profile' || path === '/api/system/revision');
    if (path.startsWith('/api/') && !ownedAuth && !ownedRead) return deny();
    return route.continue();
  };
  await page.route('**/*', handler);
  return { state, calls, blocked, uiWrites, known, close: () => page.unroute('**/*', handler) };
}

test('Worklist: observed read states and one primary action', async ({page,baseURL},info) => {
  if(process.env.MF085_SYNTHETIC_E2E!=='1'||!process.env.MEDIFLOW_DATA_DIR||!baseURL||new URL(baseURL).hostname!=='127.0.0.1'||new URL(baseURL).port==='3000')throw Error('Owned synthetic archive and loopback required');
  const baseline=process.env.WORKLIST_READ_BASELINE==='1',directory=process.env.WORKLIST_READ_SCREENSHOTS;
  const fixture=await installWorklistFixture(page,baseURL),frames:unknown[]=[],errors:string[]=[];
  const worklist=page.getByTestId('lume-worklist'),lens=page.getByTestId('lume-patient-lens');
  const count=worklist.locator('header').first().getByText(/^\d+ risultat[oi]$/);
  const error=worklist.getByRole('alert');
  let release=()=>{};
  page.on('pageerror',value=>errors.push(value.message));
  const check=async(condition:()=>Promise<boolean>,expected:boolean)=>{
    if(baseline)expect.soft(await condition()).toBe(expected);else await expect.poll(condition).toBe(expected);
  };
  const gallery=async(state:string,target:Locator)=>{
    const palettes=new Map<string,string>();
    for(const theme of ['giorno','grafite'])for(const width of [1440,768]){
      await page.setViewportSize({width,height:1000});
      await page.evaluate(value=>{localStorage.setItem('mediflow-theme',value);document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(value);document.documentElement.style.colorScheme=value},theme==='giorno'?'light':'dark');
      await target.scrollIntoViewIfNeeded();
      const probe=await target.evaluate(element=>{
        const r=element.getBoundingClientRect(),x=r.x+Math.min(50,r.width/2),y=r.y+Math.min(15,r.height/2),hit=document.elementFromPoint(x,y);
        return {text:element.textContent,rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},hit:element===hit||element.contains(hit),color:getComputedStyle(element).color,palette:getComputedStyle(document.documentElement).getPropertyValue('--lume-ink'),activeElement:{tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,80)}};
      });
      frames.push({state,theme,width,...probe});palettes.set(theme,probe.palette);
      if(directory){await mkdir(directory,{recursive:true});await page.screenshot({path:`${directory}/${state}-${theme}-${width}.png`,fullPage:false,animations:'disabled'})}
      expect(probe.hit).toBe(true);expect(probe.rect.x).toBeGreaterThanOrEqual(-1);expect(probe.rect.y).toBeGreaterThanOrEqual(-1);
      expect(probe.rect.x+probe.rect.width).toBeLessThanOrEqual(probe.viewport.width+1);expect(probe.rect.y+probe.rect.height).toBeLessThanOrEqual(probe.viewport.height+1);
      await assertNoHorizontalOverflow(page,[{label:'document',selector:'document'},{label:'worklist',selector:'[data-testid="lume-worklist"]'}]);
    }
    expect(palettes.get('giorno')).not.toBe(palettes.get('grafite'));
    await page.setViewportSize({width:1440,height:1000});
  };
  try{
    await page.setViewportSize({width:1440,height:1000});
    await page.context().addCookies([{name:'ambulatory_id',value:'w21c-synthetic-a',url:baseURL}]);
    await bootstrapUnlockedSession(page,'1234');fixture.state.status=503;fixture.state.hold=new Promise<void>(resolve=>{release=resolve});
    const before=fixture.calls.filter(call=>call.path==='/api/patients').length;
    const failed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/patients'&&response.status()===503);
    await page.goto('/?area=incarico');
    await expect.poll(()=>fixture.calls.filter(call=>call.path==='/api/patients').length).toBeGreaterThan(before);
    const pending=worklist.getByRole('status',{name:'Caricamento pazienti',exact:true});await expect(pending).toBeVisible();
    const pendingTarget=baseline?pending:pending.getByText('Caricamento pazienti',{exact:true});await expect(pendingTarget).toBeVisible();
    await check(()=>count.isVisible(),false);await check(()=>lens.isVisible(),false);await gallery('pending',pendingTarget);
    fixture.state.hold=null;release();expect(await(await failed).finished()).toBeNull();await expect(error).toBeVisible();
    await check(()=>count.isVisible(),false);await check(()=>lens.isVisible(),false);await gallery('error',error);
    fixture.state.status=200;await error.getByRole('button',{name:'Riprova',exact:true}).click();
    await expect(page.getByTestId('lume-patient-row')).toHaveCount(1);await expect(count).toHaveText('1 risultato');
    const primaries=page.locator('[data-patient-directory] [data-lume-action="primary"]');
    if(baseline)expect.soft(await primaries.count()).toBe(1);else await expect(primaries).toHaveCount(1);
    await expect(page.getByRole('link',{name:'Nuova scheda',exact:true})).toHaveAttribute('href','/patients/new');
    await expect(lens.getByRole('link',{name:'Apri scheda paziente',exact:true})).toHaveAttribute('href','/patients/A/modules');
    await gallery('ready',worklist.locator('header').first());
    fixture.state.patients=[];await page.reload();await expect(count).toHaveText('0 risultati');
    const empty=worklist.getByText('Nessun paziente nell’ambito selezionato.',{exact:true});await expect(empty).toBeVisible();await gallery('empty',empty);
    fixture.state.patients=[fixture.known];await page.reload();await expect(page.getByTestId('lume-patient-row')).toHaveCount(1);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await expect(page.getByTestId('lume-patient-row')).toHaveCount(0);
    if(baseline){await expect(empty).toBeVisible();expect.soft(await error.isVisible()).toBe(true)}else{await expect(error).toBeVisible();await expect(count).not.toBeVisible();await expect(lens).not.toBeVisible()}
    await gallery('snapshot-retired',baseline?empty:error);
  }finally{
    fixture.state.hold=null;release();
    try{const receipt={baseline,lifecycleStimulus:'synthetic pagehide event, not real bfcache',frames,calls:fixture.calls,blocked:fixture.blocked,uiWrites:fixture.uiWrites,errors};await info.attach('worklist-read-receipt',{contentType:'application/json',body:JSON.stringify(receipt,null,2)});if(directory){await mkdir(directory,{recursive:true});await writeFile(`${directory}/receipt.json`,JSON.stringify(receipt,null,2))}}finally{await fixture.close()}
    expect(fixture.blocked).toEqual([]);expect(errors).toEqual([]);
  }
});
