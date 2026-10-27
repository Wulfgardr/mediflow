import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, unlockIfNeeded } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

const readErrorTitle = 'Schede non leggibili';
const readErrorDetail = 'Impossibile leggere le schede. Gli aggregati non sono mostrati. Usa «Riprova» per ripetere la lettura.';
const noAnalyticsPatients = 'Nessuna scheda attiva disponibile per l’analisi.';

async function installAnalyticsFixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const patient = (id: string, birthDate: string | null, isArchived = false) => ({ id, firstName: 'Persona', lastName: `Inventata ${id}`,
    taxCode: `W21SYNTH${id}`, birthDate, isArchived, isAdi: true, status: 'active',
    diagnoses: [{ system: 'TEST', code: id, description: `Categoria sintetica ${id}` }],
    createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' });
  const known = patient('A', '1970-04-12T00:00:00.000Z'), missingAge = patient('M', null), archived = patient('X', '1980-01-01T00:00:00.000Z', true);
  const otherScope = patient('B', '2010-01-01T00:00:00.000Z');
  const state = { patients: [known, missingAge, archived], status: 200, hold: null as Promise<void> | null };
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
      return route.fulfill({ status, json: status === 200 ? rows : { error: 'SYNTHETIC_ANALYTICS_UNAVAILABLE' } });
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
  return { state, calls, blocked, uiWrites, known, missingAge, archived, otherScope, close: () => page.unroute('**/*', handler) };
}

for (const scenario of ['initial', 'refresh', 'context'] as const) test(`Analytics ${scenario}: scoped read states`, async ({ page: ownedPage, baseURL }, info) => {
  if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL
    || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw Error('Owned synthetic archive and loopback required');
  const baseline = process.env.ANALYTICS_READ_BASELINE === '1';
  test.skip(baseline && scenario === 'context', 'Context scenario is candidate qualification, not a baseline claim.');
  const zoom = !baseline && scenario === 'initial' ? await openBrowserZoomFixture(baseURL) : null;
  const page = zoom?.page ?? ownedPage;
  const fixture = await installAnalyticsFixture(page, baseURL);
  const errors: string[] = [], frames: unknown[] = [], observations: unknown[] = [];
  const directory = process.env.ANALYTICS_READ_SCREENSHOTS;
  const primary = page.getByTestId('analytics-primary-value');
  const error = page.getByRole('alert').filter({ hasText: readErrorTitle });
  let release = () => {};
  page.on('pageerror', value => errors.push(value.message));
  const shot = async (name: string, target: Locator) => {
    await target.scrollIntoViewIfNeeded();
    const probe = await target.evaluate(element => {
      const rect = element.getBoundingClientRect(), x = rect.x + Math.min(rect.width / 2, 50), y = rect.y + Math.min(rect.height / 2, 15);
      const hit = document.elementFromPoint(x, y);
      return { text: element.textContent, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight }, hit: element === hit || element.contains(hit),
        color: getComputedStyle(element).color, palette: getComputedStyle(document.documentElement).getPropertyValue('--lume-ink') };
    });
    frames.push({ name, ...probe });
    if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${scenario}-${name}.png`, fullPage: false, animations: 'disabled' }); }
    expect(probe.hit).toBe(true);
    if (!baseline) {
      expect(probe.rect.x).toBeGreaterThanOrEqual(-1); expect(probe.rect.y).toBeGreaterThanOrEqual(-1);
      expect(probe.rect.x + probe.rect.width).toBeLessThanOrEqual(probe.viewport.width + 1);
      expect(probe.rect.y + probe.rect.height).toBeLessThanOrEqual(probe.viewport.height + 1);
    }
    return probe;
  };
  const narrowShots = async (name: string, target: Locator) => {
    if (!zoom) return;
    const colors = new Map<string, string>();
    for (const theme of ['giorno', 'grafite']) for (const size of ['320', 'zoom-400']) {
      await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
      await page.setViewportSize({ width: size === '320' ? 320 : 1440, height: 1000 });
      if (size === 'zoom-400') await zoom.setZoom(4);
      await page.evaluate(value => {
        localStorage.setItem('mediflow-theme', value);
        document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(value);
        document.documentElement.style.colorScheme = value;
      }, theme === 'giorno' ? 'light' : 'dark');
      await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' }]);
      const scroll = await target.evaluate(element => {
        for (let owner = element.parentElement; owner; owner = owner.parentElement) {
          if (owner.scrollHeight <= owner.clientHeight || !/auto|scroll/.test(getComputedStyle(owner).overflowY)) continue;
          const rect = owner.getBoundingClientRect(), target = element.getBoundingClientRect();
          const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
          const delta = target.top + target.height / 2 - (top + bottom) / 2;
          const expected = Math.max(0, Math.min(owner.scrollHeight - owner.clientHeight, owner.scrollTop + delta));
          return { x: rect.left + rect.width / 2, y: (top + bottom) / 2, delta: expected - owner.scrollTop, expected };
        }
        return null;
      });
      if (scroll) {
        await page.mouse.move(scroll.x, scroll.y); await page.mouse.wheel(0, scroll.delta);
        await expect.poll(() => target.evaluate((element, expected) => {
          for (let owner = element.parentElement; owner; owner = owner.parentElement) {
            if (owner.scrollHeight > owner.clientHeight && /auto|scroll/.test(getComputedStyle(owner).overflowY)) return Math.abs(owner.scrollTop - expected);
          }
          return Number.POSITIVE_INFINITY;
        }, scroll.expected)).toBeLessThanOrEqual(1);
      }
      const probe = await shot(`${name}-${theme}-${size}`, target); colors.set(theme, probe.color);
    }
    expect(colors.get('giorno')).not.toBe(colors.get('grafite'));
    await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
    await page.evaluate(() => {
      localStorage.setItem('mediflow-theme', 'light');
      document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light');
      document.documentElement.style.colorScheme = 'light';
    });
  };
  const restoreEvent = () => page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  const scope = (value: string) => page.context().addCookies([{ name: 'ambulatory_id', value, url: baseURL! }]);
  const reread = async () => {
    const previous = fixture.calls.filter(call => call.path === '/api/patients').length;
    await restoreEvent();
    await expect.poll(() => fixture.calls.filter(call => call.path === '/api/patients').length).toBeGreaterThan(previous);
  };
  const failedPatientRead = () => page.waitForResponse(response => new URL(response.url()).pathname === '/api/patients' && response.status() === 503);
  const visibleError = async (failedResponse: ReturnType<Page['waitForResponse']>) => {
    const response = await failedResponse;
    expect(await response.finished()).toBeNull();
    if (baseline) {
      await expect.soft(error).toBeVisible();
      observations.push({ errorVisible: await error.isVisible(), primaryVisible: await primary.isVisible(), body: await page.locator('main').last().innerText() });
      await shot('failure-observed', await primary.isVisible() ? primary : page.getByText('Sto preparando l’analisi locale.', { exact: true }));
    } else {
      await expect(error).toBeVisible(); await expect(primary).not.toBeVisible();
      await shot('error', error);
      await narrowShots('error-detail', error.getByText(readErrorDetail, { exact: true }));
      await narrowShots('error-action', error.getByRole('button', { name: 'Riprova', exact: true }));
    }
  };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await scope('w21-synthetic-a'); await bootstrapUnlockedSession(page, '1234');
    if (scenario === 'initial') {
      fixture.state.status = 503;
      fixture.state.hold = new Promise<void>(resolve => { release = resolve; });
    }
    const beforeInitialRead = fixture.calls.filter(call => call.path === '/api/patients').length;
    const initialFailure = scenario === 'initial' ? failedPatientRead() : null;
    await page.goto('/analytics');
    if (scenario === 'initial') {
      await expect.poll(() => fixture.calls.filter(call => call.path === '/api/patients').length).toBeGreaterThan(beforeInitialRead);
      expect(fixture.calls.filter(call => call.path === '/api/patients').at(-1)?.status).toBe(503);
      const loading = page.getByText('Sto preparando l’analisi locale.', { exact: true });
      await expect(loading).toBeVisible(); await expect(primary).not.toBeVisible(); await shot('pending', loading);
      fixture.state.hold = null; release();
      await visibleError(initialFailure!); fixture.state.status = 200;
      if (baseline) await page.reload(); else await error.getByRole('button', { name: 'Riprova', exact: true }).click();
      await expect(primary).toBeVisible(); await shot('recovered', primary);
      await narrowShots('count', primary);
      const minimum = page.getByLabel('Età minima', { exact: true });
      await minimum.focus(); await minimum.press('End'); await expect(minimum).toHaveValue('120');
      if (baseline) await expect(primary).toHaveText('0'); else await expect(primary).toHaveText('0 schede tra 120 e 120 anni');
      await expect(page.getByText(noAnalyticsPatients, { exact: true })).toHaveCount(0);
      await expect(page.getByText('Nessuna scheda attiva con età nota rientra nel filtro corrente.', { exact: true })).toBeVisible();
      await shot('filter-zero', primary);
      fixture.state.patients = [fixture.archived]; await page.reload();
      if (!baseline) await expect(page.getByText(noAnalyticsPatients, { exact: true })).toBeVisible();
      await shot('no-active-sheets', baseline ? primary : page.getByText(noAnalyticsPatients, { exact: true }));
      fixture.state.patients = [fixture.missingAge]; await page.reload(); await expect(primary).toBeVisible();
      await expect(page.getByText(noAnalyticsPatients, { exact: true })).toHaveCount(0);
      await expect(page.locator('#indicatori dt').filter({ hasText: 'Senza data di nascita, escluse dal filtro' }).locator('..')).toContainText('1 scheda');
      await shot('unknown-age', primary);
    } else if (scenario === 'refresh') {
      await expect(primary).toBeVisible(); const minimum = page.getByLabel('Età minima', { exact: true });
      await minimum.focus(); await minimum.press('ArrowRight'); await expect(minimum).toHaveValue('1');
      fixture.state.status = 503; const failure = failedPatientRead(); await reread();
      await visibleError(failure); fixture.state.status = 200;
      if (baseline) await reread();
      else await error.getByRole('button', { name: 'Riprova', exact: true }).click();
      await expect(primary).toBeVisible(); await expect(minimum).toHaveValue('1');
      await expect(page.getByText('Categoria sintetica A', { exact: true })).toBeVisible(); await shot('recovered-filter', primary);
      await expect(page.getByLabel('Periodo audit', { exact: true })).toHaveValue('30');
      expect(fixture.calls.some(call => call.path === '/api/system/audit')).toBe(true);
    } else {
      await expect(primary).toBeVisible();
      fixture.state.hold = new Promise<void>(resolve => { release = resolve; });
      await reread();
      expect(fixture.calls.filter(call => call.path === '/api/patients').at(-1)?.patientIds).toContain('A');
      await scope('w21-synthetic-b'); fixture.state.patients = [fixture.otherScope]; fixture.state.hold = null; release();
      await expect(error).toBeVisible(); await expect(primary).not.toBeVisible();
      await expect(page.getByText('Categoria sintetica A', { exact: true })).not.toBeVisible(); await shot('scope-retired', error);
      await error.getByRole('button', { name: 'Riprova', exact: true }).click();
      await expect(page.getByText('Categoria sintetica B', { exact: true })).toBeVisible();
      fixture.state.hold = new Promise<void>(resolve => { release = resolve; });
      await reread();
      expect(fixture.calls.filter(call => call.path === '/api/patients').at(-1)?.patientIds).toEqual(['B']);
      await page.getByRole('button', { name: 'Blocca', exact: true }).click(); fixture.state.hold = null; release();
      await expect(page.getByLabel('MediFlow lock screen')).toBeVisible(); await expect(primary).not.toBeVisible();
      await unlockIfNeeded(page, '1234'); await page.goto('/analytics');
      await expect(page.getByText('Categoria sintetica B', { exact: true })).toBeVisible(); await shot('session-renewed', primary);
    }
  } finally {
    fixture.state.hold = null; release();
    try {
      const receipt = { baseline, scenario, lifecycleStimulus: 'Synthetic pagehide/pageshow events; not real OS bfcache qualification',
        calls: fixture.calls, blocked: fixture.blocked, uiWrites: fixture.uiWrites, errors, frames, observations };
      await info.attach('analytics-read-receipt', { contentType: 'application/json', body: JSON.stringify(receipt, null, 2) });
      if (directory) { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/${scenario}-receipt.json`, JSON.stringify(receipt, null, 2)); }
    } finally { try { await fixture.close(); } finally { await zoom?.close(); } }
    expect(fixture.blocked).toEqual([]); expect(errors).toEqual([]);
  }
});
