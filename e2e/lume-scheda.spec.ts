/* @Codex LUME-104/68 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

type SchedaCase = { register: 'giorno' | 'grafite'; viewport: 'wide' | 'narrow'; width: number; height: number };
const CASES: SchedaCase[] = [
  { register: 'giorno', viewport: 'wide', width: 1440, height: 960 },
  { register: 'grafite', viewport: 'wide', width: 1440, height: 960 },
  { register: 'giorno', viewport: 'narrow', width: 390, height: 844 },
  { register: 'grafite', viewport: 'narrow', width: 390, height: 844 },
];

async function createFixture(page: Page): Promise<{ id: string; name: string }> {
  const marker = `${Date.now()}`.slice(-8) + Math.random().toString(36).slice(2, 7).toUpperCase();
  return page.evaluate(async (suffix) => {
    const firstName = `Scheda${suffix.slice(0, 5)}`;
    const lastName = `Lume${suffix.slice(5)}`;
    const patientResponse = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName, lastName, taxCode: `SCH${suffix}`, birthDate: '1972-04-12T00:00:00.000Z',
        address: 'Indirizzo sintetico Scheda', phone: '0000000104',
        notes: Array.from({ length: 40 }, (_, index) => `Nota sintetica ${index + 1}. Voce dimostrativa della cartella, nessun dato reale.`).join('\n'),
        diagnoses: [{ system: 'ICD-11', code: 'SC00', description: 'Controllo sintetico della Scheda', date: '2026-07-16T08:00:00.000Z' }],
      }),
    });
    if (!patientResponse.ok) throw new Error(`Fixture paziente: HTTP ${patientResponse.status}`);
    const { id } = await patientResponse.json() as { id: string };
    const therapyResponse = await fetch('/api/therapies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: id, drugName: 'Ramipril sintetico', activePrinciple: 'Ramipril', dosage: '5 mg · 1-0-0', status: 'active', startDate: '2026-07-01T08:00:00.000Z' }),
    });
    if (!therapyResponse.ok) throw new Error(`Fixture terapia: HTTP ${therapyResponse.status}`);
    return { id, name: `${lastName} ${firstName}` };
  }, marker);
}

async function setRegister(page: Page, register: SchedaCase['register']): Promise<void> {
  await page.evaluate((value) => {
    const theme = value === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, register);
}

async function prepareStableInsightHydration(page: Page): Promise<{ loaded: Promise<void> }> {
  await page.evaluate(async () => {
    for (const [key, value] of [['aiDocumentSynthesisKillSwitch', 'enabled'], ['aiPatientInsightKillSwitch', 'enabled'], ['aiSmartImportKillSwitch', 'disabled']]) {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) throw new Error(`Fixture impostazione ${key}: HTTP ${response.status}`);
    }
  });

  /* Riproduce deterministicamente la gara osservata nella suite completa: la
     sintesi documentale risponde prima di Patient Insight. Il prodotto deve
     attendere entrambe prima di decidere se aprire Archivio documenti. */
  await page.route('**/api/settings/aiPatientInsightKillSwitch', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  const patientInsightLoaded = page.waitForResponse((response) =>
    response.request().method() === 'GET'
      && response.url().endsWith('/api/settings/aiPatientInsightKillSwitch'));
  return { loaded: patientInsightLoaded.then(() => undefined) };
}

/* @Codex ADR 0123: the canonical folder owns thirteen destinations. The
   record tab preserves identity while the reading pane scrolls. */
async function expectInViewport(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
  })).toBe(true);
}

async function expectSurfaceHierarchyAndNeutralChrome(page: Page, header: Locator, minimum: number): Promise<void> {
  const evidence = await header.evaluate(element => {
    const icons = [...element.querySelectorAll('svg')].filter(icon => icon.getBoundingClientRect().width > 0)
      .map(icon => ({ color: getComputedStyle(icon).color, owner: getComputedStyle(icon.parentElement!).color }));
    const targets = [...element.querySelectorAll<HTMLElement>('a, button')].filter(control => control.offsetParent !== null)
      .map(control => ({ label: control.textContent?.trim(), width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height }));
    const h1 = element.querySelector('h1')!;
    const atoms = element.querySelector('p')!;
    const style = getComputedStyle(element);
    return { icons, targets, title: parseFloat(getComputedStyle(h1).fontSize), atoms: parseFloat(getComputedStyle(atoms).fontSize),
      leftPadding: parseFloat(style.paddingLeft), rightPadding: parseFloat(style.paddingRight) };
  });
  expect(evidence.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of evidence.icons) expect(icon.color).toBe(icon.owner);
  expect(evidence.targets.length).toBeGreaterThanOrEqual(2);
  for (const target of evidence.targets) {
    expect.soft(target.width, `${target.label}: larghezza target`).toBeGreaterThanOrEqual(minimum);
    expect.soft(target.height, `${target.label}: altezza target`).toBeGreaterThanOrEqual(minimum);
  }
  expect(evidence.title).toBeGreaterThan(evidence.atoms);
  expect(evidence.leftPadding).toBeGreaterThanOrEqual(16);
  expect(evidence.rightPadding).toBeGreaterThanOrEqual(16);
  const surface = page.getByTestId('lume-scheda-surface');
  await expect(surface).toHaveCSS('box-shadow', 'none');
  await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(header).toHaveCSS('box-shadow', 'none');
  for (const control of await header.locator('a, button').all()) {
    if (await control.isVisible()) await assertNotClippedInViewport(control, await control.innerText());
  }
}

