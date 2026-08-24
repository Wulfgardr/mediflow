/* @Codex #96, #68 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertKeyboardFocusProgresses,
  assertNoHorizontalOverflow,
  assertNotClippedInViewport,
  bootstrapUnlockedSession,
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

async function setRegister(page: Page, register: WorklistCase['register']): Promise<void> {
  await page.evaluate((nextRegister) => {
    const theme = nextRegister === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, register);
}

async function openSyntheticWorklist(page: Page, worklistCase: WorklistCase): Promise<void> {
  await page.setViewportSize({ width: worklistCase.width, height: worklistCase.height });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/mockups/kree8');
  await page.waitForLoadState('domcontentloaded');
  await setRegister(page, worklistCase.register);
  const patientsNav = page.getByRole('button', { name: /Pazienti/ });
  await patientsNav.click();
  await expect(patientsNav).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('lume-worklist')).toBeVisible();
  await expect(page.getByTestId('lume-patient-lens')).toBeVisible();
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

async function resolvedFontFamily(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).fontFamily);
}

/* @Codex WUL-560 L6A: the patient lens exposes one focal action while the
   other four remain keyboard-reachable in a single disclosure menu. */
async function assertLensActionContract(page: Page): Promise<void> {
  const lens = page.getByTestId('lume-patient-lens');
  const primary = lens.getByRole('link', { name: 'Apri scheda paziente', exact: true });
  const trigger = lens.getByRole('button', { name: 'Altre azioni paziente', exact: true });

  await expect(primary).toBeVisible();
  await expect(lens.locator('[data-lume-action="primary"]')).toHaveCount(1);
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(lens.getByRole('menu', { name: 'Azioni paziente' })).toHaveCount(0);

  await trigger.focus();
  await trigger.press('Enter');
  const menu = lens.getByRole('menu', { name: 'Azioni paziente' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();

  const items = menu.getByRole('menuitem');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toHaveText('Quadro');
  await expect(items.nth(1)).toHaveText('Nuova voce');
  await expect(items.nth(2)).toHaveText('Documenti');
  await expect(items.nth(3)).toHaveText('Prepara SISS');
  await expect(items.nth(0)).toBeFocused();

  const menuGeometry = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
  expect(menuGeometry.left).toBeGreaterThanOrEqual(-1);
  expect(menuGeometry.right).toBeLessThanOrEqual(await page.evaluate(() => innerWidth + 1));
  expect(menuGeometry.top).toBeGreaterThanOrEqual(-1);
  expect(menuGeometry.bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight + 1));

  await page.keyboard.press('End');
  await expect(items.nth(3)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

async function assertWorklistContract(page: Page): Promise<void> {
  const list = page.getByRole('listbox', { name: 'Elenco pazienti in carico', exact: true });
  const listItems = list.getByRole('option');
  const rows = list.getByTestId('lume-patient-row');
  await expect(list).toBeVisible();
  await expect(listItems).toHaveCount(3);
  await expect(rows).toHaveCount(3);

  const firstRow = rows.nth(0);
  const secondRow = rows.nth(1);
  await expect(firstRow).not.toHaveAttribute('aria-label');
  await expect(firstRow).toHaveAccessibleName(/M\. R\..*Ipertensione.*08 mag/);
  await expect(firstRow).toContainText('Ipertensione · Dislipidemia · BPCO lieve');
  const rowDiagnosisText = rows.locator('[data-lume-row-diagnoses="text"]');
  await expect(rowDiagnosisText).toHaveCount(3);
  await expect(rowDiagnosisText.locator('*')).toHaveCount(0);
  await expect(rows.locator('[class*="diagnosisPill"], [data-lume-diagnosis-list]')).toHaveCount(0);

  const registerFamily = await resolvedRegisterFamily(page);
  const codeFamilies = await rows.getByTestId('lume-patient-code').evaluateAll(
    (elements) => elements.map((element) => getComputedStyle(element).fontFamily),
  );
  const whenFamilies = await rows.getByTestId('lume-patient-when').evaluateAll(
    (elements) => elements.map((element) => getComputedStyle(element).fontFamily),
  );
  expect(new Set(codeFamilies)).toEqual(new Set([registerFamily]));
  expect(new Set(whenFamilies)).toEqual(new Set([registerFamily]));

  await expect(firstRow).toHaveAttribute('aria-selected', 'true');
  await expect(secondRow).toHaveAttribute('aria-selected', 'false');
  await secondRow.click();
  await expect(firstRow).toHaveAttribute('aria-selected', 'false');
  await expect(secondRow).toHaveAttribute('aria-selected', 'true');

  const rowSurfaces = await Promise.all([firstRow, secondRow].map((row) => row.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      boxShadow: style.boxShadow,
      borderLeftWidth: style.borderLeftWidth,
      borderTopWidth: style.borderTopWidth,
      borderLeftColor: style.borderLeftColor,
      borderTopColor: style.borderTopColor,
      borderLeftStyle: style.borderLeftStyle,
      borderTopStyle: style.borderTopStyle,
    };
  })));
  expect(rowSurfaces[1].background).not.toBe(rowSurfaces[0].background);
  expect(rowSurfaces[1].boxShadow).not.toBe(rowSurfaces[0].boxShadow);
  expect(rowSurfaces[1].borderLeftWidth).toBe(rowSurfaces[1].borderTopWidth);
  expect(rowSurfaces[1].borderLeftColor).toBe(rowSurfaces[1].borderTopColor);
  expect(rowSurfaces[1].borderLeftStyle).toBe(rowSurfaces[1].borderTopStyle);

  const overlaps = await rows.evaluateAll((elements) => elements.flatMap((element, rowIndex) => {
    const when = element.querySelector<HTMLElement>('[data-lume-row-part="when"]');
    if (!when) return [`riga ${rowIndex}: data assente`];
    const dateBox = when.getBoundingClientRect();
    const comparedParts = ['content', 'status', 'signal'].map((partName) => ({
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

  const lens = page.getByTestId('lume-patient-lens');
  expect(await resolvedFontFamily(lens.getByTestId('lume-patient-atoms'))).toBe(registerFamily);
  await assertLensActionContract(page);

  const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
  await search.fill('nessun caso sintetico corrispondente');
  await expect(page.getByTestId('lume-patient-lens-empty')).toHaveText(
    'Nessun paziente corrisponde alla ricerca corrente.',
  );
  await page.getByRole('button', { name: 'Cancella', exact: true }).click();
  await expect(page.getByTestId('lume-patient-lens-empty')).toHaveCount(0);
}

/* @Codex The narrow worklist previously passed overflow checks while its
   navigation, heading, and rows still collapsed into an unusable composition. */
async function assertCompactWorklistGeometry(page: Page, width: number): Promise<void> {
  if (width > 480) return;

  const geometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-testid="lume-frame-rail"]');
    const worklist = document.querySelector<HTMLElement>('[data-testid="lume-worklist"]');
    const title = worklist?.querySelector<HTMLElement>('h2');
    const count = worklist?.querySelector<HTMLElement>('.lume-registro');
    const action = worklist?.querySelector<HTMLElement>('[data-lume-action="quiet"]');
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="lume-patient-row"]')];
    const navItems = [...document.querySelectorAll<HTMLElement>('[data-lume-frame-nav="true"]')];

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
      actionHeight: actionBox.height,
      rowHeights: rows.map((row) => row.getBoundingClientRect().height),
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry?.railHeight).toBeLessThanOrEqual(150);
  expect(geometry?.navRowCount).toBeLessThanOrEqual(2);
  expect(geometry?.worklistInnerWidth).toBeGreaterThanOrEqual(240);
  expect(geometry?.titleHeight).toBeLessThanOrEqual(27);
  expect(geometry?.titleAndCountShareLine).toBe(true);
  expect(geometry?.actionFollowsHeading).toBe(true);
  expect(geometry?.actionHeight).toBeGreaterThanOrEqual(44);
  for (const rowHeight of geometry?.rowHeights ?? []) {
    expect(rowHeight).toBeLessThanOrEqual(100);
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
    const rail = document.querySelector<HTMLElement>('[data-testid="lume-frame-rail"]');
    const title = document.querySelector<HTMLElement>('[data-testid="lume-worklist"] h2');
    const action = document.querySelector<HTMLElement>(
      '[data-testid="lume-worklist"] [data-lume-action="quiet"]',
    );
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="lume-patient-row"]')];
    const navItems = [...document.querySelectorAll<HTMLElement>('[data-lume-frame-nav="true"]')];
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
    await openSyntheticWorklist(page, worklistCase);
    await expect(page.locator('html')).toHaveClass(worklistCase.register === 'grafite' ? /dark/ : /light/);
    await assertWorklistContract(page);
    await assertCompactAriaStable(page, worklistCase);
    await assertCompactWorklistGeometry(page, worklistCase.width);
    await assertNoHorizontalOverflow(page, [
      { label: 'documento worklist', selector: 'document' },
      { label: 'worklist', selector: '[data-testid="lume-worklist"]' },
      { label: 'lista pazienti', selector: '[data-testid="lume-patient-list"]' },
      { label: 'lente paziente', selector: '[data-testid="lume-patient-lens"]' },
    ]);
    const selectedRow = page.getByTestId('lume-patient-row').nth(1);
    await assertNotClippedInViewport(selectedRow, 'riga paziente selezionata');
    await assertKeyboardFocusProgresses(page, selectedRow, 'riga paziente selezionata');
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector<HTMLElement>('[data-testid="lume-frame-canvas"]')?.scrollTo(0, 0);
    });
    await assertTopComposition(page, worklistCase.width);
    await page.screenshot({
      path: `/tmp/lume-worklist-${worklistCase.register}-${worklistCase.viewport}-top.png`,
      fullPage: false,
      animations: 'disabled',
    });
    await page.getByTestId('lume-patient-lens').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/lume-worklist-${worklistCase.register}-${worklistCase.viewport}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  });
}

test('L6A mantiene quattro azioni nell’overflow mobile accessibile', async ({ page }) => {
  await openSyntheticWorklist(page, {
    register: 'giorno', viewport: 'phone', width: 390, height: 844,
  });
  await assertLensActionContract(page);
});

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
  await page.screenshot({ path: '/tmp/lume-worklist-k1-1440x900.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(`[data-patient-index="${pageDownIndex}"]`)).toBeFocused();
  await assertNoHorizontalOverflow(page, [
    { label: 'documento worklist virtuale narrow', selector: 'document' },
    { label: 'worklist virtuale narrow', selector: '[data-testid="lume-worklist"]' },
    { label: 'lista virtuale narrow', selector: '[data-testid="lume-patient-list"]' },
  ]);
  await page.screenshot({ path: '/tmp/lume-worklist-k1-390x844.png', animations: 'disabled' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lume-scheda-header')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
