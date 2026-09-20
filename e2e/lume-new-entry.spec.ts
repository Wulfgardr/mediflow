/* @Codex #71, #75 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { bootstrapUnlockedSession, setAiLaneKillSwitch } from './utils';

const SYNTHETIC_ENTRY = 'Controllo sintetico senza dati clinici reali. Nessun elemento richiede una decisione.';
type SyntheticPatient = { id: string; expectedPatientName: string };

async function createSyntheticPatient(page: Page, suffix: string): Promise<SyntheticPatient> {
  return page.evaluate(async (marker) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: `Lume${marker}`,
        lastName: `FixtureResponsivaConTestoEsteso${marker}`,
        taxCode: `LME71${marker.padStart(10, '0')}`,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico',
        phone: '0000000000',
        diagnoses: [],
      }),
    });
    if (!response.ok) throw new Error(`Failed to create synthetic patient: ${response.status}`);
    return { id: (await response.json() as { id: string }).id, expectedPatientName: `FixtureResponsivaConTestoEsteso${marker} Lume${marker}` };
  }, suffix);
}

async function openNewEntry(page: Page, patient: SyntheticPatient): Promise<void> {
  await page.goto(`/patients/${patient.id}/entries/new`);
  await expect(page.getByRole('heading', { name: 'Nuova voce clinica', exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Nuova voce clinica', exact: true })).toBeVisible();
  await expect(page.getByTestId('progressive-entry-composer').locator('header')
    .getByText(patient.expectedPatientName, { exact: true })).toBeVisible();
}

async function forceSyntheticDraftError(page: Page): Promise<void> {
  // @Codex: reach the optional tools through the ordinary disclosure.
  const session = page.locator('details#sessione-visita');
  if (await session.getAttribute('open') === null) {
    await session.locator(':scope > summary').click();
  }
  await expect(session).toHaveAttribute('open', '');
  await page.route('**/api/visit-session/draft', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'fixture-synthetic-failure' }),
  }));
  await page.getByRole('textbox', { name: 'Bozza o transcript', exact: true }).fill(
    `${SYNTHETIC_ENTRY} Testo esteso per verificare wrapping, leggibilità e stato di errore senza dati reali.`,
  );
  await page.getByRole('button', { name: 'Elabora bozza', exact: true }).click();
  await expect(page.getByRole('alert').filter({
    hasText: 'Elaborazione non riuscita. Il transcript resta modificabile manualmente.',
  })).toBeVisible();
}

async function setRegister(page: Page, register: 'giorno' | 'grafite'): Promise<void> {
  await page.evaluate((nextRegister) => {
    const root = document.documentElement;
    const theme = nextRegister === 'grafite' ? 'dark' : 'light';
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('mediflow-theme', theme);
  }, register);
}

