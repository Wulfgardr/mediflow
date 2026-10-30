import { closureGallery, settingsClosure } from './fixtures/settings-closure-gallery';
import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

async function installCatalogFixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const state = { countStatus: 200, prostheticsStatus: 200, whoStatus: 200, whoAvailable: false, empty: false, hold: null as Promise<void> | null };
  const calls: { method: string; path: string; search: string; status: number }[] = [];
  const blocked: string[] = [], uiWrites: unknown[] = [];
  const defaults: Record<string, boolean> = { uiReduceMotion: false, uiReduceTransparency: false };
  const catalog = () => ({ count: state.empty ? 0 : 12, state: state.empty ? 'not-imported' : 'ready',
    manifest: state.empty ? null : { format: 'mediflow.aifa-catalog-manifest.v1', source: 'Agenzia Italiana del Farmaco (AIFA)',
      sourceUrl: 'https://example.invalid/w20c-fixture.csv', reuseTermsUrl: 'https://www.aifa.gov.it/copyright',
      reuseStatus: 'source-artifact-review-required', downloadedAt: '2026-10-20', version: 'Fixture tecnica W20c',
      sha256: 'a'.repeat(64), fileName: 'w20c-fixture.csv', rowCount: 12, importedAt: '2026-10-20T12:00:00.000Z' } });
  const handler = async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const deny = () => { blocked.push(`${method} ${url.href}`); return route.abort(); };
    if (url.origin !== origin) return deny();
    const key = path.startsWith('/api/settings/') ? path.slice('/api/settings/'.length) : undefined;
    if (method === 'GET' && key && Object.hasOwn(defaults, key)) return route.fulfill({ json: { key, value: false } });
    if (method === 'POST' && path === '/api/settings') {
      const body = request.postDataJSON();
      if (body && Object.keys(body).length === 2 && Object.hasOwn(defaults, body.key) && body.value === false) {
        uiWrites.push(body); return route.fulfill({ json: body });
      }
      return deny();
    }
    if (method === 'GET' && path === '/api/settings') return route.fulfill({ json: {} });
    if (method === 'GET' && key) return route.fulfill({ json: { key, value: null } });
    if (path === '/api/plugin-local-ui/pairing' && method === 'GET') return route.fulfill({ json: { available: false, pending: [], active: [] } });
    if (path === '/api/siss/session-status' && method === 'GET') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
    const read = async (json: unknown, status = 200) => {
      calls.push({ method, path, search: url.search, status });
      if (state.hold) await state.hold;
      return route.fulfill({ status, json: status === 200 ? json : { error: 'SYNTHETIC_CATALOG_UNAVAILABLE' } });
    };
    if (path === '/api/drugs' && method === 'GET' && url.searchParams.get('count') === '1') return read(catalog(), state.countStatus);
    if (path === '/api/exemptions' && method === 'GET' && url.searchParams.get('count') === '1') return read({ count: state.empty ? 0 : 3 }, state.countStatus);
    if (path === '/api/prosthetics/catalog/status' && method === 'GET') return read({ count: state.empty ? 0 : 2, sourceCount: state.empty ? 0 : 1,
      revision: 'fixture-w20c', latestReceipt: null }, state.prostheticsStatus);
    if (path === '/api/icd/catalog' && method === 'GET') return read({ state: 'absent', enabled: false, revision: 0, manifest: null, previousAvailable: false, searchEngine: 'fts5' }, state.whoStatus);
    if (path === '/api/icd/proxy' && method === 'GET' && !url.search) return read({ schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1',
      status: state.whoAvailable ? 'available' : 'disabled', releaseId: '2026-01', language: 'en' });
    if (path === '/api/drugs/source' && method === 'POST') return read({ catalog: catalog(), networkAllowed: false, networkPreference: false,
      remote: { outcome: 'unavailable', reason: 'network_disabled', checkedAt: '2026-10-20T12:00:00.000Z' } });
    if (path === '/api/clinical-agenda/candidates' && method === 'GET') return route.fulfill({ json: { enabled: false,
      stats: { candidates: 0, parsed: 0, ignored: 0, invalid: 0 }, candidates: [], sources: [] } });
    if (/^\/api\/(patients|checkups|entries|therapies|observations|attachments|conversations|messages)(?:\/|$)/.test(path)) {
      return method === 'GET' ? route.fulfill({ json: [] }) : deny();
    }
    const ownedAuth = ['/api/auth/check', '/api/auth/setup', '/api/auth/login', '/api/auth/lock', '/api/auth/rewrap-master-key'].includes(path);
    const ownedRead = method === 'GET' && (path === '/api/onboarding/work-profile' || path === '/api/system/revision');
    if (path.startsWith('/api/') && !ownedAuth && !ownedRead) return deny();
    return route.continue();
  };
  await page.route('**/*', handler);
  return { state, calls, blocked, uiWrites, close: () => page.unroute('**/*', handler) };
}

