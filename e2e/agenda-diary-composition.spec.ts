import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, unlockIfNeeded } from './utils';

async function installAgendaDiaryFixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  if (new URL(origin).hostname !== '127.0.0.1' || new URL(origin).port === '3000') throw Error('Owned synthetic loopback required');
  const now = new Date(); now.setHours(9, 0, 0, 0);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const patients = [{ id: 'w20-invented-a', firstName: 'Persona', lastName: 'Inventata Agenda', taxCode: 'W20SYNTHETIC', birthDate: '1975-01-01T00:00:00.000Z', diagnoses: [], status: 'active', updatedAt: now.toISOString(), createdAt: now.toISOString() }];
  const checkups = Array.from({ length: 7 }, (_, i) => ({ id: 'w20-checkup-' + i, patientId: patients[0].id, title: i === 6 ? 'Settimo controllo inventato' : 'Controllo inventato ' + i, date: (i === 6 ? tomorrow : now).toISOString(), status: 'pending', version: 1 }));
  const entries = Array.from({ length: 51 }, (_, i) => ({ id: 'w20-entry-' + i, patientId: patients[0].id, title: 'Voce inventata ' + i, content: 'Contenuto inventato per prova software ' + i, date: new Date(now.getTime() - i * 60000).toISOString(), type: i % 2 === 0 ? 'note' : 'access', setting: 'ambulatory', metadata: { authorName: 'Autrice inventata ' + i, sourceLabel: 'Fonte inventata ' + i, workflowStatus: i === 0 ? 'draft' : 'signed' }, attachments: [], version: 1 }));
  const state = { patients: 200, checkups: 200, entries: 200, emptyAgenda: false, emptyDiary: false, hold: null as Promise<void> | null };
  const calls: { path: string; search: string; method: string; mocked: boolean }[] = [];
  const blocked: { method: string; url: string }[] = [];
    const mockedUiWrites: { key: string; value: boolean }[] = [];
    const uiDefaults: Record<string, boolean> = { uiReduceMotion: false, uiReduceTransparency: false };
    const mockUiPreference = async (route: Route) => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const key = path.startsWith('/api/settings/') ? path.slice('/api/settings/'.length) : undefined;
        if (request.method() === 'GET' && key && Object.hasOwn(uiDefaults, key)) {
            await route.fulfill({ json: { key, value: uiDefaults[key] } }); return true;
        }
        if (request.method() === 'POST' && path === '/api/settings') {
            const body = request.postDataJSON();
            if (body && Object.keys(body).length === 2 && Object.hasOwn(uiDefaults, body.key) && body.value === false) {
                mockedUiWrites.push({ key: body.key, value: false });
                await route.fulfill({ json: { key: body.key, value: false } }); return true;
            }
        }
        return false;
    };
  const handler = async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const deny = () => { blocked.push({ method, url: request.url() }); return route.abort(); };
    if (url.origin !== origin) return deny();
    if (await mockUiPreference(route)) return;
    if (path === '/api/plugin-local-ui/pairing' && method === 'GET') return route.fulfill({ json: { available: false, pending: [], active: [] } });
    if (path === '/api/siss/session-status') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
    if (path === '/api/clinical-agenda/candidates') { calls.push({ path, search: url.search, method, mocked: true }); return route.fulfill({ json: { enabled: false, stats: { candidates: 0, parsed: 0, ignored: 0, invalid: 0 }, candidates: [], sources: [] } }); }
    if (/^\/api\/(ai|icd|system|drugs|exemptions|prosthetics)(?:\/|$)/.test(path) && path !== '/api/system/revision') return deny();
    if (/^\/api\/(patients|checkups|entries)(?:\/|$)/.test(path)) {
      calls.push({ path, search: url.search, method, mocked: true });
      if (method !== 'GET') return deny();
      const key = path.split('/')[2] as 'patients' | 'checkups' | 'entries';
      const status = state[key];
      const patientId = url.searchParams.get('patientId');
      const patientEntries = entries.filter(entry => !patientId || entry.patientId === patientId);
      const rows = structuredClone(key === 'patients' ? patients : key === 'checkups' ? state.emptyAgenda ? [] : checkups : state.emptyDiary ? [] : patientEntries.slice(0, Number(url.searchParams.get('limit') ?? patientEntries.length)));
      if (state.hold) await state.hold;
      if (status !== 200) return route.fulfill({ status, json: { error: 'SYNTHETIC READ DENIED' } });
      return route.fulfill({ json: rows });
    }
    if (/^\/api\/(therapies|observations|attachments|conversations|messages)(?:\/|$)/.test(path)) {
      if (method !== 'GET') return deny();
      return route.fulfill({ json: [] });
    }
    const ownedAuth = ['/api/auth/check', '/api/auth/setup', '/api/auth/login', '/api/auth/lock', '/api/auth/rewrap-master-key'].includes(path);
    const ownedRead = method === 'GET' && (path === '/api/onboarding/work-profile' || path === '/api/settings' || path.startsWith('/api/settings/') || path === '/api/system/revision');
    if (path.startsWith('/api/') && !ownedAuth && !ownedRead) return deny();
    return route.continue();
  };
  await page.route('**/*', handler);
  return { state, calls, blocked, mockedUiWrites, patients, checkups, entries, close: () => page.unroute('**/*', handler) };
}

