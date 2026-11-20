import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';
import { twinPin, withTwinRuntime } from './fixtures/runtime-twin';
import { actionSchema } from './ui-cli/commands';
import { drive } from './ui-cli/browser';

const enabled = process.env.MEDIFLOW_TEST_RUNTIME_TWIN === '1';
test.skip(!enabled, 'Requires the marked synthetic runtime twin; never target a normal instance.');
test.describe('Copertura estesa del gemello', () => {
    const patient = 'twin-086-01';
    const templates = fs.readdirSync(path.resolve('app'), { recursive: true })
        .map(file => typeof file === 'string' ? file.replaceAll('\\', '/') : file)
        .filter((file): file is string => typeof file === 'string' && /(?:^|\/)page\.tsx$/.test(file) && !file.startsWith('mockups/'))
        .map(file => '/' + file.replace(/(?:^|\/)page\.tsx$/, ''))
        .sort();
    const routes = templates.flatMap(template => template.includes('[scaleId]')
        ? ['tinetti-poma28-v1', 'adl', 'iadl', 'mmse', 'gds'].map(scale => template.replace('[id]', patient).replace('[scaleId]', scale))
        : [template.replace('[id]', patient)]);
    let context: BrowserContext;
    let page: Page;
    const evidence: Array<{ route: string; controls: number }> = [];
    const faults: string[] = [];

    test.beforeAll(async ({ browser, baseURL }) => {
        if (!enabled) return;
        const url = new URL(baseURL!);
        expect(url.hostname).toBe('127.0.0.1');
        expect(Number(url.port)).toBeGreaterThanOrEqual(3200);
        expect(Number(url.port)).toBeLessThan(3400);
        context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
        page = await context.newPage();
        page.on('pageerror', error => faults.push(error.message));
        await bootstrapUnlockedSession(page, '086086');
        await expect(page.locator('html')).toHaveAttribute('data-runtime-twin', 'true');
        await expect(page.getByTestId('runtime-twin-toolbar')).toBeVisible();
    });

    test.afterAll(async () => {
        if (!enabled) return;
        fs.mkdirSync('tmp-086-twin', { recursive: true });
        if (evidence.length) fs.writeFileSync('tmp-086-twin/routes.json', JSON.stringify({ templates: templates.length, evidence, faults }, null, 2));
        await context?.close();
    });

    for (const route of routes) {
        test(`full web route ${route}`, async () => {
            const before = faults.length;
            const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
            expect(response?.status()).toBe(200);
            await expect(page.getByTestId('runtime-twin-toolbar')).toBeVisible();
            await expect(page.locator('main, [aria-label="MediFlow lock screen"]').first()).toBeVisible();
            await unlockIfNeeded(page, '086086');
            await expect(page.locator('main').first()).toBeVisible();
            await expect(page.locator('h1').first()).toBeVisible();
            if (route === `/patients/${patient}`) await expect(page).toHaveURL(new RegExp(`/patients/${patient}/modules`));
            if (route === '/settings/ai') await expect(page).toHaveURL(/\/settings\/ai\/fabric$/);
            await page.waitForTimeout(350);
            await expect(page.getByText('This page could not be found.', { exact: true })).toHaveCount(0);
            await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toHaveCount(0);
            const controls = await page.locator('main').first().locator('a, button, input, select, textarea').count();
            evidence.push({ route, controls });
            expect(faults.slice(before)).toEqual([]);
        });
    }

    test('all cockpit areas and patient contexts remain reachable', async () => {
        for (const area of ['turno', 'incarico', 'diario', 'repertori', 'governance', 'scheda', 'revisione', 'handoff']) {
            const response = await page.goto(`/?area=${area}&paziente=${patient}`);
            expect(response?.status()).toBe(200);
            await expect(page.locator('main, [data-testid="lume-frame"]').first()).toBeVisible();
            if (area === 'scheda') await expect(page).toHaveURL(/\/modules/);
            else await expect(page.getByTestId('lume-frame')).toBeVisible();
        }
    });

    test('real diary save returns to the folder and survives reload', async () => {
        await page.goto(`/patients/${patient}/entries/new`);
        const text = `Verifica interattiva sintetica 0.8.6 (${Date.now()}). Nessun dato reale.`;
        await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill(text);
        const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/entries' && response.request().method() === 'POST');
        await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
        const response = await created;
        expect(response.status()).toBe(201);
        const saved = await response.json() as { id: string };
        try {
            await expect(page).toHaveURL(new RegExp(`/patients/${patient}/modules`));
            const entries = await page.evaluate(async () => {
                const response = await fetch('/api/entries?patientId=twin-086-01');
                if (!response.ok) throw new Error(`Diary reread ${response.status}`);
                return response.json() as Promise<Array<{ id: string; version: number; content: string }>>;
            });
            const written = entries.find(entry => entry.id === saved.id);
            expect(written?.content.startsWith('ENC:')).toBe(true);
            await page.goto(`/patients/${patient}/modules#diario`);
            await expect(page.locator('#diario').getByText(text, { exact: true }).first()).toBeVisible();
        } finally {
            const rows = await page.evaluate(async () => await (await fetch('/api/entries?patientId=twin-086-01')).json() as Array<{ id: string; version: number }>);
            const own = rows.find(row => row.id === saved.id);
            expect(own).toBeDefined();
            const deleted = await page.evaluate(async ({ id, version }) => {
                const response = await fetch(`/api/entries/${id}`, { method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }),
                });
                return response.status;
            }, { id: saved.id, version: own!.version });
            expect(deleted).toBe(200);
        }
    });


    test('settings search, mobile navigation, focus and both palettes', async () => {
        test.setTimeout(90_000);
        for (const theme of ['light', 'dark']) {
            for (const width of [1440, 390]) {
                await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
                await page.goto('/settings/aspetto');
                await page.getByRole('button', { name: theme === 'light' ? 'Tema Chiaro' : 'Tema Scuro', exact: true }).click();
                await expect(page.locator('html')).toHaveClass(new RegExp(theme));
                if (width === 390) {
                    await page.getByTestId('settings-nav-mobile-profilo').click();
                    await expect(page).toHaveURL(/\/settings\/profilo$/);
                    await expect(page.getByTestId('settings-nav-mobile-profilo')).toHaveAttribute('aria-current', 'page');
                } else {
                    await page.getByTestId('settings-nav-profilo').click();
                    await expect(page.getByTestId('settings-nav-profilo')).toHaveAttribute('aria-current', 'page');
                }
                await expect(page.locator('#doctor-name')).toBeVisible();
                expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
                await page.screenshot({ path: `tmp-086-twin/settings-${theme}-${width}.png` });
                await page.goto(`/patients/${patient}/modules`);
                await expect(page.getByTestId('lume-scheda-surface')).toBeVisible();
                expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
                await page.screenshot({ path: `tmp-086-twin/patient-${theme}-${width}.png` });
            }
        }
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.goto('/settings/profilo');
        await expect(page.locator('#doctor-name')).not.toHaveValue('');
        await page.getByRole('button', { name: /Cerca impostazione/ }).click();
        await expect(page.getByTestId('settings-search-input')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Meta+k');
        await page.getByTestId('settings-search-input').fill('accessibilità');
        await page.getByTestId('settings-search-result-aspetto').click();
        await expect(page).toHaveURL(/\/settings\/aspetto$/);
    });
});

