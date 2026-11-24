import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  openUnlockedDocument,
  assertKeyboardFocusProgresses,
  assertNoHorizontalOverflow,
  assertNotClippedInViewport,
  bootstrapUnlockedSession,
  openPatientSection,
  REFLOW_PROXY_VIEWPORTS,
  type ReflowProxyViewport,
} from './utils';

type QuadroCase = {
  register: 'giorno' | 'grafite';
  viewport: ReflowProxyViewport['viewport'];
  width: number;
  height: number;
};

const QUADRO_CASES: QuadroCase[] = (['giorno', 'grafite'] as const).flatMap((register) =>
  REFLOW_PROXY_VIEWPORTS.map((viewport) => ({ register, ...viewport })),
);

type LivePatientFixture = { id: string; name: string };

async function createLivePatientFixture(page: Page): Promise<LivePatientFixture> {
  const marker = Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 6);
  const firstName = `Quadro${marker}`;
  const lastName = `Live${marker}`;

  return page.evaluate(async ({ firstName: fixtureFirstName, lastName: fixtureLastName, marker: fixtureMarker }) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: fixtureFirstName,
        lastName: fixtureLastName,
        taxCode: `QDR${fixtureMarker.padStart(13, '0')}`,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico Quadro',
        phone: '0000000098',
        notes: 'Voce dimostrativa della cartella. Nessun dato reale.',
        diagnoses: [{
          system: 'ICD-11',
          code: 'QC00',
          description: 'Controllo sintetico del Quadro',
          date: new Date().toISOString(),
        }],
      }),
    });
    if (!response.ok) throw new Error(`Failed to create Quadro fixture: ${response.status}`);
    const data = await response.json() as { id: string };
    for (const [path, body] of [
      ['/api/therapies', { patientId: data.id, drugName: 'Ramipril sintetico', dosage: '5 mg · 1-0-0', status: 'active', startDate: '2026-07-01T08:00:00.000Z' }],
      ['/api/observations', { patientId: data.id, codeSystem: 'LOINC', code: '8480-6', display: 'Pressione sistolica', unitSystem: 'UCUM', unitCode: 'mm[Hg]', value: 160, refHigh: '140', observedAt: '2026-09-01T08:00:00.000Z', source: 'manual' }],
      ['/api/checkups', { patientId: data.id, title: 'Controllo sintetico programmato', date: '2027-01-10T09:00:00.000Z', status: 'pending', source: 'manual' }],
    ] as const) {
      const created = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!created.ok) throw new Error(`Fixture Quadro ${path}: HTTP ${created.status}`);
    }
    return { id: data.id, name: `${fixtureLastName} ${fixtureFirstName}` };
  }, { firstName, lastName, marker });
}

async function setRegister(page: Page, register: QuadroCase['register']): Promise<void> {
  await page.evaluate((nextRegister) => {
    const theme = nextRegister === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, register);
}

async function openSyntheticQuadro(page: Page, quadroCase: QuadroCase): Promise<{ quadro: Locator; patient: LivePatientFixture }> {
  await page.setViewportSize({ width: quadroCase.width, height: quadroCase.height });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createLivePatientFixture(page);
  await openUnlockedDocument(page, `/patients/${patient.id}/modules#quadro`);
  await setRegister(page, quadroCase.register);
  const quadro = page.getByRole('region', { name: 'Riepilogo clinico', exact: true });
  await expect(quadro).toBeVisible();
  await expect(quadro.getByRole('table', { name: 'Terapie attive', exact: true }).getByText('Ramipril sintetico', { exact: true })).toBeVisible();
  await expect(quadro.getByText('Controllo sintetico programmato', { exact: true })).toBeVisible();
  return { quadro, patient };
}

async function resolveColor(scope: Locator, variable: string): Promise<string> {
  return scope.evaluate((element, name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    element.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}

async function assertQuadroContract(page: Page, quadro: Locator, patient: LivePatientFixture): Promise<void> {
  await expect(page.getByRole('heading', { name: patient.name, level: 1 })).toHaveCount(1);
  await expect(quadro.getByRole('heading', { name: /^Problemi/ })).toBeVisible();
  await expect(quadro.getByText('Controllo sintetico del Quadro', { exact: true })).toBeVisible();
  const activeTherapy = quadro.getByRole('table', { name: 'Terapie attive', exact: true }).getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'Ramipril sintetico', exact: true }) });
  await expect(activeTherapy.getByRole('cell', { name: '5 mg · 1-0-0', exact: true })).toBeVisible();
  await expect(quadro.locator('table [aria-pressed]')).toHaveCount(0);
  const shadows = await quadro.evaluate((element) => [element, ...element.querySelectorAll('*')]
    .filter(node => (node as HTMLElement).offsetParent !== null && getComputedStyle(node).boxShadow !== 'none')
    .map(node => ({ tray: node.getAttribute('data-record-tray'), shadow: getComputedStyle(node).boxShadow })));
  for (const { tray, shadow } of shadows) {
    expect(tray).toMatch(/^(stabile|cambiato|contesto)$/);
    expect(shadow.match(/\binset\b/g)).toHaveLength(3);
  }
  if (page.viewportSize()!.width >= 1280) expect(shadows).toHaveLength(3);
  if (page.viewportSize()!.width <= 390) expect(shadows).toHaveLength(0);
  await expect(page.getByTestId('lume-scheda-surface')).toHaveCSS('box-shadow', 'none');

  const measure = quadro.getByRole('region', { name: 'Parametri recenti', exact: true });
  const value = measure.getByRole('cell', { name: /160 mmHg/ });
  await expect(value).toContainText('160 mmHg');
  await expect(value).toHaveCSS('color', await resolveColor(quadro, '--lume-signal-critical'));
  await expect(value).toHaveCSS('font-variant-numeric', 'tabular-nums');
  await expect(value).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(value).toHaveCSS('border-left-width', '0px');
  await expect(value).toHaveCSS('border-radius', '0px');
  await expect(quadro.getByRole('table', { name: 'Terapie attive', exact: true }).getByText('Ramipril sintetico', { exact: true }))
    .toHaveCSS('color', await resolveColor(quadro, '--lume-ink'));

  const hierarchy = await measure.evaluate(element => {
    const heading = element.querySelector('th')!;
    const number = element.querySelector('tbody td:nth-child(2)')!;
    const date = element.querySelector('time')!;
    return { heading: parseFloat(getComputedStyle(heading).fontSize), number: parseFloat(getComputedStyle(number).fontSize),
      headingWeight: parseFloat(getComputedStyle(heading).fontWeight), dateWeight: parseFloat(getComputedStyle(date).fontWeight) };
  });
  expect(hierarchy.headingWeight).toBeGreaterThan(hierarchy.dateWeight);
  expect(hierarchy.number).toBeGreaterThan(hierarchy.heading);

  const diary = page.locator('#diario');
  await expect(diary).toBeVisible();
  const problemsBox = (await quadro.getByRole('region', { name: 'Problemi', exact: true }).boundingBox())!;
  const diaryBox = (await diary.boundingBox())!;
  if (page.viewportSize()!.width >= 1280) {
    const contextBox = (await measure.boundingBox())!;
    expect(diaryBox.x).toBeGreaterThanOrEqual(problemsBox.x + problemsBox.width);
    expect(contextBox.x).toBeGreaterThanOrEqual(diaryBox.x + diaryBox.width);
  }

  const primary = page.getByTestId('lume-scheda-header').getByRole('link', { name: 'Nuova voce', exact: true });
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAttribute('href', `/patients/${patient.id}/modules?voce=nuova`);
  await expect(primary).toHaveCSS('background-color', await resolveColor(primary, '--lume-accent'));
  await assertNotClippedInViewport(primary, 'azione primaria quadro');
  await assertKeyboardFocusProgresses(page, primary, 'azione primaria quadro');
  for (const link of await quadro.getByRole('link').all()) await assertNotClippedInViewport(link, await link.innerText());
}

