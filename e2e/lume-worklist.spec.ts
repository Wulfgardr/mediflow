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
  viewport: ReflowProxyViewport['viewport'];
  width: number;
  height: number;
};

const WORKLIST_CASES: WorklistCase[] = (['giorno', 'grafite'] as const).flatMap((register) =>
  REFLOW_PROXY_VIEWPORTS.map((viewport) => ({ register, ...viewport })),
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

async function assertWorklistContract(page: Page): Promise<void> {
  const list = page.getByRole('list', { name: 'Elenco pazienti in carico', exact: true });
  const listItems = list.getByRole('listitem');
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

  await expect(firstRow).toHaveAttribute('aria-pressed', 'true');
  await expect(secondRow).toHaveAttribute('aria-pressed', 'false');
  await secondRow.click();
  await expect(firstRow).toHaveAttribute('aria-pressed', 'false');
  await expect(secondRow).toHaveAttribute('aria-pressed', 'true');

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
  await expect(lens.locator('[data-lume-action="primary"]')).toHaveCount(1);
  await expect(lens.locator('[data-lume-action="quiet"]')).toHaveCount(4);

  const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
  await search.fill('nessun caso sintetico corrispondente');
  await expect(page.getByTestId('lume-patient-lens-empty')).toHaveText(
    'Nessun paziente corrisponde alla ricerca corrente.',
  );
  await page.getByRole('button', { name: 'Cancella', exact: true }).click();
  await expect(page.getByTestId('lume-patient-lens-empty')).toHaveCount(0);
}

for (const worklistCase of WORKLIST_CASES) {
  test(`worklist Lume ${worklistCase.register} ${worklistCase.viewport}`, async ({ page }) => {
    await openSyntheticWorklist(page, worklistCase);
    await expect(page.locator('html')).toHaveClass(worklistCase.register === 'grafite' ? /dark/ : /light/);
    await assertWorklistContract(page);
    await assertNoHorizontalOverflow(page, [
      { label: 'documento worklist', selector: 'document' },
      { label: 'worklist', selector: '[data-testid="lume-worklist"]' },
      { label: 'lista pazienti', selector: '[data-testid="lume-patient-list"]' },
      { label: 'lente paziente', selector: '[data-testid="lume-patient-lens"]' },
    ]);
    const selectedRow = page.getByTestId('lume-patient-row').nth(1);
    await assertNotClippedInViewport(selectedRow, 'riga paziente selezionata');
    await assertKeyboardFocusProgresses(page, selectedRow, 'riga paziente selezionata');
    await page.getByTestId('lume-patient-lens').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/lume-worklist-${worklistCase.register}-${worklistCase.viewport}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  });
}
