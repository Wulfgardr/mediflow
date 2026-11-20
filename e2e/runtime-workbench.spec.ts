import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';
import { switchPreset } from './fixtures/territorial-preset';
import { twinPin, withTwinRuntime } from './fixtures/runtime-twin';
const enabled = process.env.MEDIFLOW_TEST_RUNTIME_TWIN === '1';
test.skip(!enabled, 'Requires the isolated synthetic twin.');
test.describe('Copertura estesa del gemello', () => {
    let context: BrowserContext;
    let page: Page;
    const errors: string[] = [];
    const choose = async (name: string) => page.getByTestId('runtime-twin-toolbar').getByRole('button', { name, exact: true }).click();
    test.beforeAll(async ({ browser, baseURL }) => {
      if (!enabled) return;
      const url = new URL(baseURL!);
      expect(url.hostname).toBe('127.0.0.1'); expect(+url.port).toBeGreaterThanOrEqual(3200); expect(+url.port).toBeLessThan(3400);
      context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
      page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await bootstrapUnlockedSession(page, '086086');
      await expect(page.getByRole('navigation', { name: 'Navigazione principale' }).or(page.getByRole('heading', { name: 'Sblocca MediFlow' })).first()).toBeVisible();
      await unlockIfNeeded(page, '086086');
      await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-runtime-twin', 'true');
      fs.mkdirSync('tmp-086-twin/workbench-review', { recursive: true });
    });
    test.afterAll(async () => { if (enabled) { fs.writeFileSync('tmp-086-twin/workbench-review/errors.json', JSON.stringify(errors)); await context?.close(); } });

    test('progressive entry preserves writing through tools, comparison and cancelled navigation', async () => {
      await page.goto('/patients/twin-086-02/entries/new');
      await expect(page.getByTestId('progressive-entry-composer')).toBeVisible();
      const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
      const draft = 'Nota sintetica non salvata per verifica della composizione.';
      await editor.fill(draft);
      await page.locator('summary').filter({ hasText: 'Bozza locale e sessione' }).click();
      await expect(editor).toContainText(draft);
      await page.locator('summary').filter({ hasText: 'Consulta cartella' }).click();
      await expect(editor).toContainText(draft);
      await choose('B · Diario'); await expect(editor).toContainText(draft);
      await choose('Originale'); await expect(editor).toContainText(draft);
      await choose('A · Postazione'); await expect(editor).toContainText(draft);
      await page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link', { name: 'Pazienti', exact: true }).click();
      const leaveDialog = page.getByRole('dialog', { name: 'Lasciare la compilazione?' });
      await expect(leaveDialog).toBeVisible();
      await leaveDialog.getByRole('button', { name: 'Continua la compilazione' }).click();
      await expect(editor).toContainText(draft);
      await page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: 'Chiudi cartella 1', exact: true }).click();
      await leaveDialog.getByRole('button', { name: 'Esci senza salvare' }).click();
      await expect(page).toHaveURL(/\/?\?area=incarico/);
      await expect(page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: 'Sintetica Persona 02', exact: true })).toHaveCount(0);
      await page.goto('/patients/twin-086-02/modules');
    });
});

