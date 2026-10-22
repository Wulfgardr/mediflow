import { chromium, expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

const primaryHrefs = ['#quadro', '#terapie', '#parametri', '#documenti'];
const secondaryHrefs = ['#attenzione', '#identita', '#clinica', '#amministrazione', '#prestazioni', '#protesica', '#scale', '#siss', '#timeline', '#diario', '#follow-up'];
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });

async function seed(page: Page, count: number) {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const id = await page.evaluate(async count => {
        const post = async (route: string, body: unknown) => {
            const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
            return response.json();
        };
        const patient = await post('/api/patients', { firstName: 'Ada', lastName: 'Navigazione sintetica', taxCode: `SYNTHETIC-NAV-${crypto.randomUUID()}`, birthDate: '1980-12-31' });
        for (let n = 0; n < count; n++) {
            await post('/api/attachments', { id: crypto.randomUUID(), patientId: patient.id, name: `Documento sintetico ${n + 1}.txt`, type: 'text/plain', size: 9, path: 'uploads/synthetic.txt', data: 'data:text/plain;base64,U2ludGV0aWNv' });
            await post('/api/therapies', { patientId: patient.id, drugName: `Terapia sintetica ${n + 1}`, dosage: 'Dose sintetica', status: 'active', startDate: '2026-10-01T08:00:00.000Z' });
            await post('/api/observations', { patientId: patient.id, codeSystem: 'LOINC', code: '8480-6', display: 'Pressione sistolica', unitSystem: 'UCUM', unitCode: 'mm[Hg]', value: 120 + n, observedAt: '2026-10-01T08:00:00.000Z', source: 'manual' });
        }
        return patient.id as string;
    }, count);
    await page.goto(`/patients/${id}/modules`);
    await expect(navigation(page)).toBeVisible();
    await expect(page.getByTestId('lume-scheda-header')).toContainText('Ada');
    return id;
}

for (const count of [0, 1, 12]) test(`segmenti stabili con ${count} record sintetici e quindici destinazioni`, async ({ page }) => {
    await seed(page, count);
    const nav = navigation(page);
    await expect(nav.locator(':scope > a')).toHaveText(count ? ['Riepilogo', `Terapie${count}`, `Misure${count}`, `Documenti${count}`] : ['Riepilogo', 'Terapie', 'Misure', 'Documenti']);
    expect(await nav.locator(':scope > a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(primaryHrefs);
    const trigger = nav.getByRole('button', { name: 'Altro', exact: true });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Altre sezioni della cartella' });
    expect(await menu.getByRole('menuitem').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(secondaryHrefs);
    for (const href of secondaryHrefs) {
        if (!(await menu.isVisible())) await trigger.click();
        await menu.locator(`a[href="${href}"]`).click();
        await expect(menu).toBeHidden();
        await expect(page.locator(href)).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-current', 'location');
        await trigger.click();
        await expect(menu.locator(`a[href="${href}"]`)).toHaveAttribute('aria-current', 'location');
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
    }
    for (const href of primaryHrefs) {
        await nav.locator(`:scope > a[href="${href}"]`).click();
        await expect(nav.locator(`a[href="${href}"]`)).toHaveAttribute('aria-current', 'location');
        await expect(page.locator(href)).toBeVisible();
        await expect(trigger).not.toHaveAttribute('aria-current', 'location');
    }
});

for (const width of [768, 390]) test(`menu entro viewport a ${width}px, Esc, bozza e selezione conservati`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await seed(page, 1);
    await openPatientSection(page, 'terapie');
    const pane = page.locator('#terapie');
    await pane.getByRole('button', { name: 'Nuova terapia', exact: true }).click();
    await pane.getByText('Farmaco manuale o galenico', { exact: true }).click();
    const draft = pane.getByPlaceholder('Es. preparazione magistrale...');
    await draft.fill('Bozza sintetica da conservare');
    await draft.evaluate((input: HTMLInputElement) => input.setSelectionRange(6, 15));
    const nav = navigation(page);
    const trigger = nav.getByRole('button', { name: 'Altro', exact: true });
    await trigger.focus(); await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Altre sezioni della cartella' });
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(960);
    expect(await menu.evaluate(element => { const rect = element.getBoundingClientRect(); return [[rect.left + 8, rect.top + 8], [rect.right - 8, rect.bottom - 8]].every(([x, y]) => element.contains(document.elementFromPoint(x, y))); })).toBe(true);
    await page.keyboard.press('End'); await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Home'); await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape'); await expect(menu).toBeHidden(); await expect(trigger).toBeFocused();
    await openPatientSection(page, 'documenti');
    await openPatientSection(page, 'terapie');
    await expect(draft).toHaveValue('Bozza sintetica da conservare');
    await expect(pane.getByRole('checkbox', { name: 'Farmaco manuale o galenico' })).toBeChecked();
    expect(await draft.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([6, 15]);
    await draft.focus(); await expect(draft).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
});

test('regressione geometria del menu a 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 960 });
    await seed(page, 12);
    const nav = navigation(page);
    await nav.locator('summary, button[aria-haspopup="menu"]').click();
    const menu = nav.locator('[role="menu"], details[open] > div');
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x, 'bordo sinistro del menu').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(768);
    expect(await menu.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.left + 8, rect.top + 8)); }), 'il bordo sinistro deve essere visibile, non coperto dalla navigazione generale').toBe(true);
});