async function expectCurrentSection(page: Page, id: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Sezioni della vista' });
  const link = nav.locator(`a[href="#${id}"]`);
  await expect(link).toHaveAttribute('aria-current', 'location');
  await expect(nav.locator('a[aria-current="location"]')).toHaveCount(1);
  // A closed disclosure carries the location marker of its hidden active link.
  await expect(nav.locator('[aria-current="location"]:visible')).toHaveCount(1);
  await expect(page.locator(`#${id}`)).toBeVisible();
}

test('la route legacy paziente converge sulla sola Scheda', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createFixture(page);
  await page.goto(`/patients/${patient.id}`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`));
  await expect(page.getByTestId('lume-scheda-header')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: patient.name, level: 1 })).toHaveCount(1);
  await expect(page.getByTestId('lume-quadro')).toHaveCount(0);
});

test('il controllo back della Scheda torna alla lista pazienti', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createFixture(page);
  await page.goto(`/patients/${patient.id}/modules`);
  const backControl = page.getByRole('navigation', { name: 'Cartelle aperte' })
    .getByRole('link', { name: 'Pazienti', exact: true });
  await expect(backControl).toHaveAttribute('href', '/?area=incarico');
  await backControl.click();
  await expect(page).toHaveURL(/\?area=incarico(?:&paziente=[^&]+)?$/);
  await expect(page.getByTestId('lume-scheda-header')).toHaveCount(0);
  await expect(page.getByTestId('lume-worklist')).toBeVisible();
});

test('le tredici sezioni restano raggiungibili con una sola destinazione corrente', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createFixture(page);
  await page.goto(`/patients/${patient.id}/modules`);
  const nav = page.getByRole('navigation', { name: 'Sezioni della vista' });
  const sections = ['quadro', 'attenzione', 'identita', 'parametri', 'terapie', 'prestazioni',
    'protesica', 'scale', 'documenti', 'siss', 'timeline', 'diario', 'follow-up'];
  await expect(nav.locator('a')).toHaveCount(13);
  expect((await nav.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))).sort())
    .toEqual(sections.map(id => `#${id}`).sort());
  await expectCurrentSection(page, 'diario');
  const disclosure = nav.locator('summary');
  const details = nav.locator('details');
  await disclosure.focus();
  await disclosure.press('Space');
  await expect(details).toHaveAttribute('open', '');
  await disclosure.press('Enter');
  await expect(details).not.toHaveAttribute('open');
  await expectCurrentSection(page, 'diario');
  for (const id of sections) {
    const link = nav.locator(`a[href="#${id}"]`);
    if (!(await link.isVisible())) {
      await disclosure.focus();
      await disclosure.press('Enter');
    }
    await link.focus();
    await link.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expectCurrentSection(page, id);
  }
  await page.goBack();
  await expectCurrentSection(page, 'diario');
  await page.goForward();
  await expectCurrentSection(page, 'follow-up');
});

/* @Codex WUL-678: prove the folder action reaches the existing planner. */
test('il follow-up apre il pianificatore canonico dalla cartella', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createFixture(page);
  await page.goto(`/patients/${patient.id}/modules`);
  await openPatientSection(page, 'follow-up');

  const action = page.getByRole('link', { name: 'Aggiungi follow-up', exact: true });
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute('href', `/patients/${patient.id}/edit#pianificazione`);
  const geometry = await action.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height, radius: style.borderRadius };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.radius).toBe('12px');

  await action.click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/edit#pianificazione$`));
  const planning = page.locator('#pianificazione');
  await expect(planning).toBeVisible();
  await expect(planning.getByRole('heading', { name: 'Prossimi passaggi', exact: true })).toBeVisible();
  await planning.scrollIntoViewIfNeeded();
  const addPassage = planning.getByRole('button', { name: 'Aggiungi passaggio', exact: true });
  await expect(addPassage).toBeVisible();
  await addPassage.click();
  await expect(planning.locator('input[type="date"]')).toHaveCount(1);
  await expect(planning.getByText('Data prevista', { exact: true })).toBeVisible();
  await expect(planning.getByText('Prossimo passaggio', { exact: true })).toBeVisible();
});