test.describe('Qualifica Q-8', () => {
    test.setTimeout(150_000);

    const comparison = (page: Page) => page.getByRole('complementary', { name: 'Confronto del prototipo', exact: true });
    const variant = (page: Page, name: string) => comparison(page).getByRole('button', { name, exact: true });
    const setting = '/settings/profilo';

    async function waitForShell(page: Page) {
      const lock = page.getByRole('heading', { name: 'Sblocca MediFlow' });
      const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
      await expect(lock.or(navigation).first()).toBeVisible();
      await unlockIfNeeded(page, twinPin);
      await expect(navigation).toBeVisible();
    }

    async function open(page: Page, path: string) {
      await page.goto(path);
      await waitForShell(page);
    }

    async function selectVariant(page: Page, label: string, design: string, composition?: string) {
      const control = variant(page, label);
      await control.click();
      await expect(control).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-runtime-twin-design', design);
      if (composition) await expect(page.locator('html')).toHaveAttribute('data-twin-composition', composition);
    }

    async function savedProfile(page: Page, value: string) {
      const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/auth/profile' && res.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Salva profilo', exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(page.getByRole('status').filter({ hasText: 'Profilo aggiornato.' })).toBeVisible();
      const result = await page.evaluate(async () => {
        const res = await fetch('/api/auth/profile');
        return { status: res.status, displayName: (await res.json()).displayName };
      });
      expect(result).toEqual({ status: 200, displayName: value });
    }

    test('Q-8 S061: conserva la bozza del profilo e rilegge il salvataggio dopo il blocco', async () => {
        await withTwinRuntime('comparison', async page => {
            await bootstrapUnlockedSession(page, twinPin);
            await expect(page.locator('html')).toHaveAttribute('data-runtime-twin', 'true');
            await open(page, setting);
            const name = page.getByLabel('Nome medico', { exact: true });
            await expect(name).toBeEnabled();
            await expect(name).not.toHaveValue('');
            const original = await name.inputValue();
            const draft = 'Medico sintetico WUL-865';
            await name.fill(draft);
            await test.step('Originale e A conservano il campo compilato', async () => {
              await selectVariant(page, 'Originale', 'original');
              await expect(name).toHaveValue(draft);
              await selectVariant(page, 'A · Postazione', 'proposal', 'workbench');
              await expect(name).toHaveValue(draft);
            });
            await test.step('Salva, rileggi dal server, ricarica e ripristina il valore sintetico', async () => {
              await savedProfile(page, draft);
              await page.reload();
              await waitForShell(page);
              await expect(name).toHaveValue(draft);
              await name.fill(original);
              await savedProfile(page, original);
            });
            await test.step('Blocca dalla seconda scheda e ricarica la prima', async () => {
              const peer = await page.context().newPage();
              try {
                await peer.goto(setting);
                await expect(peer.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
                await peer.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
                await expect(peer.getByLabel('Nome medico', { exact: true })).toHaveValue(original);
                const locked = peer.waitForResponse(res => new URL(res.url()).pathname === '/api/auth/lock' && res.request().method() === 'POST');
                await peer.getByRole('button', { name: 'Blocca', exact: true }).click();
                const receipt = await locked;
                expect(receipt.status()).toBe(200);
                expect(await receipt.json()).toMatchObject({ state: 'server_invalidation_confirmed' });
                await expect(peer.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
                const auth = await page.request.get(new URL('/api/auth/check', page.url()).href);
                expect(auth.status()).toBe(200);
                expect(await auth.json()).toMatchObject({ hasSession: false });
                await page.reload();
                await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
                await unlockIfNeeded(page, twinPin);
                await expect(name).toHaveValue(original);
              } finally { await peer.close(); }
            });
        });
    });

    for (const id of ['S062', 'S103']) {
        test(`Q-8 ${id}: primo accesso ufficiale e kit su un archivio vuoto`, async ({}, info) => {
            const actions = fs.readFileSync(path.join(__dirname, 'ui-cli/web-091.jsonl'), 'utf8')
                .trim().split('\n').map(line => actionSchema.parse(JSON.parse(line)));
            const end = actions.findIndex(action => action.op === 'click' && !Array.isArray(action.target)
                && 'name' in action.target && action.target.name === 'Apri la cartella manualmente');
            expect(end, 'Il copione CLI deve completare il primo accesso').toBeGreaterThan(0);
            const onboarding = actions.slice(0, end + 1);
            expect(onboarding.filter(action => action.op === 'download')).toHaveLength(1);
            await withTwinRuntime('first-run', async page => {
                await page.goto('/');
                await expect(page.locator('html')).not.toHaveAttribute('data-runtime-twin');
                await expect(page.getByTestId('runtime-twin-toolbar')).toHaveCount(0);
                for (const [index, action] of onboarding.entries()) {
                    const result = await test.step(`${index + 1} ${action.op}`, () => drive(page, action, info.outputDir));
                    if (action.op === 'download') {
                        expect(result).toMatchObject({ name: 'mediflow-recovery-kit.json', sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
                        expect((result as { bytes: number }).bytes).toBeGreaterThan(0);
                        await info.attach('kit.json', { body: JSON.stringify(result), contentType: 'application/json' });
                    }
                }
                await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
                await expect(page.getByTestId('runtime-twin-toolbar')).toHaveCount(0);
            });
        });
    }
});
