/* @Codex Issue 109, riferimento 68 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

/*
 * Questo spec verifica la composizione della slice 5: una superficie editor
 * unica e i flussi caso di review/handoff. lume-new-entry.spec.ts resta la
 * prova comportamentale di form, ARIA, errori, salvataggio e opacità.
 */
test.describe.configure({ retries: 0 });

type ViewCase = {
  register: 'giorno' | 'grafite';
  viewport: 'wide' | 'narrow';
  width: number;
  height: number;
};

const VIEW_CASES: ViewCase[] = [
  { register: 'giorno', viewport: 'wide', width: 1440, height: 960 },
  { register: 'grafite', viewport: 'wide', width: 1440, height: 960 },
  { register: 'giorno', viewport: 'narrow', width: 390, height: 844 },
  { register: 'grafite', viewport: 'narrow', width: 390, height: 844 },
];

type SyntheticPatient = { id: string; name: string };

async function createSyntheticPatient(page: Page): Promise<SyntheticPatient> {
  const marker = Date.now().toString().slice(-8);
  const firstName = `Editor${marker}`;
  const lastName = `Lume${marker}`;

  return page.evaluate(async ({ fixtureFirstName, fixtureLastName, fixtureMarker }) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: fixtureFirstName,
        lastName: fixtureLastName,
        taxCode: `EDT${fixtureMarker.padStart(13, '0')}`,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico editor',
        phone: '0000000109',
        diagnoses: [{
          system: 'ICD-11',
          code: 'ED10',
          description: 'Contesto sintetico per la revisione',
          date: new Date().toISOString(),
        }],
      }),
    });
    if (!response.ok) throw new Error(`Failed to create editor fixture: ${response.status}`);
    const payload = await response.json() as { id: string };
    return { id: payload.id, name: `${fixtureLastName} ${fixtureFirstName}` };
  }, { fixtureFirstName: firstName, fixtureLastName: lastName, fixtureMarker: marker });
}

async function setRegister(page: Page, register: ViewCase['register']): Promise<void> {
  await page.evaluate((nextRegister) => {
    const theme = nextRegister === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, register);
}

async function assertInsideViewport(locator: Locator, label: string): Promise<void> {
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
      clientWidth: (element as HTMLElement).clientWidth,
      scrollWidth: (element as HTMLElement).scrollWidth,
    };
  });
  expect(geometry.left, `${label}: margine sinistro`).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, `${label}: margine destro`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.scrollWidth, `${label}: overflow interno`).toBeLessThanOrEqual(geometry.clientWidth + 1);
}

async function assertEditorComposition(page: Page, viewCase: ViewCase): Promise<void> {
  const workflow = page.getByTestId('lume-editor-workflow');
  const editor = page.getByTestId('lume-clinical-editor');
  const toolbar = editor.locator(':scope > [data-lume-editor-surface="toolbar"]');
  const canvas = editor.locator(':scope > [data-lume-editor-surface="canvas"]');
  const field = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });

  await expect(workflow).toBeVisible();
  await expect(workflow.locator('[data-lume-primary="true"]')).toHaveCount(1);
  await expect(editor.locator(':scope > [data-lume-editor-surface]')).toHaveCount(2);
  await expect(toolbar).toBeVisible();
  await expect(canvas).toBeVisible();

  const adjacency = await editor.evaluate((root) => {
    const toolbarElement = root.querySelector<HTMLElement>('[data-lume-editor-surface="toolbar"]');
    const canvasElement = root.querySelector<HTMLElement>('[data-lume-editor-surface="canvas"]');
    if (!toolbarElement || !canvasElement) throw new Error('Editor surfaces missing');
    const toolbarRect = toolbarElement.getBoundingClientRect();
    const canvasRect = canvasElement.getBoundingClientRect();
    return {
      verticalGap: Math.abs(toolbarRect.bottom - canvasRect.top),
      leftGap: Math.abs(toolbarRect.left - canvasRect.left),
      rightGap: Math.abs(toolbarRect.right - canvasRect.right),
    };
  });
  expect(adjacency.verticalGap).toBeLessThanOrEqual(1);
  expect(adjacency.leftGap).toBeLessThanOrEqual(1);
  expect(adjacency.rightGap).toBeLessThanOrEqual(1);

  const draftState = page.getByTestId('lume-entry-draft-state');
  await expect(draftState).toContainText('Bozza clinica');
  const draftInk = await draftState.evaluate((element) => getComputedStyle(element).color);
  const mutedInk = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--lume-ink-muted)';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(draftInk).toBe(mutedInk);

  await field.fill('Voce sintetica in bozza, senza dati clinici reali.');
  await field.focus();
  await expect(field).toBeFocused();
  await expect(canvas).not.toHaveCSS('box-shadow', 'none');
  const expectedSurfaceSelector = '[data-lume-editor-surface="canvas"]';
  const shadowOwners = await workflow.evaluate((context, selector) => {
    const expected = context.querySelector<HTMLElement>(selector);

    return [context, ...context.querySelectorAll<HTMLElement>('*')]
      .filter((element) => getComputedStyle(element).boxShadow !== 'none')
      .map((element) => ({
        expected: element === expected,
        shadow: getComputedStyle(element).boxShadow,
        surface: element.getAttribute('data-lume-editor-surface'),
        tag: element.tagName.toLowerCase(),
      }));
  }, expectedSurfaceSelector);

  expect(shadowOwners).toHaveLength(1);
  expect(shadowOwners[0]).toMatchObject({
    expected: true,
    surface: 'canvas',
    tag: 'div',
  });

  if (viewCase.viewport === 'narrow') {
    await toolbar.scrollIntoViewIfNeeded();
    await assertInsideViewport(toolbar, 'toolbar narrow');
    const attachment = page.getByRole('button', { name: 'Aggiungi allegati alla voce clinica', exact: true });
    await attachment.scrollIntoViewIfNeeded();
    await assertInsideViewport(attachment, 'allegati narrow');
    await field.focus();
    await page.keyboard.press('Tab');
    await expect(attachment).toBeFocused();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
}