async function assertReflowStack(quadro: Locator): Promise<void> {
  const regions = [
    quadro.getByRole('region', { name: 'Terapie attive', exact: true }),
    quadro.getByRole('region', { name: 'Problemi', exact: true }),
    quadro.locator('#diario'),
    quadro.getByRole('region', { name: 'Parametri recenti', exact: true }),
  ];
  const changed = (await quadro.getByRole('heading', { name: 'Cambiato dall’ultima visita', exact: true }).boundingBox())!;
  expect((await regions[0].boundingBox())!.y).toBeGreaterThan(changed.y + changed.height);
  let previous: { x: number; y: number; height: number } | undefined;
  for (const region of regions) {
    await expect(region).toBeVisible();
    const box = (await region.boundingBox())!;
    if (previous) {
      expect(box.y).toBeGreaterThanOrEqual(previous.y + previous.height);
      expect(Math.abs(box.x - previous.x)).toBeLessThanOrEqual(1);
    }
    previous = box;
  }
}

test('la navigazione Quadro del paziente selezionato converge sulla Scheda', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createLivePatientFixture(page);
  await openUnlockedDocument(page, `/?area=incarico&paziente=${patient.id}`);
  const row = page.getByRole('option').filter({ has: page.getByText(patient.name, { exact: true }) });
  await expect(row).toBeVisible();
  await row.focus();
  await expect(row).toBeFocused();
  await row.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`));
  await page.getByRole('navigation', { name: 'Sezioni della vista' }).getByRole('link', { name: 'Riepilogo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Riepilogo clinico', exact: true })).toBeVisible();
  await expect(page.getByTestId('lume-scheda-header')).toHaveCount(1);
  await expect(page.getByTestId('lume-quadro')).toHaveCount(0);
});

for (const quadroCase of QUADRO_CASES) {
  test(`quadro Lume ${quadroCase.register} ${quadroCase.viewport}`, async ({ page }) => {
    const { quadro, patient } = await openSyntheticQuadro(page, quadroCase);
    await expect(page.locator('html')).toHaveClass(quadroCase.register === 'grafite' ? /dark/ : /light/);
    await assertQuadroContract(page, quadro, patient);
    await assertNoHorizontalOverflow(page, [
      { label: 'documento quadro', selector: 'document' },
      { label: 'quadro', selector: '#quadro' },
    ]);
    if (quadroCase.width <= 390) await assertReflowStack(quadro);
    await page.screenshot({ path: test.info().outputPath('quadro.png'), fullPage: true, animations: 'disabled' });
    await openPatientSection(page, 'terapie');
    await expect(page.locator('#terapie')).toHaveAttribute('data-folder-active', 'true');
    await expect(page.locator('#terapie')).toContainText('Ramipril sintetico');
    if (quadroCase.width === 320) {
      const sectionNavigation = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
      const moreSections = sectionNavigation.getByRole('button', { name: 'Altro', exact: true });
      await moreSections.focus();
      await page.keyboard.press('Enter');
      await expect(sectionNavigation.locator('a[href="#follow-up"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(moreSections).toBeFocused();
    }
    await openPatientSection(page, 'parametri');
    await expect(page.locator('#parametri')).toContainText('160');
    await openPatientSection(page, 'follow-up');
    await expect(page.locator('#follow-up')).toContainText('Controllo sintetico programmato');
  });
}