async function attachVisualProof(
  page: Page,
  testInfo: TestInfo,
  name: string,
  viewport: { width: number; height: number },
  register: 'giorno' | 'grafite',
): Promise<void> {
  await page.setViewportSize(viewport);
  await setRegister(page, register);
  const draftError = page.getByRole('alert').filter({
    hasText: 'Elaborazione non riuscita. Il transcript resta modificabile manualmente.',
  });
  await expect(draftError).toBeVisible();
  await draftError.scrollIntoViewIfNeeded();
  await testInfo.attach(`${name}-error`, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });

  const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
  await editor.fill(`${SYNTHETIC_ENTRY} ${'VoceSinteticaEstesa'.repeat(12)}`);
  await editor.focus();
  await expect(editor).toBeFocused();

  // @Codex: the ordinary composer has one sheet and inline disclosures;
  // validate their actual geometry instead of the retired rail/aside grid.
  const overflowProof = await page.getByTestId('progressive-entry-composer').evaluate((composer) => {
    const form = composer.querySelector<HTMLElement>('form[aria-label="Nuova voce clinica"]');
    const sheet = composer.querySelector<HTMLElement>('[data-testid="lume-editor-workflow"]');
    if (!form || !sheet) throw new Error('Composer sheet/form missing');
    const targets: Array<[string, HTMLElement]> = [
      ['composer', composer as HTMLElement],
      ['sheet', sheet],
      ['form', form],
      ...['dati', 'resoconto', 'allegati', 'sessione-visita'].map((id): [string, HTMLElement] => {
        const element = form.querySelector<HTMLElement>(`#${id}`);
        if (!element) throw new Error(`Composer section missing: ${id}`);
        return [id, element];
      }),
      ...Array.from(form.querySelectorAll<HTMLDetailsElement>(':scope > details'))
        .map((element, index): [string, HTMLElement] => [`disclosure-${index}`, element]),
    ];
    return {
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      targets: targets.map(([label, element]) => {
        const rect = element.getBoundingClientRect();
        return {
          label,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clippedLeft: rect.left < -1,
          clippedRight: rect.right > document.documentElement.clientWidth + 1,
        };
      }),
    };
  });
  for (const target of overflowProof.targets) {
    expect(target.clientWidth, `${target.label} deve avere larghezza non nulla`).toBeGreaterThan(0);
    expect(target.scrollWidth, `${target.label} non deve scorrere orizzontalmente`).toBeLessThanOrEqual(target.clientWidth + 1);
    expect(target.clippedLeft, `${target.label} non deve essere tagliato a sinistra`).toBe(false);
    expect(target.clippedRight, `${target.label} non deve essere tagliato a destra`).toBe(false);
  }
  expect(overflowProof.document.scrollWidth).toBeLessThanOrEqual(overflowProof.document.clientWidth + 1);

  const clinicalSurfaces = await page.getByTestId('lume-editor-workflow').evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, backdropFilter: style.backdropFilter };
    }),
  );
  expect(clinicalSurfaces).toHaveLength(1);
  for (const surface of clinicalSurfaces) {
    expect(surface.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(surface.background).not.toBe('transparent');
    expect(surface.backdropFilter).toBe('none');
  }

  /* @Codex #75: toolbar, canvas e campo restano opachi e contenuti sul viewport reale. */
  const editorSurfaces = await page.locator('[data-lume-editor-surface]').evaluateAll((elements) =>
    elements.map((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const alpha = style.backgroundColor.startsWith('rgb(')
        ? 1
        : Number(style.backgroundColor.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/)?.[1] ?? Number.NaN);
      return {
        surface: node.dataset.lumeEditorSurface,
        background: style.backgroundColor,
        alpha,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      };
    }),
  );
  expect(editorSurfaces.map((surface) => surface.surface).sort()).toEqual(['canvas', 'field', 'toolbar']);
  for (const surface of editorSurfaces) {
    expect(surface.background, `${surface.surface} deve restare opaca`).not.toBe('rgba(0, 0, 0, 0)');
    expect(surface.background, `${surface.surface} deve restare opaca`).not.toBe('transparent');
    expect(surface.alpha, `${surface.surface} deve avere alpha esatto 1`).toBe(1);
    expect(surface.backdropFilter, `${surface.surface} non deve usare blur`).toBe('none');
    expect(surface.scrollWidth, `${surface.surface} non deve scorrere orizzontalmente`).toBeLessThanOrEqual(surface.clientWidth + 1);
  }
  expect(editorSurfaces.find((surface) => surface.surface === 'canvas')?.boxShadow).not.toBe('none');

  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });
}