test.describe('Qualifica Q-8', () => {
    test.setTimeout(150_000);

    const shell = (page: Page) => page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    const lock = (page: Page) => page.getByRole('heading', { name: 'Sblocca MediFlow' });
    const sections = ['quadro', 'attenzione', 'identita', 'parametri', 'terapie', 'prestazioni', 'protesica',
      'scale', 'documenti', 'siss', 'timeline', 'diario', 'follow-up'];
    const note = 'Resoconto sintetico per misurare lo spazio effettivo in una voce di diario.';
    const withoutComparison = async (page: Page) => {
      await expect(page.locator('html')).not.toHaveAttribute('data-runtime-twin');
      await expect(page.getByTestId('runtime-twin-toolbar')).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Confronto del prototipo' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Originale', exact: true })).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Studio di interfaccia · dati sintetici');
    };

    async function waitForShell(page: Page) {
      await expect(lock(page).or(shell(page)).first()).toBeVisible();
      await unlockIfNeeded(page, twinPin);
      await expect(shell(page)).toBeVisible();
    }

    async function open(page: Page, path: string) {
      await page.goto(path);
      await waitForShell(page);
    }

    async function seed(page: Page) {
      return page.evaluate(async () => {
        const suffix = crypto.randomUUID().slice(0, 6);
        const records = [];
        for (const firstName of ['Prima', 'Seconda']) {
          const id = crypto.randomUUID();
          const lastName = 'Qotto ' + suffix;
          const res = await fetch('/api/patients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, firstName, lastName, taxCode: 'Q8' + id.replaceAll('-', '').slice(0, 14), birthDate: '1980-02-01' }),
          });
          if (res.status !== 201) throw Error(`Paziente sintetico: HTTP ${res.status}`);
          records.push({ id, name: `${lastName} ${firstName}`, suffix, path: `/patients/${id}/modules` });
        }
        return records;
      });
    }

    async function addNote(page: Page) {
      await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
      await page.getByRole('combobox', { name: 'Tipo di voce' }).selectOption('note');
      await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill(note);
      await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
      const saved = page.waitForResponse(res => new URL(res.url()).pathname === '/api/entries' && res.request().method() === 'POST');
      await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
      expect((await saved).status()).toBe(201);
      await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
    }

    async function openRecordsWithKeyboard(page: Page, records: Awaited<ReturnType<typeof seed>>) {
      for (const record of records) {
        await shell(page).getByRole('link', { name: 'Pazienti', exact: true }).click();
        await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' }).fill(record.suffix);
        const row = page.getByTestId('lume-patient-row').filter({ hasText: record.name });
        await row.focus();
        await expect(row).toBeFocused();
        await row.press('Enter');
        await expect(page).toHaveURL(url => url.pathname === record.path);
        await expect(page.getByRole('heading', { name: record.name, exact: true })).toBeVisible();
      }
    }

    test('Q-8 S105: A e B mantengono le superfici entro desktop, telefono e finestra corta', async ({}, info) => {
      await withTwinRuntime('official', async page => {
        await bootstrapUnlockedSession(page, twinPin);
        const [record] = await seed(page);
        await open(page, record.path);
        await addNote(page);
        const samples: Array<{
          width: number;
          height: number;
          layout: string;
          action: [number, number];
          workspace: number;
          textInset: number[];
        }> = [];
        for (const [width, height] of [[1440, 960], [390, 844], [320, 760], [900, 620]]) {
          await page.setViewportSize({ width, height });
          for (const [label, value] of [['Barra laterale', 'workbench'], ['Barra superiore', 'stream']]) {
            await test.step(`${width}×${height}, ${label}`, async () => {
              await open(page, '/settings/aspetto');
              const radio = page.getByRole('radio', { name: label, exact: true });
              await radio.check();
              await page.reload();
              await waitForShell(page);
              await expect(radio).toBeChecked();
              await assertNoHorizontalOverflow(page, [{ label: 'documento', selector: 'document' }, { label: 'aspetto', selector: '[data-testid="settings-appearance-section"]' }]);
              await withoutComparison(page);
              await open(page, record.path);
              await expect(page.locator('html')).toHaveAttribute('data-twin-composition', value);
              await expect(page.getByRole('heading', { name: record.name, exact: true })).toBeVisible();
              await openPatientSection(page, 'diario');
              const article = page.locator('#diario article').filter({ hasText: note });
              await expect(article).toBeVisible();
              const prose = article.getByText(note, { exact: true });
              await expect(prose).toBeVisible();
              const textInset = await prose.evaluate(element => {
                const box = element.getBoundingClientRect();
                return [box.left, innerWidth - box.right];
              });
              expect(Math.min(...textInset)).toBeGreaterThanOrEqual(16);
              const action = article.getByRole('button', { name: /^Azioni voce/ });
              const box = await action.boundingBox();
              expect(box).not.toBeNull();
              expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
              await action.click();
              await expect(page.getByRole('menuitem', { name: 'Elimina voce clinica con motivazione' })).toBeVisible();
              await page.keyboard.press('Escape');
              await assertNoHorizontalOverflow(page, [{ label: 'documento', selector: 'document' }, { label: 'postazione', selector: '[data-twin-workspace]' }]);
              const workspace = await page.locator('[data-twin-workspace]').boundingBox();
              expect(workspace!.width).toBeLessThanOrEqual(width);
              samples.push({ width, height, layout: value, action: [box!.width, box!.height], workspace: workspace!.width, textInset });
              await info.attach(`${value}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
            });
          }
          await open(page, `/patients/${record.id}/entries/new`);
          await expect(page.getByRole('textbox', { name: 'Resoconto clinico', exact: true })).toBeVisible();
          await assertNoHorizontalOverflow(page, [{ label: 'compositore', selector: 'document' }]);
          await open(page, '/settings');
          await expect(page.getByTestId('settings-overview-section')).toBeVisible();
          await expect(page.getByText('Home-base disattivato.', { exact: true })).toBeVisible();
          const privacy = page.getByTestId('privacy-mode-header-toggle');
          await expect(privacy).toBeVisible();
          const privacyBox = await privacy.boundingBox();
          expect(privacyBox).not.toBeNull();
          expect(Math.abs(privacyBox!.width - privacyBox!.height)).toBeLessThan(2);
          await assertNoHorizontalOverflow(page, [{ label: 'impostazioni', selector: 'document' }]);
        }
        await info.attach('geometria', { body: JSON.stringify(samples), contentType: 'application/json' });
      });
    });

    test('Q-8 S104: raggiunge i tredici moduli e conserva la bozza di terapia nel confronto', async () => {
      await withTwinRuntime('comparison', async page => {
        await bootstrapUnlockedSession(page, twinPin);
        await expect(page.locator('html')).toHaveAttribute('data-runtime-twin', 'true');
        await switchPreset(page, 'core+it+lom');
        const [first, second] = await seed(page);
        await open(page, '/?area=incarico');
        await openRecordsWithKeyboard(page, [second, first]);
        for (const section of sections) {
          await test.step(section, () => openPatientSection(page, section));
        }
        await openPatientSection(page, 'terapie');
        const panel = page.locator('#terapie');
        await panel.getByRole('button', { name: 'Nuova terapia', exact: true }).click();
        const field = panel.getByPlaceholder('Es. 1 cp ore 8:00, 1/2 cp ore 20:00');
        const draft = 'Bozza sintetica non salvata';
        await field.fill(draft);
        await openPatientSection(page, 'parametri');
        await openPatientSection(page, 'terapie');
        await expect(field).toHaveValue(draft);
        const toolbar = page.getByTestId('runtime-twin-toolbar');
        for (const [label, design, composition] of [
          ['B · Diario', 'proposal', 'stream'], ['Originale', 'original'], ['A · Postazione', 'proposal', 'workbench'],
        ]) {
          const control = toolbar.getByRole('button', { name: label, exact: true });
          await control.click();
          await expect(control).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('html')).toHaveAttribute('data-runtime-twin-design', design);
          if (composition) await expect(page.locator('html')).toHaveAttribute('data-twin-composition', composition);
          await expect(field).toHaveValue(draft);
        }
        const tabs = page.getByRole('navigation', { name: 'Cartelle aperte', exact: true });
        const other = tabs.getByRole('link', { name: second.name, exact: true });
        await expect(other).toHaveAttribute('href', second.path);
        await other.click();
        await page.getByRole('dialog', { name: 'Lasciare la compilazione?' })
          .getByRole('button', { name: 'Continua la compilazione' }).click();
        await expect(page).toHaveURL(url => url.pathname === first.path);
        await expect(field).toHaveValue(draft);
        await panel.getByRole('button', { name: 'Chiudi scheda terapia', exact: true }).click();
        await expect(field).toHaveCount(0);
      });
    });
});