for (const schedaCase of CASES) {
  test(`Scheda Lume ${schedaCase.register} ${schedaCase.viewport}`, async ({ page }) => {
    await page.setViewportSize({ width: schedaCase.width, height: schedaCase.height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patient = await createFixture(page);
    const insightHydration = await prepareStableInsightHydration(page);
    await page.goto(`/patients/${patient.id}/modules`);
    await insightHydration.loaded;
    await setRegister(page, schedaCase.register);
    await expect(page.locator('html')).toHaveClass(schedaCase.register === 'grafite' ? /dark/ : /light/);
    const header = page.getByTestId('lume-scheda-header');
    const surface = page.getByTestId('lume-scheda-surface');
    await expect(header.getByRole('heading', { name: patient.name, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: patient.name, level: 1 })).toHaveCount(1);
    // Late settings must not steal the active folder section or reveal documents.
    await expectCurrentSection(page, 'diario');
    await expect(page.locator('#documenti')).toBeHidden();
    await expectSurfaceHierarchyAndNeutralChrome(page, header, schedaCase.viewport === 'narrow' ? 44 : 28);
    await expectInViewport(header);

    await page.getByRole('navigation', { name: 'Sezioni della vista' }).getByRole('link', { name: 'Riepilogo', exact: true }).click();
    // @Codex: the hash precedes the asynchronous folder visibility update.
    await expect(page).toHaveURL(new URL(`/patients/${patient.id}/modules#quadro`, page.url()).href);
    await expectCurrentSection(page, 'quadro');
    const note = page.getByText('Leggi la nota completa', { exact: true });
    await expect(note).toBeVisible();
    await note.focus();
    await expect(note).toBeFocused();
    await note.press('Space');
    await expect(note.locator('..')).toHaveAttribute('open', '');
    // Scroll the actual overflowing ancestor, not the former inert Scheda wrapper.
    const scrollEvidence = await surface.evaluate(element => {
      let owner = element.parentElement;
      while (owner && !(owner.scrollHeight > owner.clientHeight && /auto|scroll/.test(getComputedStyle(owner).overflowY))) owner = owner.parentElement;
      if (!owner) return null;
      owner.scrollTo(0, owner.scrollHeight);
      return { overflow: owner.scrollHeight - owner.clientHeight, offset: owner.scrollTop };
    });
    expect(scrollEvidence).not.toBeNull();
    expect(scrollEvidence!.overflow).toBeGreaterThan(100);
    expect(scrollEvidence!.offset).toBeGreaterThan(100);
    const records = page.getByRole('navigation', { name: 'Cartelle aperte' });
    await expectInViewport(records.getByRole('link', { name: patient.name, exact: true }));
    await page.getByTestId('privacy-mode-header-toggle').click();
    await expect(header.locator('.liquid-blur')).toHaveCount(3);
    await expect(records.getByRole('link', { name: patient.name, exact: true }).locator('.liquid-blur')).toHaveCount(1);
    await page.goto(`/patients/${patient.id}/entries/new`);
    const label = page.getByTestId('progressive-entry-composer').locator('header p');
    await expect(label).toContainText(patient.name);
    await expect(label.locator('.liquid-blur')).toHaveCount(1);
    await page.goto(`/patients/${patient.id}/modules`);
    await expect(header.locator('.liquid-blur')).toHaveCount(3);

    const nav = page.getByRole('navigation', { name: 'Sezioni della vista' });
    const therapies = nav.locator('a[href="#terapie"]');
    await therapies.focus();
    await therapies.press('Enter');
    await expectCurrentSection(page, 'terapie');
    await expect(page.locator('#terapie')).toContainText('Ramipril sintetico');
    await expect(page.locator('#diario')).toBeHidden();
    await openPatientSection(page, 'documenti');
    await expect(page.getByRole('heading', { name: /Archivio documenti ed evidenze/ })).toBeVisible();
    await expect(page.locator('#terapie')).toBeHidden();
    await openPatientSection(page, 'terapie');
    await expect(page.locator('#terapie')).toContainText('5 mg');

    await nav.locator('summary').click();
    await nav.locator('a[href="#attenzione"]').click();
    await expectCurrentSection(page, 'attenzione');
    const states = surface.locator('[data-lume-clinical-state]:visible');
    expect(await states.count()).toBeGreaterThan(0);
    for (const state of await states.all()) {
      const geometry = await state.evaluate(element => {
        const style = getComputedStyle(element);
        return { text: element.textContent?.trim(), left: style.borderLeftWidth, right: style.borderRightWidth,
          pill: parseFloat(style.borderRadius) >= element.getBoundingClientRect().height / 2 };
      });
      expect(geometry.text).toBeTruthy();
      expect(geometry.left).toBe(geometry.right);
      expect(geometry.pill).toBe(false);
    }
    const statusLabels = surface.locator('[data-testid^="review-queue-row-"] summary > span:nth-child(2):visible');
    expect(await statusLabels.count()).toBeGreaterThan(0);
    for (const status of await statusLabels.all()) {
      await expect(status).toHaveText(/Bloccato|Da rivedere|Serve testo/);
      await expect(status).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(status).toHaveCSS('border-radius', '0px');
    }
    await assertNoHorizontalOverflow(page, [
      { label: 'documento scheda', selector: 'document' },
      { label: 'scheda', selector: '[data-testid="lume-scheda-scroll"]' },
      { label: 'lettura scheda', selector: '[data-testid="lume-scheda-surface"]' },
    ]);
    await page.screenshot({ path: test.info().outputPath('scheda.png'), animations: 'disabled' });
  });
}