async function assertNoSemanticSideStripe(caseFlow: Locator): Promise<void> {
  const offenders = await caseFlow.locator('*').evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const left = Number.parseFloat(style.borderLeftWidth);
    const other = Math.max(
      Number.parseFloat(style.borderTopWidth),
      Number.parseFloat(style.borderRightWidth),
      Number.parseFloat(style.borderBottomWidth),
    );
    return left > other + 0.5 ? [element.tagName] : [];
  }));
  expect(offenders).toEqual([]);
}

async function assertCaseContract(caseFlow: Locator): Promise<void> {
  await expect(caseFlow).toBeVisible();
  await expect(caseFlow.getByText('Evidenza', { exact: true })).toBeVisible();
  await expect(caseFlow.getByText('Decisione', { exact: true })).toBeVisible();
  await expect(caseFlow.getByText('Prossimo passo', { exact: true })).toBeVisible();
  await expect(caseFlow.getByText('Proprietario', { exact: true })).toBeVisible();
  await expect(caseFlow.getByText('Motivo', { exact: true })).toBeVisible();
  await expect(caseFlow.locator('[data-lume-register="true"]')).toBeVisible();
  await expect(caseFlow.locator('[data-lume-primary="true"]')).toHaveCount(1);
  await assertNoSemanticSideStripe(caseFlow);
}

test('editor Lume compone un solo lavoro focale in giorno e grafite, wide e narrow', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createSyntheticPatient(page);

  for (const viewCase of VIEW_CASES) {
    await page.setViewportSize({ width: viewCase.width, height: viewCase.height });
    await setRegister(page, viewCase.register);
    await page.goto(`/patients/${patient.id}/entries/new`);
    await expect(page.locator('html')).toHaveClass(viewCase.register === 'grafite' ? /dark/ : /light/);
    await expect(page.getByRole('heading', { name: 'Nuova voce clinica', exact: true })).toBeVisible();
    await assertEditorComposition(page, viewCase);
    if (viewCase.viewport === 'narrow') {
      await page.locator('[data-lume-editor-surface="toolbar"]').scrollIntoViewIfNeeded();
    }
    await page.screenshot({
      path: `/tmp/lume-editor-${viewCase.register}-${viewCase.viewport}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('review e handoff espongono fiducia ispezionabile e una primaria per caso', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createSyntheticPatient(page);

  for (const viewCase of VIEW_CASES) {
    await page.setViewportSize({ width: viewCase.width, height: viewCase.height });

    await setRegister(page, viewCase.register);
    await page.goto(`/?area=revisione&paziente=${patient.id}`);
    await expect(page.locator('html')).toHaveClass(viewCase.register === 'grafite' ? /dark/ : /light/);
    const reviewCase = page.getByTestId('lume-review-case');
    await expect(reviewCase).toContainText(patient.name);
    await assertCaseContract(reviewCase);
    if (viewCase.viewport === 'narrow') {
      await assertInsideViewport(reviewCase, 'review narrow');
    }

    await setRegister(page, viewCase.register);
    await page.goto(`/?area=handoff&paziente=${patient.id}`);
    await expect(page.locator('html')).toHaveClass(viewCase.register === 'grafite' ? /dark/ : /light/);
    const handoffCase = page.getByTestId('lume-handoff-case');
    await expect(handoffCase).toContainText(patient.name);
    await assertCaseContract(handoffCase);

    if (viewCase.viewport === 'narrow') {
      await assertInsideViewport(handoffCase, 'handoff narrow');
    }
  }
});

test('alias di review conserva i layout dei moduli propri', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/mockups/kree8');

  await page.getByRole('button', { name: 'Documenti paziente', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Referto cardiologico/ })).toBeVisible();
  await expect(page.locator('[class*="docGrid"]')).toHaveCSS('display', 'grid');
  await expect(page.locator('[class*="docPaper"]')).toHaveCSS('display', 'flex');

  await page.getByRole('button', { name: 'SISS', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Apri il portale con il paziente pronto/ })).toBeVisible();
  await expect(page.locator('[class*="launcherGrid"]').first()).toHaveCSS('display', 'grid');
  await expect(page.locator('div[class*="stageRow"]')).toHaveCSS('display', 'grid');
});
