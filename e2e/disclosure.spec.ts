import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

async function fixture(page: Page) {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const id = await page.evaluate(async () => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Ada sintetica', lastName: 'Disclosure', taxCode: `SYN${crypto.randomUUID().slice(0, 12)}`, birthDate: '1972-04-12', notes: 'Nota inventata. '.repeat(40) }) });
    if (!response.ok) throw new Error(`Fixture: ${response.status}`);
    return (await response.json()).id as string;
  });
  await page.goto(`/patients/${id}/modules`);
  await expect(page.getByTestId('lume-scheda-header')).toBeVisible();
  return id;
}

test('la guida appartiene solo a Terapie', async ({ page }) => {
  await fixture(page);
  await expect(page.getByText('Guida alla prescrizione', { exact: true })).toBeHidden();
  await openPatientSection(page, 'terapie');
  await expect(page.getByRole('button', { name: 'Guida alla prescrizione', exact: true })).toBeVisible();
  await openPatientSection(page, 'documenti');
  await expect(page.getByText('Guida alla prescrizione', { exact: true })).toBeHidden();
});

test('il collegamento alla guida seleziona Terapie e apre i dettagli', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { window.location.hash = 'plugin-prescribing'; });
  const guide = page.locator('#plugin-prescribing');
  const control = guide.getByRole('button', { name: 'Guida alla prescrizione', exact: true });
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Sezioni della vista' }).getByRole('link', { name: 'Terapie', exact: true })).toHaveAttribute('aria-current', 'location');
});

test('la disclosure usa un chevron e stato accessibile senza cornice', async ({ page }) => {
  await fixture(page);
  await openPatientSection(page, 'terapie');
  const guide = page.locator('#plugin-prescribing');
  const control = guide.getByRole('button', { name: 'Guida alla prescrizione', exact: true });
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  const content = page.locator(`[id="${await control.getAttribute('aria-controls')}"]`);
  await expect(content).toBeHidden();
  await expect(guide.locator('summary')).toHaveCount(0);
  await expect(control.locator('svg')).toHaveCount(1);
  for (const element of [guide, control]) {
    for (const side of ['top', 'right', 'bottom', 'left']) await expect(element).toHaveCSS(`border-${side}-width`, '0px');
    await expect(element).toHaveCSS('box-shadow', 'none');
  }
  await control.focus();
  await control.press('Space');
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await expect(content).toBeVisible();
  await control.press('Tab');
  await expect(content.getByRole('link').first()).toBeFocused();
  await control.focus();
  await control.press('Enter');
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(content).toBeHidden();
  await expect(control).toBeFocused();
});

test('chiusura e riapertura conservano il form e la bozza', async ({ page }) => {
  await fixture(page);
  await openPatientSection(page, 'parametri');
  const control = page.getByRole('button', { name: 'Nuova misura', exact: true });
  await control.click();
  const content = page.locator(`[id="${await control.getAttribute('aria-controls')}"]`);
  const value = content.getByPlaceholder('Es. 120');
  await value.fill('127');
  await value.evaluate(element => element.setAttribute('data-draft-node', 'same-node'));
  await control.click();
  await expect(content).toBeHidden();
  await expect(value).toHaveCount(1);
  await expect(value).toHaveValue('127');
  await control.click();
  await expect(value).toBeVisible();
  await expect(value).toHaveValue('127');
  await expect(value).toHaveAttribute('data-draft-node', 'same-node');
  await openPatientSection(page, 'terapie');
  await openPatientSection(page, 'parametri');
  await expect(value).toHaveValue('127');
});

test('la scheda usa la disclosure comune per i contenuti nel flusso', async ({ page }) => {
  await fixture(page);
  const surface = page.getByTestId('lume-scheda-surface');
  await expect(surface.locator('details')).toHaveCount(0);
  for (const section of ['quadro', 'terapie', 'parametri', 'documenti', 'attenzione', 'protesica', 'siss']) {
    await openPatientSection(page, section);
    for (const control of await surface.locator('[data-disclosure-control]:visible').all()) {
      await expect(control).toHaveAccessibleName(/.+/);
      await expect(control).toHaveAttribute('aria-expanded', /true|false/);
      const content = page.locator(`[id="${await control.getAttribute('aria-controls')}"]`);
      await expect(content).toHaveCount(1);
      await expect(control.locator('svg.lucide-chevron-right')).toHaveCount(1);
      for (const side of ['top', 'right', 'bottom', 'left']) await expect(control).toHaveCSS(`border-${side}-width`, '0px');
      await expect(control).toHaveCSS('min-height', '44px');
      expect(await control.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44 - 0.5);
    }
  }
});

for (const theme of ['giorno', 'grafite']) for (const width of [1440, 768, 390, 720]) {
  test(`cattura disclosure ${theme} ${width === 720 ? 'zoom-200' : width}`, async ({ page }) => {
    // CSS zoom exercises doubled controls and 720 CSS px reflow in a 1440 px viewport.
    await page.setViewportSize({ width: width === 720 ? 1440 : width, height: 960 });
    await fixture(page);
    await page.evaluate(value => {
      const theme = value === 'grafite' ? 'dark' : 'light';
      localStorage.setItem('mediflow-theme', theme);
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(theme);
    }, theme);
    if (width === 720) await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await openPatientSection(page, 'terapie');
    const guide = page.locator('#plugin-prescribing');
    const trigger = guide.getByRole('button', { name: 'Guida alla prescrizione', exact: true });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.focus();
    await trigger.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await guide.scrollIntoViewIfNeeded();
    await expect(guide.getByRole('navigation', { name: 'Tipo di prescrizione' })).toBeVisible();
    const screenshot = test.info().outputPath('disclosure.png');
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await test.info().attach('disclosure', { path: screenshot, contentType: 'image/png' });
    await assertNotClippedInViewport(trigger, 'Guida alla prescrizione');
    await assertNoHorizontalOverflow(page, [{ label: 'documento', selector: 'document' }]);
  });
}


for (const command of ['storia', 'attenzione']) {
  test(`il comando misura da ${command} focalizza il form dopo l'apertura`, async ({ page }) => {
    const patientId = await fixture(page);
    await page.evaluate(async id => {
      for (const day of ['01', '08', '15']) {
        const response = await fetch('/api/observations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patientId: id, codeSystem: 'LOINC', code: '8480-6',
            display: 'Pressione sistolica', unitSystem: 'UCUM', unitCode: 'mm[Hg]',
            value: 120, observedAt: `2026-01-${day}T08:00:00.000Z`, source: 'manual' }),
        });
        if (!response.ok) throw new Error(`Misura sintetica: ${response.status}`);
      }
    }, patientId);
    await page.reload();
    await openPatientSection(page, 'parametri');
    const control = page.getByRole('button', { name: 'Nuova misura', exact: true });
    const content = page.locator(`[id="${await control.getAttribute('aria-controls')}"]`);
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    if (command === 'storia') {
      await page.getByRole('button', { name: 'Registra nuova misura', exact: true }).click();
    } else {
      await openPatientSection(page, 'attenzione');
      await page.getByRole('button', { name: /inserisci misura/ }).click();
    }
    await expect(control).toHaveAttribute('aria-expanded', 'true');
    await expect(content.locator('select').first()).toBeFocused();
    await expect(content.getByPlaceholder('Es. 120')).toHaveValue('');
  });
}