test('catture navigazione sintetica nei due registri', async ({ page }) => {
    test.skip(!process.env.PATIENT_NAV_EVIDENCE_DIR, 'raccolta esplicita delle catture');
    test.setTimeout(120_000);
    await seed(page, 12);
    const directory = process.env.PATIENT_NAV_EVIDENCE_DIR!;
    fs.mkdirSync(directory, { recursive: true });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const measurements = [];
    for (const theme of ['giorno', 'grafite']) for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 960 });
        await page.evaluate(theme => {
            const mode = theme === 'giorno' ? 'light' : 'dark';
            localStorage.setItem('mediflow-theme', mode);
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(mode);
        }, theme);
        const nav = navigation(page);
        const trigger = nav.locator('summary, button[aria-haspopup="menu"]');
        if (await nav.locator('details[open], [role="menu"]').count()) await page.keyboard.press('Escape');
        await nav.locator('a[href="#quadro"]').click();
        await trigger.click();
        const menu = nav.locator('[role="menu"], details[open] > div');
        measurements.push({ sha, theme, width, menu: await menu.boundingBox() });
        await page.screenshot({ path: path.join(directory, `${theme}-${width}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
    }
    fs.writeFileSync(path.join(directory, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
});

test('zoom browser reale al 200% conserva il menu nel viewport', async () => {
    test.setTimeout(120_000);
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-navigation-zoom-'));
    const extension = path.join(root, 'extension');
    fs.mkdirSync(extension);
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Synthetic navigation zoom test', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
    fs.writeFileSync(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
    const context = await chromium.launchPersistentContext(path.join(root, 'profile'), { channel: 'chromium', headless: true,
        viewport: { width: 1440, height: 960 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    try {
        const worker = await test.step('estensione zoom pronta', async () => context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 }));
        const page = await context.newPage();
        await page.goto(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000');
        await test.step('paziente sintetico per zoom', () => seed(page, 12));
        const before = await page.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio }));
        const zoom = await test.step('zoom browser 200%', () => worker.evaluate(`(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(tab => tab.url.startsWith('${process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'}/patients/')); await chrome.tabs.setZoom(tab.id, 2); return chrome.tabs.getZoom(tab.id); })()`), { timeout: 10_000 });
        expect(zoom).toBe(2);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(before.width / 2);
        expect(await page.evaluate(() => devicePixelRatio)).toBe(before.ratio * 2);
        for (const theme of ['giorno', 'grafite']) await test.step(`menu al 200% ${theme}`, async () => {
            await page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme === 'giorno' ? 'light' : 'dark'); }, theme);
            const nav = navigation(page);
            await nav.locator('summary, button[aria-haspopup="menu"]').click();
            const menu = nav.locator('[role="menu"], details[open] > div');
            const box = await menu.boundingBox();
            if (process.env.PATIENT_NAV_EVIDENCE_DIR) {
                const file = path.join(process.env.PATIENT_NAV_EVIDENCE_DIR, `${theme}-1440-zoom-200`);
                await page.screenshot({ path: `${file}.png`, animations: 'disabled' });
                fs.writeFileSync(`${file}.json`, `${JSON.stringify({ sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), theme, zoom, before, after: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio })), menu: box }, null, 2)}\n`);
            }
            expect.soft(box!.x).toBeGreaterThanOrEqual(0);
            expect.soft(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
            expect.soft(box!.y).toBeGreaterThanOrEqual(0);
            expect.soft(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
            await page.keyboard.press('Escape');
        }, { timeout: 15_000 });
    } finally {
        await test.step('chiusura profilo sintetico', () => context.close(), { timeout: 15_000 });
        fs.rmSync(root, { recursive: true, force: true });
    }
});
