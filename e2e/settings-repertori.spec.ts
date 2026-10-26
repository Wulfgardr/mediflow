import { expect, test, type Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';

function requireSynthetic(baseURL?: string) {
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL
        || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
}
const baseline = process.env.SETTINGS_REPERTORI_BASELINE === '1';
const fixedDate = '2026-10-20T12:00:00.000Z';
const aifa = { count: 12, state: 'ready', manifest: { format: 'mediflow.aifa-catalog-manifest.v1',
    source: 'Agenzia Italiana del Farmaco (AIFA)', sourceUrl: 'https://example.invalid/aifa-sintetico.csv',
    reuseTermsUrl: 'https://www.aifa.gov.it/copyright', reuseStatus: 'source-artifact-review-required',
    downloadedAt: '2026-10-20', version: 'Fixture tecnica 1', sha256: 'a'.repeat(64), fileName: 'aifa-sintetico.csv', rowCount: 12, importedAt: fixedDate } };

test('Repertori Impostazioni: dati, lettura pendente e negata senza servizi esterni', async ({ baseURL }) => {
    test.setTimeout(180_000); requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    const directory = process.env.SETTINGS_REPERTORI_SCREENSHOTS;
    const errors: string[] = [], mutations: string[] = [], external: string[] = [], surfaces: unknown[] = [];
    let state: 'pending' | 'ready' | 'denied' = 'pending', release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(baseURL!).origin) { external.push(url.origin); return route.abort(); }
        return route.continue();
    });
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } }));
    const mocked = ['/api/drugs', '/api/drugs/source', '/api/drugs/update', '/api/exemptions/import/status',
        '/api/prosthetics/catalog/status', '/api/prosthetics/catalog/sources', '/api/icd/catalog', '/api/icd/proxy'];
    await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (!mocked.includes(url.pathname)) return route.fallback();
        if (request.method() !== 'GET' && !(url.pathname === '/api/drugs/source' && request.method() === 'POST')) {
            mutations.push(`${request.method()} ${url.pathname}`); return route.abort();
        }
        if (state === 'pending') await gate;
        if (state === 'denied') return route.fulfill({ status: 403, json: { error: 'SYNTHETIC_DENIED', message: 'Accesso al repertorio negato dalla fixture.' } });
        const json = url.pathname === '/api/drugs' ? aifa
            : url.pathname === '/api/drugs/source' ? { catalog: aifa, networkAllowed: false, networkPreference: false,
                remote: { outcome: 'unavailable', reason: 'network_disabled', checkedAt: fixedDate } }
                : url.pathname === '/api/exemptions/import/status' ? { count: 3, revision: 'fixture-exemptions', latestReceipt: null }
                    : url.pathname === '/api/prosthetics/catalog/status' ? { count: 2, sourceCount: 1, revision: 'fixture-prosthetics', latestReceipt: null }
                        : url.pathname === '/api/prosthetics/catalog/sources' ? { sources: [], revision: 'fixture-prosthetics' }
                            : url.pathname === '/api/icd/catalog' ? { state: 'absent', enabled: false, revision: 0, manifest: null, previousAvailable: false, searchEngine: 'fts5' }
                                : { schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1', status: 'disabled', releaseId: '2026-01', language: 'en' };
        return route.fulfill({ json });
    });
    const section = page.getByTestId('settings-repertori-section');
    const capture = async (name: string, selector?: string, target?: Locator) => {
        if (!directory) return;
        await mkdir(directory, { recursive: true });
        for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
            await page.setViewportSize({ width: size.startsWith('zoom') ? 1440 : Number(size), height: 1000 });
            if (size.startsWith('zoom')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
            await page.emulateMedia({ colorScheme: theme === 'giorno' ? 'light' : 'dark' });
            await expect(page.locator('html')).toHaveClass(new RegExp(theme === 'giorno' ? 'light' : 'dark'));
            if (selector) await page.locator(selector).evaluate(element => element.scrollIntoView({ block: 'start' }));
            let visibility: unknown = null;
            if (target) {
                await expect(target).toBeVisible();
                visibility = await target.evaluate(element => {
                    element.scrollIntoView({ block: 'center', inline: 'nearest' });
                    const rect = element.getBoundingClientRect();
                    const visible = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
                    const ancestors = [];
                    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
                        if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) {
                            visible.top = Math.max(visible.top, bounds.top); visible.bottom = Math.min(visible.bottom, bounds.bottom);
                            ancestors.push({ tag: parent.tagName, overflowY: style.overflowY, top: bounds.top, bottom: bounds.bottom, scrollTop: parent.scrollTop, clientHeight: parent.clientHeight });
                        }
                        if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) { visible.left = Math.max(visible.left, bounds.left); visible.right = Math.min(visible.right, bounds.right); }
                    }
                    const width = Math.max(0, Math.min(rect.right, visible.right) - Math.max(rect.left, visible.left));
                    const height = Math.max(0, Math.min(rect.bottom, visible.bottom) - Math.max(rect.top, visible.top));
                    const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return { text: element.textContent, bounds: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
                        intersectionRatio: width * height / (rect.width * rect.height), centerUncovered: !!center && (element === center || element.contains(center)),
                        ancestors, font: getComputedStyle(element).font, viewport: { width: innerWidth, height: innerHeight } };
                });
            }
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            surfaces.push({ name, theme, size, overflow, actualWidth: await page.evaluate(() => innerWidth), visibility });
            if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }]);
            await page.screenshot({ path: `${directory}/${name}-${theme}-${size}.png`, fullPage: true, animations: 'disabled', timeout: 10_000 });
            if (!baseline && visibility) {
                expect((visibility as { intersectionRatio: number }).intersectionRatio, `${name} ${theme} ${size}: bersaglio intero nel piano visibile`).toBeGreaterThanOrEqual(0.98);
                expect((visibility as { centerUncovered: boolean }).centerUncovered, `${name} ${theme} ${size}: nessuna testata sopra il bersaglio`).toBe(true);
            }
        }
        await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
    };
    const captureManagers = async (name: string) => {
        for (const [id, selector, control] of [
            ['aifa', '[data-testid="aifa-catalog-guide"]', 'Farmaci AIFA'],
            ['esenzioni', 'section[aria-label="Import esenzioni"]', 'Esenzioni'],
            ['protesica', 'section[aria-label="Import repertorio protesica"]', 'Protesica e ausili'],
            ['who', '[data-testid="who-setup-panel"]', 'Terminologia WHO'],
        ]) {
            if (!baseline) await section.getByRole('button', { name: new RegExp(`^${control}`) }).click();
            await capture(`${name}-${id}`, selector, baseline ? undefined : section.getByRole('button', { name: new RegExp(`^${control}`) }));
            if (!baseline && name === 'lettura-negata') {
                const manager = page.locator(selector);
                const message = id === 'aifa' ? manager.getByText('Stato locale non disponibile.', { exact: true })
                    : id === 'esenzioni' ? manager.getByText('Conteggio non disponibile. Premi Rileggi stato.', { exact: true })
                        : id === 'protesica' ? manager.getByText('Accesso al repertorio negato dalla fixture.', { exact: true }) : manager.getByRole('alert').last();
                await capture(`${name}-${id}-messaggio`, selector, message);
            }
        }
    };
    try {
        await bootstrapUnlockedSession(page, '1234'); await page.goto('/settings/repertori');
        await expect(section).toBeVisible(); await capture('lettura-pendente');
        state = 'ready'; release();
        await expect(section).toContainText('3 codici'); await expect(section).toContainText('2 voci');
        await capture('dati-osservati'); await captureManagers('dati-osservati');
        if (!baseline) {
            const aifaControl = section.getByRole('button', { name: /^Farmaci AIFA/u });
            await aifaControl.focus(); await page.keyboard.press('Enter');
            await expect(aifaControl).toHaveAttribute('aria-expanded', 'true');
            await expect(section.getByRole('button', { name: 'Aggiorna ora', exact: true })).toBeDisabled();
            const manual = section.getByRole('button', { name: 'Carica un CSV già scaricato', exact: true });
            await manual.click(); await section.getByLabel('Versione dataset (caricamento manuale)').fill('Bozza sintetica conservata');
            await aifaControl.click(); await aifaControl.click();
            await expect(section.getByLabel('Versione dataset (caricamento manuale)')).toHaveValue('Bozza sintetica conservata');
            await page.evaluate(() => { location.hash = 'who-setup'; });
            await expect(section.getByRole('button', { name: /^Terminologia WHO/u })).toHaveAttribute('aria-expanded', 'true');
            await expect(section.getByLabel('Versione dataset (caricamento manuale)')).toBeHidden();
            expect(mutations).toEqual([]);
            await aifaControl.click();
            await expect(section.getByLabel('Versione dataset (caricamento manuale)')).toHaveValue('Bozza sintetica conservata');
            await page.evaluate(() => history.replaceState(null, '', '/settings/repertori'));
            await capture('aifa-dettaglio-bozza');
        }
        state = 'denied'; await page.reload();
        await expect(section).toContainText('Conteggio non disponibile');
        await capture('lettura-negata'); await captureManagers('lettura-negata');
        if (!baseline) {
            await page.goto('/settings'); await page.goto('/settings/repertori#who-setup');
            await expect(section.getByRole('button', { name: /^Terminologia WHO/u })).toHaveAttribute('aria-expanded', 'true');
            await expect(page.getByTestId('who-embedded-catalog')).toBeVisible(); expect(mutations).toEqual([]);
        }
        expect(mutations).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
        if (directory) await writeFile(`${directory}/receipt.json`, JSON.stringify({ baseline, sourceHead: process.env.SETTINGS_REPERTORI_SOURCE_HEAD,
            mockedReadEndpoints: mocked, externalEffects: 'No catalog download/activation or OS action: closed mocks', mutations, external, errors, surfaces }, null, 2));
    } finally {
        release();
        if (directory) { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/surfaces-observed.json`, JSON.stringify(surfaces, null, 2)); }
        await zoom.close();
    }
});

test('Repertori Impostazioni: anteprima e import locali reali conservano bozza, conferma e provenienza', async ({ page, baseURL }) => {
    test.setTimeout(90_000); requireSynthetic(baseURL);
    test.skip(baseline, 'Prova di import locale riservata al candidato');
    const external: string[] = [], commits: string[] = [];
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(baseURL!).origin) { external.push(url.origin); return route.abort(); }
        return route.continue();
    });
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } }));
    await page.route('**/api/drugs/source', route => route.fulfill({ json: { catalog: { count: 0, manifest: null, state: 'not-imported' },
        networkAllowed: false, networkPreference: false, remote: { outcome: 'unavailable', reason: 'network_disabled', checkedAt: fixedDate } } }));
    await page.route('**/api/drugs/update', route => route.abort());
    await page.route('**/api/icd/**', route => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') return route.abort();
        return route.fulfill({ json: url.pathname === '/api/icd/catalog'
            ? { state: 'absent', enabled: false, revision: 0, manifest: null, previousAvailable: false, searchEngine: 'fts5' }
            : { schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1', status: 'disabled', releaseId: '2026-01', language: 'en' } });
    });
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/commit')) commits.push(new URL(request.url()).pathname); });
    await bootstrapUnlockedSession(page, '1234'); await page.goto('/settings/repertori');
    const section = page.getByTestId('settings-repertori-section');
    await section.getByRole('button', { name: /^Esenzioni/u }).click();
    const exemptions = page.getByRole('region', { name: 'Import esenzioni', exact: true });
    const file = exemptions.getByLabel('File esenzioni (.txt o .csv delimitato da |)', { exact: true });
    await file.setInputFiles({ name: 'non-valido-sintetico.txt', mimeType: 'text/plain', buffer: Buffer.from('intestazione errata\r\n') });
    await expect(exemptions).toContainText('Import bloccato'); expect(commits).toHaveLength(0);
    const source = 'CD_ESENZIONE|DS_ESENZIONE|CD_TIPO_ESENZIONE|DT_INIZIO_VALIDITA|DT_FINE_VALIDITA|FL_AMBITO_FARMACEUTICO|FL_AMBITO_SPECIALISTICO|FL_NAZIONALE\r\nSYN-W18C-001|Codice inventato per prova software|S|20260101|\\N|N|S|N\r\n';
    await file.setInputFiles({ name: 'esenzione-w18c-sintetica.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(exemptions).toContainText('Anteprima pronta');
    const confirm = exemptions.getByRole('button', { name: 'Conferma importazione', exact: true });
    await expect(confirm).toBeDisabled();
    const consent = exemptions.getByRole('checkbox'); await consent.check();
    await section.getByRole('button', { name: /^Protesica e ausili/u }).click();
    await expect(confirm).toBeHidden(); expect(commits).toHaveLength(0);
    await section.getByRole('button', { name: /^Esenzioni/u }).click();
    await expect(consent).toBeChecked(); await expect(exemptions).toContainText('esenzione-w18c-sintetica.txt');
    await confirm.focus(); await page.keyboard.press('Enter');
    await expect(exemptions).toContainText('Rilettura confermata.');
    const read = await page.request.get('/api/exemptions/import/status'); expect(read.status()).toBe(200);
    const persisted = await read.json(); expect(persisted.latestReceipt.manifest.sourceName).toBe('esenzione-w18c-sintetica.txt');
    expect(persisted.latestReceipt.applied).toBe(1); expect(commits).toEqual(['/api/exemptions/import/commit']);
    await section.getByRole('button', { name: /^Protesica e ausili/u }).click();
    const prosthetics = page.getByRole('region', { name: 'Import repertorio protesica', exact: true });
    const csv = 'codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine\r\nCodifica inventata,SYN-W18C-001,Ausilio inventato per prova software,fixture-1,Fonte tecnica sintetica,Prova software,,\r\n';
    await prosthetics.getByLabel('File repertorio protesica (.csv)', { exact: true }).setInputFiles({ name: 'protesica-w18c-sintetica.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(prosthetics).toContainText('Anteprima pronta');
    const confirmProsthetics = prosthetics.getByRole('button', { name: 'Conferma importazione protesica', exact: true });
    await expect(confirmProsthetics).toBeDisabled(); await prosthetics.getByRole('checkbox').check(); await confirmProsthetics.click();
    await expect(prosthetics).toContainText('Import registrato e stato del repertorio riletto.');
    const prothRead = await page.request.get('/api/prosthetics/catalog/status'); expect(prothRead.status()).toBe(200);
    const prothPersisted = await prothRead.json(); expect(prothPersisted.latestReceipt.manifest.metadata.source).toBe('Fonte tecnica sintetica');
    expect(prothPersisted.latestReceipt.manifest.metadata.version).toBe('fixture-1');
    expect(commits).toEqual(['/api/exemptions/import/commit', '/api/prosthetics/catalog/commit']); expect(external).toEqual([]);
    if (process.env.SETTINGS_REPERTORI_SCREENSHOTS) await writeFile(`${process.env.SETTINGS_REPERTORI_SCREENSHOTS}/real-local-import-receipt.json`,
        JSON.stringify({ sourceHead: process.env.SETTINGS_REPERTORI_SOURCE_HEAD, exemptions: persisted, prosthetics: prothPersisted,
            commits, external, browserFileInjection: true, osFileDialogQualified: false, remoteCatalogsMocked: true }, null, 2));
});
