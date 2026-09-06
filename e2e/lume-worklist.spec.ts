/* @Codex #96, #68 */
import { expect, test, type Page } from '@playwright/test';
import {
  assertKeyboardFocusProgresses,
  assertNoHorizontalOverflow,
  assertNotClippedInViewport,
  bootstrapUnlockedSession,
  openPatientSection,
  REFLOW_PROXY_VIEWPORTS,
  type ReflowProxyViewport,
} from './utils';

type WorklistCase = {
  register: 'giorno' | 'grafite';
  viewport: ReflowProxyViewport['viewport'] | 'compact-transition' | 'rail-boundary';
  width: number;
  height: number;
};

const WORKLIST_VIEWPORTS: Omit<WorklistCase, 'register'>[] = [
  ...REFLOW_PROXY_VIEWPORTS,
  { viewport: 'compact-transition', width: 600, height: 900 },
  { viewport: 'rail-boundary', width: 701, height: 900 },
];

const WORKLIST_CASES: WorklistCase[] = (['giorno', 'grafite'] as const).flatMap((register) =>
  WORKLIST_VIEWPORTS.map((viewport) => ({ register, ...viewport })),
);

const MENU_COLLISION_VIEWPORTS: Omit<WorklistCase, 'register'>[] = [{ viewport: 'compact-transition', width: 640, height: 1024 }, { viewport: 'rail-boundary', width: 701, height: 900 }];
async function setRegister(page: Page, register: WorklistCase['register']): Promise<void> {
  // @Codex: the ordinary control updates both the provider and its persisted preference.
  const returnUrl = page.url();
  const theme = register === 'grafite' ? 'dark' : 'light';
  await page.getByRole('complementary', { name: 'MediFlow', exact: true })
    .getByRole('link', { name: 'Impostazioni', exact: true }).click();
  await expect(page).toHaveURL(new URL('/settings', returnUrl).href);
  await page.getByRole('link', { name: 'Apri aspetto', exact: true }).click();
  await expect(page).toHaveURL(new URL('/settings/aspetto', returnUrl).href);
  await page.getByTestId('settings-appearance-section')
    .getByRole('button', { name: register === 'grafite' ? 'Tema Scuro' : 'Tema Chiaro', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
  await page.goto(returnUrl);
  await expect(page).toHaveURL(returnUrl);
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
}

async function openSyntheticWorklist(page: Page, worklistCase: WorklistCase): Promise<string> {
  await page.setViewportSize({ width: worklistCase.width, height: worklistCase.height });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = `WL${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
  // @Codex: exercise the ordinary directory with records created through its API.
  await page.evaluate(async (fixtureMarker) => {
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch('/api/patients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: `Caso ${index + 1}`, lastName: fixtureMarker,
          taxCode: `WL${fixtureMarker.slice(-10)}${index}`, birthDate: '1972-04-12T00:00:00.000Z',
          diagnoses: [
            { system: 'ICD-11', code: 'BA00', description: 'Ipertensione sintetica' },
            { system: 'ICD-11', code: '5C80', description: 'Dislipidemia sintetica' },
            { system: 'ICD-11', code: 'CA22', description: 'BPCO sintetica' },
          ], notes: 'Voce dimostrativa della cartella. Nessun dato reale.',
        }),
      });
      if (!response.ok) throw new Error(`Fixture worklist ${index}: HTTP ${response.status}`);
    }
  }, marker);
  await page.goto('/?area=incarico');
  await page.waitForLoadState('domcontentloaded');
  await setRegister(page, worklistCase.register);
  const patientsNav = page.getByRole('navigation', { name: 'Navigazione principale' })
    .getByRole('link', { name: 'Pazienti', exact: true });
  await expect(patientsNav).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('lume-worklist')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true }).fill(marker);
  await expect(page.getByText('3 risultati', { exact: true })).toBeVisible();
  return marker;
}

async function resolvedRegisterFamily(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'lume-registro';
    document.body.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family;
  });
}

async function assertWorklistContract(page: Page, marker: string): Promise<void> {
  const list = page.getByRole('listbox', { name: 'Elenco pazienti in carico', exact: true });
  const listItems = list.getByRole('option');
  const rows = list.getByTestId('lume-patient-row');
  await expect(list).toBeVisible();
  await expect(listItems).toHaveCount(3);
  await expect(rows).toHaveCount(3);

  const firstRow = rows.nth(0);
  const secondRow = rows.nth(1);
  await expect(firstRow).not.toHaveAttribute('aria-label');
  await expect(firstRow).toHaveAccessibleName(new RegExp(`${marker}.*Ipertensione sintetica`));
  await expect(firstRow).toContainText('Dislipidemia sintetica');
  await expect(firstRow).toContainText('BPCO sintetica');
  await expect(firstRow).toHaveAccessibleName(new RegExp((await firstRow.getByTestId('lume-patient-when').innerText()).trim()));
  await expect(rows.locator('[class*="diagnosisPill"], [data-lume-diagnosis-list]')).toHaveCount(0);

  const registerFamily = await resolvedRegisterFamily(page);
  const whenFamilies = await rows.getByTestId('lume-patient-when').evaluateAll(
    (elements) => elements.map((element) => getComputedStyle(element).fontFamily),
  );
  expect(whenFamilies).toHaveLength(3);
  expect(new Set(whenFamilies)).toEqual(new Set([registerFamily]));

  await expect(firstRow).toHaveAttribute('aria-selected', 'true');
  await expect(secondRow).toHaveAttribute('aria-selected', 'false');
  // Single click now opens the record. ArrowDown still changes the selection.
  // @Codex: compare keyboard selection without a retained pointer hover.
  await page.mouse.move(0, 0);
  expect(await firstRow.evaluate((element) => element.matches(':hover'))).toBe(false);
  await firstRow.focus();
  await firstRow.press('ArrowDown');
  await expect(secondRow).toBeFocused();
  await expect(firstRow).toHaveAttribute('aria-selected', 'false');
  await expect(secondRow).toHaveAttribute('aria-selected', 'true');

  const rowSurfaces = await Promise.all([firstRow, secondRow].map((row) => row.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      borderLeftWidth: style.borderLeftWidth,
      borderTopWidth: style.borderTopWidth,
      borderLeftColor: style.borderLeftColor,
      borderTopColor: style.borderTopColor,
      borderLeftStyle: style.borderLeftStyle,
      borderTopStyle: style.borderTopStyle,
    };
  })));
  // @Codex: selection attributes can update before the background transition.
  await expect.poll(async () => {
    const backgrounds = await Promise.all([firstRow, secondRow].map((row) =>
      row.evaluate((element) => getComputedStyle(element).backgroundColor),
    ));
    return backgrounds[1] !== backgrounds[0];
  }).toBe(true);
  expect(rowSurfaces[1].boxShadow).not.toBe(rowSurfaces[0].boxShadow);
  expect(rowSurfaces[1].borderLeftWidth).toBe(rowSurfaces[1].borderTopWidth);
  expect(rowSurfaces[1].borderLeftColor).toBe(rowSurfaces[1].borderTopColor);
  expect(rowSurfaces[1].borderLeftStyle).toBe(rowSurfaces[1].borderTopStyle);

  const overlaps = await rows.evaluateAll((elements) => elements.flatMap((element, rowIndex) => {
    const when = element.querySelector<HTMLElement>('[data-lume-row-part="when"]');
    if (!when) return [`riga ${rowIndex}: data assente`];
    const dateBox = when.getBoundingClientRect();
    const comparedParts = ['content', 'signal'].map((partName) => ({
      partName,
      part: element.querySelector<HTMLElement>(`[data-lume-row-part="${partName}"]`),
    }));
    return comparedParts.flatMap(({ partName, part }) => {
      if (!part) return [`riga ${rowIndex}: ${partName} assente`];
      const box = part.getBoundingClientRect();
      const intersects = dateBox.left < box.right && dateBox.right > box.left
        && dateBox.top < box.bottom && dateBox.bottom > box.top;
      return intersects ? [`riga ${rowIndex}: data sovrapposta a ${partName}`] : [];
    });
  }));
  expect(overlaps).toEqual([]);

  const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
  await search.fill('nessun caso sintetico corrispondente');
  await expect(page.getByText('0 risultati', { exact: true })).toBeVisible();
  await expect(listItems).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancella', exact: true }).click();
  await expect(search).toHaveValue('');
  await search.fill(marker);
  await expect(listItems).toHaveCount(3);
  await firstRow.focus();
  await firstRow.press('ArrowDown');
}

/* @Codex The narrow worklist previously passed overflow checks while its
   navigation, heading, and rows still collapsed into an unusable composition. */
async function assertCompactWorklistGeometry(page: Page, width: number): Promise<void> {
  if (width > 480) return;
  // Scrolling after keyboard selection can leave the pointer over an old row.
  // Measure the closed state only after its real disclosure has finished closing.
  await page.mouse.move(0, 0);
  for (const disclosure of await page.locator('[data-testid="lume-patient-row"][aria-selected="false"] [class*="recordDisclosure"]').all()) {
    await expect(disclosure).toHaveCSS('grid-template-rows', '0px');
  }

  const geometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-twin-workspace] > aside');
    const worklist = document.querySelector<HTMLElement>('[data-testid="lume-worklist"]');
    const title = worklist?.querySelector<HTMLElement>('h2');
    const count = worklist?.querySelector<HTMLElement>('.lume-registro');
    const action = worklist?.querySelector<HTMLElement>('[data-lume-action="quiet"]');
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="lume-patient-row"]')];
    const navItems = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Navigazione principale"] a')];

    if (!rail || !worklist || !title || !count || !action || rows.length === 0 || navItems.length === 0) {
      return null;
    }

    const railBox = rail.getBoundingClientRect();
    const worklistStyle = getComputedStyle(worklist);
    const titleBox = title.getBoundingClientRect();
    const countBox = count.getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    const navRows = new Set(navItems.map((item) => Math.round(item.getBoundingClientRect().top)));

    return {
      railHeight: railBox.height,
      navRowCount: navRows.size,
      worklistInnerWidth: worklist.clientWidth
        - Number.parseFloat(worklistStyle.paddingLeft)
        - Number.parseFloat(worklistStyle.paddingRight),
      titleHeight: titleBox.height,
      titleAndCountShareLine: Math.abs(
        (titleBox.top + titleBox.height / 2) - (countBox.top + countBox.height / 2),
      ) <= 2,
      actionFollowsHeading: actionBox.top >= Math.max(titleBox.bottom, countBox.bottom),
      // @Codex: at phone width the action shares the result row, with no overlap.
      actionBesideHeading: actionBox.left >= Math.max(titleBox.right, countBox.right)
        && Math.abs((actionBox.top + actionBox.height / 2)
          - (titleBox.top + titleBox.height / 2)) <= 2,
      actionHeight: actionBox.height,
      // The selected row deliberately reveals notes; compact density applies to closed rows.
      rowHeights: rows.filter(row => row.getAttribute('aria-selected') !== 'true').map(row => row.getBoundingClientRect().height),
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry?.railHeight).toBeLessThanOrEqual(150);
  expect(geometry?.navRowCount).toBeLessThanOrEqual(2);
  expect(geometry?.worklistInnerWidth).toBeGreaterThanOrEqual(240);
  expect(geometry?.titleHeight).toBeLessThanOrEqual(27);
  expect(geometry?.titleAndCountShareLine).toBe(true);
  expect(width >= 360 ? geometry?.actionBesideHeading : geometry?.actionFollowsHeading).toBe(true);
  expect(geometry?.actionHeight).toBeGreaterThanOrEqual(44);
  for (const rowHeight of geometry?.rowHeights ?? []) {
    expect.soft(rowHeight, 'densità della riga chiusa').toBeLessThanOrEqual(100);
  }
}

async function assertCompactAriaStable(page: Page, worklistCase: WorklistCase): Promise<void> {
  if (worklistCase.width !== 320) return;

  const canvas = page.getByTestId('lume-frame-canvas');
  const compactSnapshot = await canvas.ariaSnapshot();
  await page.setViewportSize({ width: 481, height: worklistCase.height });
  const expandedSnapshot = await canvas.ariaSnapshot();
  expect(compactSnapshot).toBe(expandedSnapshot);
  await page.setViewportSize({ width: worklistCase.width, height: worklistCase.height });
}

async function assertTopComposition(page: Page, width: number): Promise<void> {
  const composition = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-twin-workspace] > aside');
    const title = document.querySelector<HTMLElement>('[data-testid="lume-worklist"] h2');
    const action = document.querySelector<HTMLElement>(
      '[data-testid="lume-worklist"] [data-lume-action="quiet"]',
    );
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="lume-patient-row"]')];
    const navItems = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Navigazione principale"] a')];
    if (!rail || !title || !action || rows.length === 0 || navItems.length === 0) return null;

    const railBox = rail.getBoundingClientRect();
    const navBoxes = navItems.map((item) => item.getBoundingClientRect());
    const isFullyVisible = (box: DOMRect) => box.top >= 0 && box.bottom <= window.innerHeight;
    const firstRowBox = rows[0].getBoundingClientRect();
    const firstRowVisibleHeight = Math.max(
      0,
      Math.min(firstRowBox.bottom, window.innerHeight) - Math.max(firstRowBox.top, 0),
    );
    return {
      railHasNoHorizontalOverflow: rail.scrollWidth <= rail.clientWidth + 1,
      everyNavItemVisible: navBoxes.every(
        (box) => box.left >= railBox.left - 1 && box.right <= railBox.right + 1,
      ),
      headingVisible: isFullyVisible(title.getBoundingClientRect()),
      actionVisible: isFullyVisible(action.getBoundingClientRect()),
      completeRowsVisible: rows.filter((row) => isFullyVisible(row.getBoundingClientRect())).length,
      firstRowBottomMiss: Math.max(0, firstRowBox.bottom - window.innerHeight),
      firstRowVisibleFraction: firstRowVisibleHeight / firstRowBox.height,
    };
  });

  expect(composition).not.toBeNull();
  expect(composition?.railHasNoHorizontalOverflow).toBe(true);
  expect(composition?.everyNavItemVisible).toBe(true);
  if (width === 320) {
    expect(composition?.headingVisible).toBe(true);
    expect(composition?.actionVisible).toBe(true);
    if ((composition?.completeRowsVisible ?? 0) < 1) {
      /* @Codex Fable's pre-declared compact closure rule permits a boundary
         miss only when it is <=24px and at least 60% of row one remains visible. */
      expect(composition?.firstRowBottomMiss).toBeLessThanOrEqual(24);
      expect(composition?.firstRowVisibleFraction).toBeGreaterThanOrEqual(0.6);
    }
  } else if (width === 390) {
    expect(composition?.completeRowsVisible).toBeGreaterThanOrEqual(2);
  }
}

for (const worklistCase of WORKLIST_CASES) {
  test(`worklist Lume ${worklistCase.register} ${worklistCase.viewport}`, async ({ page }) => {
    const marker = await openSyntheticWorklist(page, worklistCase);
    await expect(page.locator('html')).toHaveClass(worklistCase.register === 'grafite' ? /dark/ : /light/);
    await assertWorklistContract(page, marker);
    await assertCompactAriaStable(page, worklistCase);
    await assertCompactWorklistGeometry(page, worklistCase.width);
    await assertNoHorizontalOverflow(page, [
      { label: 'documento worklist', selector: 'document' },
      { label: 'worklist', selector: '[data-testid="lume-worklist"]' },
      { label: 'lista pazienti', selector: '[data-testid="lume-patient-list"]' },
    ]);
    const selectedRow = page.getByTestId('lume-patient-row').nth(1);
    await assertNotClippedInViewport(selectedRow, 'riga paziente selezionata');
    // The list is now the last control; the removed lens cannot receive Tab.
    // Check entry from the preceding control, exit, and reverse return without a trap.
    await assertKeyboardFocusProgresses(page, page.getByRole('link', { name: 'Nuova scheda', exact: true }), 'ingresso nella lista pazienti');
    await expect(selectedRow).toBeFocused();
    await selectedRow.press('Tab');
    await expect(selectedRow).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(selectedRow).toBeFocused();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector<HTMLElement>('[data-testid="lume-frame-canvas"]')?.scrollTo(0, 0);
    });
    await assertTopComposition(page, worklistCase.width);
    await page.screenshot({
      path: test.info().outputPath('worklist-top.png'),
      fullPage: false,
      animations: 'disabled',
    });
    const row = page.getByRole('option').first();
    const name = await row.locator('strong').innerText();
    await row.click();
    await expect(page).toHaveURL(/\/patients\/[^/]+\/modules$/);
    await expect(page.getByTestId('lume-scheda-header').getByRole('heading', { name, exact: true })).toBeVisible();
  });
}

/* @Codex ADR 0123: the four lens destinations moved into the opened record.
   Verify all four on the official UI; do not click the now-hidden review lens. */
test('la riga mobile apre la Scheda con Quadro, Nuova voce, Documenti e SISS raggiungibili', async ({ page }) => {
  await openSyntheticWorklist(page, {
    register: 'giorno', viewport: 'phone', width: 390, height: 844,
  });
  const row = page.getByRole('option').first();
  const name = await row.locator('strong').innerText();
  await row.focus();
  await row.press('Enter');
  const header = page.getByTestId('lume-scheda-header');
  await expect(header.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Sezioni della vista' }).getByRole('link', { name: 'Riepilogo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Riepilogo clinico', exact: true })).toBeVisible();
  for (const section of ['documenti', 'siss']) await openPatientSection(page, section);
  const entry = header.getByRole('link', { name: 'Nuova voce', exact: true });
  await expect(entry).toHaveAttribute('href', /\/patients\/[^/]+\/entries\/new$/);
  await entry.focus();
  await entry.press('Enter');
  await expect(page.getByTestId('progressive-entry-composer').locator('header p')).toContainText(name);
});
for (const register of ['giorno', 'grafite'] as const) {
  for (const viewport of MENU_COLLISION_VIEWPORTS) {
    test(`contiene Altre sezioni senza scroll a ${viewport.width}px in registro ${register}`, async ({ page }) => {
      await openSyntheticWorklist(page, { register, ...viewport });
      await page.getByRole('option').first().click();
      await expect(page.getByTestId('lume-scheda-header')).toBeVisible();
      expect(await page.evaluate(() => scrollY)).toBe(0);
      const nav = page.getByRole('navigation', { name: 'Sezioni della vista' });
      const trigger = nav.locator('summary');
      const details = nav.locator('details');
      await trigger.focus();
      await trigger.press('Enter');
      await expect(details).toHaveAttribute('open', '');
      const menu = details.locator(':scope > div');
      await expect(menu).toBeVisible();
      const fitsViewport = await menu.evaluate((element, size) => {
        const box = element.getBoundingClientRect();
        return box.top >= 8 && box.bottom <= size.height - 8 && box.left >= 8 && box.right <= size.width - 8;
      }, viewport);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      expect(fitsViewport).toBe(true);
      const links = menu.getByRole('link');
      expect(await links.count()).toBeGreaterThan(0);
      for (const link of await links.all()) {
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        await assertNotClippedInViewport(link, await link.innerText());
      }
      await page.keyboard.press('Escape');
      await expect(details).not.toHaveAttribute('open');
      await expect(trigger).toBeFocused();
      await trigger.press('Space');
      await expect(menu).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('sections-menu.png'), animations: 'disabled' });
    });
  }
}

test('la worklist virtuale attraversa l’indice completo e apre la sola Scheda', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = `VirtualK1${Date.now().toString().slice(-8)}`;
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.evaluate(async (fixtureMarker) => {
    const responses = await Promise.all(Array.from({ length: 120 }, async (_, index) => {
      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: `Caso ${String(index + 1).padStart(3, '0')}`,
          lastName: fixtureMarker,
          taxCode: `${fixtureMarker.slice(-8)}${String(index).padStart(3, '0')}`,
          birthDate: '1972-04-12T00:00:00.000Z',
        }),
      });
      if (!response.ok) throw new Error(`Fixture virtuale ${index + 1}: HTTP ${response.status}`);
    }));
    await Promise.all(responses);
  }, marker);
  await page.goto('/?area=incarico');

  const listbox = page.getByRole('listbox', { name: 'Elenco pazienti in carico', exact: true });
  await expect(listbox).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
  await search.fill(marker);
  await expect(page.getByText('120 risultati', { exact: true })).toBeVisible();

  const firstRow = page.getByRole('option').first();
  await firstRow.focus();
  await firstRow.press('End');
  const lastRow = page.locator('[data-patient-index="119"]');
  await expect(lastRow).toBeFocused();
  await expect(lastRow).toHaveAttribute('aria-selected', 'true');
  await expect(lastRow).toHaveAttribute('data-patient-index', '119');

  await page.keyboard.press('PageUp');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index'))))
    .toBeLessThan(119);
  const pageUpIndex = await page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index')));
  expect(pageUpIndex).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index'))))
    .toBe(pageUpIndex - 1);
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await page.keyboard.press('Home');
  await expect(page.locator('[data-patient-index="0"]')).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index'))))
    .toBeGreaterThan(0);
  const pageDownIndex = await page.evaluate(() => Number(document.activeElement?.getAttribute('data-patient-index')));
  await assertNoHorizontalOverflow(page, [
    { label: 'documento worklist virtuale', selector: 'document' },
    { label: 'worklist virtuale', selector: '[data-testid="lume-worklist"]' },
    { label: 'lista virtuale', selector: '[data-testid="lume-patient-list"]' },
  ]);
  await page.screenshot({ path: test.info().outputPath('virtual-wide.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(`[data-patient-index="${pageDownIndex}"]`)).toBeFocused();
  await assertNoHorizontalOverflow(page, [
    { label: 'documento worklist virtuale narrow', selector: 'document' },
    { label: 'worklist virtuale narrow', selector: '[data-testid="lume-worklist"]' },
    { label: 'lista virtuale narrow', selector: '[data-testid="lume-patient-list"]' },
  ]);
  await page.screenshot({ path: test.info().outputPath('virtual-phone.png'), animations: 'disabled' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lume-scheda-header')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