for (const area of ['turno', 'diario'] as const) test(`Agenda and global diary: ${area} scoped reads and composition`, async ({ baseURL }, info) => {
  test.setTimeout(120000);
  if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR) throw Error('Owned synthetic archive required');
  const baseline = process.env.AGENDA_DIARY_BASELINE === '1';
  const baselineStatesOnly = baseline && process.env.AGENDA_DIARY_BASELINE_STATES_ONLY === '1';
  const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
  const f = await installAgendaDiaryFixture(page, baseURL!);
  const gallery = process.env.AGENDA_DIARY_SCREENSHOTS;
  const directory = gallery || process.env.AGENDA_DIARY_STATE_SCREENSHOTS;
  const frames: unknown[] = [], errors: string[] = [], observations: unknown[] = [];
  let release = () => {};
  page.on('pageerror', error => errors.push(error.message));
  const surface = area === 'turno' ? page.getByTestId('agenda-area') : page.getByTestId('lume-diario');
  // The baseline predates the Agenda test id; the owning heading identifies the same surface.
  const baselineSurface = area === 'turno' ? page.getByRole('heading', { level: 1, name: /^Agenda/ }).locator('../../..') : surface;
  const targetSurface = baseline ? baselineSurface : surface;
  const content = area === 'turno' ? 'Controllo inventato 0' : 'Voce inventata 0';
  const endpoint = area === 'turno' ? 'checkups' : 'entries';
  const emptyText = area === 'turno' ? 'Nessun appuntamento in agenda.' : 'Nessuna voce clinica nel diario locale.';
  const errorText = area === 'turno' ? 'Agenda non disponibile.' : 'Diario clinico non disponibile.';
  const shot = async (name: string, target: Locator) => {
    await target.scrollIntoViewIfNeeded();
    const probe = await target.evaluate(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      const x = box.x + Math.min(box.width / 2, 50), y = box.y + Math.min(box.height / 2, 15);
      const hit = document.elementFromPoint(x, y);
      return { text: element.textContent, rect: { x: box.x, y: box.y, width: box.width, height: box.height }, viewport: { width: innerWidth, height: innerHeight }, point: { x, y },
        hit: hit === element || element.contains(hit), hitElement: hit ? { tag: hit.tagName, role: hit.getAttribute('role'), class: hit.getAttribute('class') } : null,
        fontSize: style.fontSize, color: style.color, palette: getComputedStyle(document.documentElement).getPropertyValue('--lume-ink') };
    });
    if (name === 'row-menu') {
      observations.push({ rowMenuProbe: probe }); frames.push({ name, ...probe });
      if (directory) {
        await mkdir(directory, { recursive: true });
        await writeFile(`${directory}/${area}-row-menu-probe.json`, JSON.stringify(probe, null, 2));
        await page.screenshot({ path: `${directory}/${area}-${name}.png`, fullPage: false, animations: 'disabled' });
      }
      expect(probe.hit).toBe(true);
      return probe;
    }
    expect(probe.hit).toBe(true); frames.push({ name, ...probe });
    if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${area}-${name}.png`, fullPage: false, animations: 'disabled' }); }
    return probe;
  };
  const scope = async (value: string | null) => {
    if (value === null) await page.context().clearCookies({ name: 'ambulatory_id' });
    else await page.context().addCookies([{ name: 'ambulatory_id', value, url: baseURL! }]);
  };
  const ready = async () => {
    await expect(targetSurface.getByText(content, { exact: true })).toBeVisible();
    if (!baseline) await expect(surface.getByRole('button', { name: 'Aggiorna', exact: true })).toBeEnabled();
  };
  try {
    await scope('w20-synthetic-scope-a');
    await bootstrapUnlockedSession(page, '1234');
    if (!baselineStatesOnly) {
    f.state.hold = new Promise<void>(resolve => release = resolve);
    const initialRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/' + endpoint);
    await page.goto('/?area=' + area); await initialRead;
    await expect(targetSurface.getByRole('heading', { level: 1 })).toBeVisible();
    observations.push({ initialLoadingText: await targetSurface.innerText() });
    if (!baseline) {
      await expect(surface.locator('[data-view-state="loading"]')).toBeVisible();
      await expect(surface.getByText(content, { exact: true })).toHaveCount(0);
      if (area === 'turno') await expect(surface.locator('header').first()).not.toContainText('0 appuntamenti oggi');
    }
    await shot('initial-loading', baseline ? targetSurface.getByRole('heading', { level: 1 }) : surface.locator('[data-view-state="loading"]'));
    release(); f.state.hold = null; await ready();
    } else { await page.goto('/?area=' + area); await ready(); }
    if (gallery) {
      const colors = new Map<string, string>();
      for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
        await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
        else await page.setViewportSize({ width: Number(size), height: 1000 });
        await page.evaluate(value => { const theme = value === 'giorno' ? 'light' : 'dark'; localStorage.setItem('mediflow-theme', theme); document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); document.documentElement.style.colorScheme = theme; }, theme);
        await assertNoHorizontalOverflow(page, [{ label: area, selector: 'document' }]);
        const probe = await shot(`${theme}-${size}`, targetSurface.getByRole('heading', { level: 1 }));
        if (size === '1440') colors.set(theme, probe.color);
      }
      expect(colors.get('giorno')).not.toBe(colors.get('grafite'));
      await zoom.setZoom(1); await page.setViewportSize({ width: 1440, height: 1000 });
    }
    if (!baseline) await page.evaluate(value => {
      localStorage.setItem('mediflow-theme', value);
      document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(value);
      document.documentElement.style.colorScheme = value;
    }, area === 'diario' ? 'light' : 'dark');
    if (area === 'diario') {
      await expect(surface.getByTestId('lume-diario-entry')).toHaveCount(50);
      const first = surface.getByTestId('lume-diario-entry').first();
      await expect(first).toContainText('Fonte: Fonte inventata 0');
      await expect(first).toContainText('Autore: Autrice inventata 0');
      await expect(first).toContainText('Bozza');
      const entryReads = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name)).filter(url => url.pathname === '/api/entries').map(url => ({ search: url.search })));
      const reads = entryReads.filter(call => !new URLSearchParams(call.search).has('patientId'));
      observations.push({ globalEntriesReadsInDocument: reads.length, globalReads: reads, patientReads: entryReads.filter(call => new URLSearchParams(call.search).has('patientId')) });
      if (!baseline) expect(reads).toHaveLength(1);
      expect(reads.every(call => new URLSearchParams(call.search).get('limit') === '50')).toBe(true);
      const search = page.getByRole('searchbox', { name: 'Cerca nel diario' });
      await search.fill('nessuna corrispondenza inventata');
      if (!baseline) await expect(surface).toContainText('Nessuna voce clinica con questo filtro.');
      await shot('filter-empty', targetSurface.getByText(baseline ? emptyText : 'Nessuna voce clinica con questo filtro.', { exact: true }));
      await search.clear();
      await first.getByRole('button', { name: 'Apri quadro', exact: true }).focus(); await page.keyboard.press('Tab');
      if (baseline) await expect(first.getByRole('link', { name: 'Nuova voce', exact: true })).toBeFocused();
      else {
        const actions = first.getByRole('button', { name: 'Azioni', exact: true });
        await expect(actions).toBeFocused(); await actions.press('ArrowDown');
        const menu = page.getByRole('menu', { name: 'Azioni', exact: true });
        const link = menu.getByRole('menuitem', { name: 'Nuova voce', exact: true });
        await expect(link).toBeFocused(); await expect(link).toHaveAttribute('href', '/patients/w20-invented-a/entries/new');
        await shot('row-menu', link); await page.keyboard.press('Escape'); await expect(actions).toBeFocused();
      }
    } else {
      await targetSurface.getByRole('button', { name: 'Manuali', exact: true }).click();
      const seventhVisible = await targetSurface.getByText('Settimo controllo inventato', { exact: true }).isVisible();
      observations.push({ seventhVisible }); if (!baseline) expect(seventhVisible).toBe(true);
      await shot('manual-seventh', targetSurface.locator('section').first());
      await targetSurface.getByRole('button', { name: 'AI', exact: true }).click();
      await expect(targetSurface).toContainText('Nessun appuntamento con questo filtro.');
      await targetSurface.getByRole('button', { name: 'Tutti', exact: true }).click();
    }
    f.state[endpoint] = 503;
    const firstFailure = page.waitForResponse(response => new URL(response.url()).pathname === '/api/' + endpoint && response.status() === 503);
    await page.reload(); await firstFailure;
    if (baseline) {
      await shot('first-read-error', targetSurface.getByText(area === 'diario' ? 'Caricamento diario clinico.' : 'Caricamento appuntamenti…', { exact: true }));
      observations.push({ firstReadErrorText: await targetSurface.innerText() });
      return;
    }
    await expect(surface.getByRole('alert')).toContainText(errorText);
    await expect(surface.getByText(content, { exact: true })).toHaveCount(0);
    await expect(surface.getByText(emptyText, { exact: true })).toHaveCount(0);
    await shot('first-read-error', surface.getByRole('alert'));
    f.state[endpoint] = 200; await surface.getByRole('button', { name: 'Riprova', exact: true }).click(); await ready();
    const sections = surface.locator('h2');
    for (const heading of await sections.all()) await expect(heading).toHaveCSS('font-size', '12px');
    const refresh = surface.getByRole('button', { name: 'Aggiorna', exact: true });
    const retry = surface.getByRole('button', { name: 'Riprova', exact: true });
    f.state.hold = new Promise<void>(resolve => release = resolve); f.state[endpoint] = 503;
    const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/' + endpoint && response.status() === 503);
    await refresh.click(); await expect(refresh).toBeDisabled(); await expect(surface.getByText(content, { exact: true })).toBeVisible();
    await shot('refresh-last-good', surface.locator('[data-view-state="loading"]'));
    release(); f.state.hold = null; await failed;
    await expect(surface.getByRole('alert')).toContainText(errorText);
    await expect(surface.getByText(content, { exact: true })).toBeVisible(); await expect(refresh).toHaveCount(0);
    await shot('error-last-good', surface.getByRole('alert'));
    f.state[endpoint] = 200; await retry.click(); await ready();
    if (area === 'diario') {
      await page.getByRole('searchbox', { name: 'Cerca nel diario' }).fill('Voce inventata 0');
      await expect(surface.getByTestId('lume-diario-entry')).toHaveCount(1);
    }
    f.state.patients = 503; await refresh.click();
    await expect(surface.getByRole('alert')).toContainText(area === 'turno' ? 'Impossibile aggiornare i dati dei pazienti per l’agenda.' : 'Impossibile aggiornare i dati dei pazienti per il diario.');
    await expect(surface.getByText(content, { exact: true })).toBeVisible();
    f.state.patients = 200; await retry.click(); await ready();
    f.state.hold = new Promise<void>(resolve => release = resolve);
    const readStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/' + endpoint);
    await refresh.click(); await readStarted; await scope('w20-synthetic-scope-b'); release(); f.state.hold = null;
    await expect(surface.getByRole('alert')).toContainText(errorText); await expect(surface.getByText(content, { exact: true })).toHaveCount(0);
    await expect(surface).not.toContainText('Inventata Agenda');
    if (area === 'turno') {
      const decisions = surface.getByRole('region', { name: 'Da fare oggi', exact: true });
      await expect(decisions).toContainText('Impossibile aggiornare i dati dei pazienti per l’agenda.');
      await expect(decisions.getByText('Agenda non disponibile.', { exact: true })).toBeVisible();
      await expect(decisions).not.toContainText('Preparazione della lista pazienti.');
    }
    await shot('scope-changed', surface.getByRole('alert'));
    await retry.click(); await ready();
    f.state.hold = new Promise<void>(resolve => release = resolve);
    await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await expect(surface.getByText(content, { exact: true })).toHaveCount(0);
    await shot('page-restore-pending', surface.locator('[data-view-state="loading"]'));
    release(); f.state.hold = null; await ready();
    await scope(null); await page.reload(); await ready();
    f.state[endpoint] = 503; await refresh.click(); await expect(surface.getByRole('alert')).toContainText(errorText);
    await expect(surface.getByText(content, { exact: true })).toHaveCount(0);
    await expect(surface).not.toContainText('Inventata Agenda');
    await shot('no-explicit-scope-error', surface.getByRole('alert'));
    f.state[endpoint] = 200; await retry.click(); await ready();
    f.state[area === 'turno' ? 'emptyAgenda' : 'emptyDiary'] = true; await refresh.click();
    await expect(surface).toContainText(emptyText); await expect(surface.getByRole('alert')).toHaveCount(0);
    await shot('empty', surface.locator('[data-view-state="empty"]'));
    f.state[area === 'turno' ? 'emptyAgenda' : 'emptyDiary'] = false; await refresh.click(); await ready();
    for (const status of [401, 403]) {
      f.state[endpoint] = status; await refresh.click();
      await expect(page.getByLabel('MediFlow lock screen')).toBeVisible(); await expect(surface).toHaveCount(0);
      f.state[endpoint] = 200; await unlockIfNeeded(page, '1234'); await ready();
    }
  } finally {
    release();
    try {
      observations.push({ requests: f.calls, mockedUiWrites: f.mockedUiWrites, blocked: f.blocked, errors, contextCases: 'cookie change and synthetic pagehide/pageshow: lifecycle events, not an OS bfcache restoration' });
      try {
        await info.attach('agenda-diary-observations', { body: JSON.stringify({ baseline, area, frames, observations }, null, 2), contentType: 'application/json' });
      } finally {
        if (directory) { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/${area}-observations.json`, JSON.stringify({ baseline, frames, observations }, null, 2)); }
      }
    } finally {
      try { await f.close(); }
      finally { await zoom.close(); }
    }
    expect(f.blocked).toEqual([]); expect(errors).toEqual([]);
  }
});