for (const failure of ['counts', 'prosthetics'] as const) test(`Repertori: ${failure} read truth and recovery`, async ({ page: ownedPage, baseURL }, info) => {
  if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL
    || new URL(baseURL).hostname !== '127.0.0.1' || (process.env.SETTINGS_CLOSURE === '1' && new URL(baseURL).port !== '3000')) throw Error('Owned synthetic archive and loopback required');
  test.setTimeout(settingsClosure ? 180_000 : 45_000);
  const baseline = process.env.REPERTORI_READ_BASELINE === '1';
  const directory = process.env.REPERTORI_READ_SCREENSHOTS;
  const zoom = baseline ? null : await openBrowserZoomFixture(baseURL);
  const page = zoom?.page ?? ownedPage;
  const fixture = await installCatalogFixture(page, baseURL);
  const errors: string[] = [], frames: unknown[] = [], observations: unknown[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const area = page.getByRole('heading', { level: 1, name: /^Repertori/ }).locator('../../..');
  let release = () => {};
  const shot = async (name: string, target = area) => {
    await target.scrollIntoViewIfNeeded();
    const probe = await target.evaluate(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      const x = rect.x + Math.min(rect.width / 2, 50), y = rect.y + Math.min(rect.height / 2, 15);
      const hit = document.elementFromPoint(x, y);
      return { text: element.textContent, hit: element === hit || element.contains(hit), point: { x, y }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight }, color: style.color,
        palette: getComputedStyle(document.documentElement).getPropertyValue('--lume-ink') };
    });
    frames.push({ name, ...probe });
    expect(probe.hit).toBe(true);
    expect(probe.rect.x).toBeGreaterThanOrEqual(-1);
    expect(probe.rect.y).toBeGreaterThanOrEqual(-1);
    expect(probe.rect.x + probe.rect.width).toBeLessThanOrEqual(probe.viewport.width + 1);
    expect(probe.rect.y + probe.rect.height).toBeLessThanOrEqual(probe.viewport.height + 1);
    if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${failure}-${name}.png`, fullPage: false, animations: 'disabled' }); }
  };
  const readReady = async () => {
    await expect(area.getByRole('button', { name: /^Mostra dettaglio repertorio/ })).toHaveCount(4);
    await expect(area.locator('header').first()).toContainText('voci indicizzate');
  };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(() => localStorage.setItem('mediflow-theme', 'light'));
    await bootstrapUnlockedSession(page, '1234');
    fixture.state.hold = new Promise<void>(resolve => { release = resolve; });
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/prosthetics/catalog/status');
    await page.goto('/?area=repertori'); await requested;
    await expect(area.getByRole('heading', { level: 1 })).toBeVisible();
    await shot('pending');
    if (!baseline) {
      await expect(area.locator('header').first()).toContainText('Lettura locale…');
      await expect(area).not.toContainText('Nessun repertorio disponibile.');
      await expect(area.locator('header').first()).not.toContainText('0 di 0');
    }
    fixture.state.hold = null; release(); await readReady();
    await shot('ready');
    if (settingsClosure && failure === 'counts') {
      for (const button of await area.getByRole('button', { name: /^Mostra dettaglio repertorio/ }).all()) {
        await button.focus(); await page.keyboard.press('Enter');
        await expect(button).toBeFocused(); await expect(button).toHaveAttribute('aria-pressed', 'true');
        const label = (await button.getAttribute('aria-label'))!.replace(/[^a-zA-Z0-9]/g, '-');
        await closureGallery(page, zoom!, directory, label, button);
      }
    }
    await closureGallery(page, zoom!, directory, `${failure}-panoramica`, area.locator('header').first());
    if (failure === 'counts') fixture.state.countStatus = 503;
    else fixture.state.prostheticsStatus = 503;
    const failed = page.waitForResponse(response => new URL(response.url()).pathname === (failure === 'counts' ? '/api/exemptions' : '/api/prosthetics/catalog/status') && response.status() === 503);
    await page.reload(); await failed;
    if (failure === 'counts') await expect(area).toContainText('Impossibile leggere i conteggi locali in questa sessione.');
    else await expect(area.getByRole('button', { name: 'Mostra dettaglio repertorio Protesica e ausili', exact: true })).toBeVisible();
    const row = area.getByRole('button', { name: 'Mostra dettaglio repertorio Protesica e ausili', exact: true }).locator('..');
    observations.push({ failure, text: await area.innerText(), falseZero: await area.locator('header').first().textContent(),
      falseEmpty: await area.getByText('Nessun repertorio disponibile.', { exact: true }).count(),
      falseDisabled: failure === 'prosthetics' ? await row.getByText('Disattivato', { exact: true }).count() : null });
    if (failure === 'prosthetics') await expect(row).toContainText('non verificato');
    await shot('read-error', failure === 'counts' ? baseline ? area.getByText('Impossibile leggere i conteggi locali in questa sessione.', { exact: true }) : area.getByRole('alert') : row);
    if (baseline) {
      if (failure === 'counts') {
        await expect.soft(area.locator('header').first(), 'Errore di lettura non equivale a zero cataloghi').not.toContainText('0 di 0');
        await expect.soft(area, 'Errore di lettura non equivale ad archivio vuoto').not.toContainText('Nessun repertorio disponibile.');
      } else await expect.soft(row, 'Lettura protesica fallita non attesta disattivazione').not.toContainText('Disattivato');
    }
    if (!baseline) {
      await expect(area.locator('header').first()).not.toContainText('0 di 0');
      await expect(area).not.toContainText('Nessun repertorio disponibile.');
      if (failure === 'prosthetics') {
        await expect(row).not.toContainText('Disattivato');
        await expect(row).toContainText('Stato non leggibile');
        await expect(area.locator('header').first()).toContainText('Totale indicizzato incompleto');
        await row.getByRole('button', { name: /^Mostra dettaglio/ }).click();
        await expect(area.getByRole('region', { name: 'Dettaglio Protesica e ausili' }).getByRole('link', { name: 'Importa', exact: true })).toHaveCount(0);
        await expect(area.locator('header').first()).not.toContainText('voci indicizzate');
      }
      const colors = new Map<string, string>();
      for (const theme of ['giorno', 'grafite']) for (const size of (settingsClosure ? ['1440', '768', '390', 'zoom-200'] : ['320', 'zoom-400'])) {
        await page.setViewportSize({ width: 1440, height: 1000 }); await zoom!.setZoom(1);
        await page.setViewportSize({ width: size.startsWith('zoom') ? 1440 : Number(size), height: 1000 });
        if (size.startsWith('zoom')) await zoom!.setZoom(size === 'zoom-400' ? 4 : 2);
        await page.evaluate(value => {
          localStorage.setItem('mediflow-theme', value);
          document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(value);
          document.documentElement.style.colorScheme = value;
        }, theme === 'giorno' ? 'light' : 'dark');
        await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' }, { label: 'Repertori', selector: '[aria-label="Repertori rapidi"]' }]);
        const target = failure === 'counts' ? area.getByRole('alert') : row;
        await shot(`read-error-${theme}-${size}`, target);
        colors.set(theme, await target.evaluate(element => getComputedStyle(element).color));
      }
      expect(colors.get('giorno')).not.toBe(colors.get('grafite'));
      await zoom!.setZoom(1); await page.setViewportSize({ width: 1440, height: 1000 });
    }
    fixture.state.countStatus = 200; fixture.state.prostheticsStatus = 200;
    if (baseline) await page.reload(); else await area.getByRole('button', { name: 'Riprova', exact: true }).click();
    await readReady(); await expect(area.locator('header').first()).toContainText('17 voci indicizzate');
    if (!baseline && failure === 'prosthetics') {
      await expect(row.getByRole('button', { name: /^Mostra dettaglio/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(area.getByRole('region', { name: 'Dettaglio Protesica e ausili' }).getByRole('link', { name: 'Gestisci fonti', exact: true })).toHaveAttribute('href', '/settings/repertori');
    }
    await shot('recovered');
    const who = area.getByRole('button', { name: 'Mostra dettaglio repertorio ICD-11 WHO', exact: true });
    await who.focus(); await page.keyboard.press('Enter');
    await expect(who).toBeFocused(); await expect(who).toHaveAttribute('aria-pressed', 'true');
    await expect(area.getByRole('region', { name: 'Dettaglio ICD-11 WHO' }).getByRole('link', { name: 'Gestisci catalogo', exact: true })).toHaveAttribute('href', '/settings/repertori#who-setup');
    fixture.state.empty = true; await page.reload(); await readReady();
    await expect(area.locator('header').first()).toContainText('0 voci indicizzate');
    await expect(area.getByRole('button', { name: /^Mostra dettaglio repertorio/ })).toHaveCount(4);
    await expect(area.getByRole('link', { name: 'Gestisci repertori', exact: true })).toHaveAttribute('href', '/settings/repertori');
    await shot('observed-zero');
    await closureGallery(page, zoom!, directory, `${failure}-zero`, area.locator('header').first());
  } finally {
    fixture.state.hold = null; release();
    try {
      await info.attach('repertori-read-receipt', { contentType: 'application/json', body: JSON.stringify({ baseline, failure, observations, frames,
        calls: fixture.calls, blocked: fixture.blocked, uiWrites: fixture.uiWrites, errors }, null, 2) });
      if (directory) await writeFile(`${directory}/${failure}-receipt.json`, JSON.stringify({ baseline, failure, observations, frames,
        calls: fixture.calls, blocked: fixture.blocked, uiWrites: fixture.uiWrites, errors }, null, 2));
    } finally { try { await fixture.close(); } finally { await zoom?.close(); } }
    expect(fixture.blocked).toEqual([]); expect(errors).toEqual([]);
  }
});


test('Repertori: failed WHO catalog read stays unreadable with an available optional service', async ({ page, baseURL }, info) => {
  if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL
    || new URL(baseURL).hostname !== '127.0.0.1' || (process.env.SETTINGS_CLOSURE === '1' && new URL(baseURL).port !== '3000')) throw Error('Owned synthetic archive and loopback required');
  const fixture = await installCatalogFixture(page, baseURL), errors: string[] = [], observations: unknown[] = [];
  fixture.state.whoStatus = 503; fixture.state.whoAvailable = true;
  page.on('pageerror', error => errors.push(error.message));
  const area = page.getByRole('heading', { level: 1, name: /^Repertori/ }).locator('../../..');
  const row = area.getByRole('button', { name: 'Mostra dettaglio repertorio ICD-11 WHO', exact: true }).locator('..');
  const shot = async (name: string) => {
    await row.scrollIntoViewIfNeeded();
    const probe = await row.evaluate(element => {
      const box = element.getBoundingClientRect(), x = box.x + Math.min(box.width / 2, 50), y = box.y + Math.min(box.height / 2, 15);
      const hit = document.elementFromPoint(x, y);
      return { text: element.textContent, hit: element === hit || element.contains(hit),
        rect: { x: box.x, y: box.y, width: box.width, height: box.height }, viewport: { width: innerWidth, height: innerHeight } };
    });
    observations.push({ name, ...probe }); expect(probe.hit).toBe(true);
    await page.screenshot({ path: info.outputPath(`who-${name}.png`), fullPage: false, animations: 'disabled' });
  };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await bootstrapUnlockedSession(page, '1234');
    await page.goto('/?area=repertori');
    await expect(row).toContainText('Stato non leggibile');
    await expect(row).not.toContainText('Disattivato'); await expect(row).not.toContainText('Disponibile');
    await expect(area.locator('header').first()).toContainText('Totale indicizzato incompleto');
    await row.getByRole('button', { name: /^Mostra dettaglio/ }).click();
    await expect(area.getByRole('region', { name: 'Dettaglio ICD-11 WHO' })).toContainText('Stato del catalogo WHO non verificabile.');
    await shot('read-error');
    fixture.state.whoStatus = 200; fixture.state.whoAvailable = false;
    await area.getByRole('button', { name: 'Riprova', exact: true }).click();
    await expect(row).toContainText('Disattivato'); await expect(row).not.toContainText('Stato non leggibile');
    await expect(area.locator('header').first()).toContainText('17 voci indicizzate');
    await expect(row.getByRole('button', { name: /^Mostra dettaglio/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(area.getByRole('region', { name: 'Dettaglio ICD-11 WHO' }).getByRole('link', { name: 'Gestisci catalogo', exact: true })).toHaveAttribute('href', '/settings/repertori#who-setup');
    await shot('recovered');
  } finally {
    try { await info.attach('who-read-receipt', { contentType: 'application/json', body: JSON.stringify({ observations,
      calls: fixture.calls, blocked: fixture.blocked, uiWrites: fixture.uiWrites, errors }, null, 2) }); }
    finally { await fixture.close(); }
    expect(fixture.blocked).toEqual([]); expect(errors).toEqual([]);
  }
});
