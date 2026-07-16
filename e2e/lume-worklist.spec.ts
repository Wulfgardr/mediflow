/* @Codex #96, #68 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

type WorklistCase = {
  register: 'giorno' | 'grafite';
  viewport: 'wide' | 'narrow';
  width: number;
  height: number;
};

const WORKLIST_CASES: WorklistCase[] = [
  { register: 'giorno', viewport: 'wide', width: 1440, height: 960 },
  { register: 'grafite', viewport: 'wide', width: 1440, height: 960 },
  { register: 'giorno', viewport: 'narrow', width: 390, height: 844 },
  { register: 'grafite', viewport: 'narrow', width: 390, height: 844 },
];

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

async function expectRegister(locator: Locator, expectedFamily: string): Promise<void> {
  await expect(locator).toHaveCSS('font-family', expectedFamily);
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
  await expect(rows.locator('[class*="diagnosisPill"], [data-lume-diagnosis-list]')).toHaveCount(0);

  const registerFamily = await resolvedRegisterFamily(page);
  await expectRegister(firstRow.getByTestId('lume-patient-code'), registerFamily);
  await expectRegister(firstRow.getByTestId('lume-patient-when'), registerFamily);

  await expect(firstRow).toHaveAttribute('aria-selected', 'true');
  await secondRow.click();
  await expect(firstRow).toHaveAttribute('aria-selected', 'false');
  await expect(secondRow).toHaveAttribute('aria-selected', 'true');

  const rowSurfaces = await Promise.all([firstRow, secondRow].map((row) => row.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderLeftWidth: style.borderLeftWidth,
      borderTopWidth: style.borderTopWidth,
      borderLeftColor: style.borderLeftColor,
      borderTopColor: style.borderTopColor,
      borderLeftStyle: style.borderLeftStyle,
      borderTopStyle: style.borderTopStyle,
    };
  })));
  expect(rowSurfaces[1].background).not.toBe(rowSurfaces[0].background);
  expect(rowSurfaces[1].borderLeftWidth).toBe(rowSurfaces[1].borderTopWidth);
  expect(rowSurfaces[1].borderLeftColor).toBe(rowSurfaces[1].borderTopColor);
  expect(rowSurfaces[1].borderLeftStyle).toBe(rowSurfaces[1].borderTopStyle);

  const overlaps = await rows.evaluateAll((elements) => elements.flatMap((element, rowIndex) => {
    const when = element.querySelector<HTMLElement>('[data-lume-row-part="when"]');
    if (!when) return [`riga ${rowIndex}: data assente`];
    const dateBox = when.getBoundingClientRect();
    return Array.from(element.querySelectorAll<HTMLElement>('[data-lume-row-part]'))
      .filter((part) => part !== when)
      .flatMap((part) => {
        const box = part.getBoundingClientRect();
        const intersects = dateBox.left < box.right && dateBox.right > box.left
          && dateBox.top < box.bottom && dateBox.bottom > box.top;
        return intersects ? [`riga ${rowIndex}: data sovrapposta a ${part.dataset.lumeRowPart}`] : [];
      });
  }));
  expect(overlaps).toEqual([]);

  const lens = page.getByTestId('lume-patient-lens');
  await expectRegister(lens.getByTestId('lume-patient-atoms'), registerFamily);
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

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const targets = [
      ['documento', document.documentElement],
      ['worklist', document.querySelector<HTMLElement>('[data-testid="lume-worklist"]')],
      ['lista', document.querySelector<HTMLElement>('[data-testid="lume-patient-list"]')],
      ['lente', document.querySelector<HTMLElement>('[data-testid="lume-patient-lens"]')],
    ] as const;
    return targets.map(([label, element]) => ({
      label,
      delta: element ? element.scrollWidth - element.clientWidth : Number.POSITIVE_INFINITY,
    }));
  });
  for (const target of overflow) {
    expect(target.delta, `Overflow orizzontale su ${target.label}`).toBeLessThanOrEqual(1);
  }
}

for (const worklistCase of WORKLIST_CASES) {
  test(`worklist Lume ${worklistCase.register} ${worklistCase.viewport}`, async ({ page }) => {
    await openSyntheticWorklist(page, worklistCase);
    if (worklistCase.register === 'giorno' && worklistCase.viewport === 'wide') {
      await assertWorklistContract(page);
    }
    if (worklistCase.viewport === 'narrow') {
      await assertNoHorizontalOverflow(page);
      await page.getByTestId('lume-patient-lens').scrollIntoViewIfNeeded();
    }
    await page.screenshot({
      path: `/tmp/lume-worklist-${worklistCase.register}-${worklistCase.viewport}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  });
}