test('nuova voce Lume espone stato, focus, errori e salvataggio senza affidarsi al colore', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const suffix = `${Date.now()}`.slice(-6);
  const patient = await createSyntheticPatient(page, suffix);
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'disabled');

  try {
    await openNewEntry(page, patient);

    const dateInput = page.getByLabel('Data e ora della voce clinica');
    await expect(dateInput).toHaveAttribute('aria-describedby', 'entry-date-description');
    await expect(page.locator('#entry-date-description')).toHaveText(
      'Puoi retrodatare la voce quando ricostruisci il diario.',
    );

    /* @Codex #75 */
    const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
    await expect(editor).toHaveAttribute('aria-multiline', 'true');
    await expect(editor).toHaveAttribute('aria-required', 'true');
    await expect(editor).toHaveAccessibleDescription(
      'Usa la barra per formattare il testo. Tab passa al controllo successivo.',
    );
    await expect(page.getByRole('group', { name: 'Strumenti del resoconto clinico', exact: true })).toMatchAriaSnapshot(`
      - group "Strumenti del resoconto clinico":
        - button "Titolo"
        - button "Sezione"
        - button "Paragrafo"
        - button "Bullet"
        - button "Numero"
        - button "Grassetto"
        - button "Corsivo"
        - button "Sottolinea"
        - button "Barrato"
        - button "Riduci rientro"
        - button "Aumenta rientro"
    `);

    // @Codex: ordinary native selects preserve type/setting values and
    // keyboard order; the previous segmented buttons are no longer rendered.
    const entryType = page.getByRole('combobox', { name: 'Tipo di voce', exact: true });
    const setting = page.getByRole('combobox', { name: 'Luogo della voce clinica', exact: true });
    await expect(entryType).toHaveValue('visit');
    await expect(entryType.locator('option')).toHaveText(['Visita', 'Remoto', 'Nota']);
    await expect(setting).toHaveValue('ambulatory');
    await expect(setting.locator('option')).toHaveText(['Ambulatorio', 'Domicilio']);
    await setting.selectOption('home');
    await expect(setting).toHaveValue('home');

    const metadataControls = page.locator('#dati').locator('select, input');
    await expect(metadataControls).toHaveCount(3);
    await expect(metadataControls.nth(0)).toHaveAccessibleName('Tipo di voce');
    await expect(metadataControls.nth(1)).toHaveAccessibleName('Luogo della voce clinica');
    await expect(metadataControls.nth(2)).toHaveAccessibleName('Data e ora della voce clinica');
    await entryType.focus();
    await expect(entryType).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(setting).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dateInput).toBeFocused();

    await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
    const emptyEntryAlert = page.getByRole('alert').filter({ hasText: 'Resoconto clinico mancante' });
    await expect(emptyEntryAlert).toContainText('Inserisci un resoconto clinico prima di registrare la voce.');
    await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/entries/new$`));

    await editor.focus();
    await expect(editor).toBeFocused();
    await page.keyboard.press('Tab');
    const attachmentButton = page.getByRole('button', { name: 'Aggiungi allegati alla voce clinica', exact: true });
    await expect(attachmentButton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(editor).toBeFocused();

    await forceSyntheticDraftError(page);
    await editor.fill(SYNTHETIC_ENTRY);
    await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`), { timeout: 45_000 });

    await openNewEntry(page, patient);
    const context = page.getByRole('form', { name: 'Nuova voce clinica', exact: true })
      .locator(':scope > details').filter({ has: page.locator('summary').filter({ hasText: 'Consulta cartella' }) });
    await context.locator(':scope > summary').click();
    await expect(context).toHaveAttribute('open', '');
    const recentEntries = context.getByRole('region', { name: 'Ultime voci registrate', exact: true });
    await expect(recentEntries.locator('summary')).toHaveText(/ · Visita ambulatoriale$/);
  } finally {
    await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  }
});

test('nuova voce Lume resta opaca e senza overflow in giorno e grafite', async ({ page }, testInfo) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createSyntheticPatient(page, `${Date.now()}`.slice(-6));
  await openNewEntry(page, patient);
  await forceSyntheticDraftError(page);

  await attachVisualProof(page, testInfo, 'giorno-wide', { width: 1440, height: 1000 }, 'giorno');
  await attachVisualProof(page, testInfo, 'grafite-wide', { width: 1440, height: 1000 }, 'grafite');
  await attachVisualProof(page, testInfo, 'giorno-narrow', { width: 390, height: 844 }, 'giorno');
  await attachVisualProof(page, testInfo, 'grafite-narrow', { width: 390, height: 844 }, 'grafite');
});
