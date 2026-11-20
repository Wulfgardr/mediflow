import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';
import { sealDiaryEntry } from './fixtures/sealed-diary-entry';

async function reopenSession(page: Page) {
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
  await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
}

function webRequest<T>(page: Page, path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) });
    const payload = await response.text();
    return { status: response.status, data: (payload ? JSON.parse(payload) : null) as T };
  }, { path, method, body });
}

type ObservedConsoleError = Readonly<{ text: string; url: string }>;
const errorsByPage = new WeakMap<Page, ObservedConsoleError[]>();
const authLockReceiptsByPage = new WeakMap<Page, Array<Promise<{
  status: number;
  state: string | null;
  requestEtag: string | null;
  responseEtag: string | null;
}>>>();
const AUTH_LOCK_CONFLICT_CONSOLE = 'Failed to load resource: the server responded with a status of 409 (Conflict)';
test.beforeEach(async ({ page }) => {
  const errors: ObservedConsoleError[] = [];
  const authLockReceipts: Array<Promise<{
    status: number;
    state: string | null;
    requestEtag: string | null;
    responseEtag: string | null;
  }>> = [];
  errorsByPage.set(page, errors);
  authLockReceiptsByPage.set(page, authLockReceipts);
  page.on('console', message => {
    if (message.type() === 'error') errors.push({ text: message.text(), url: message.location().url });
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname !== '/api/auth/lock') return;
    authLockReceipts.push(response.text().then((text) => {
      let state: string | null = null;
      try {
        const payload = JSON.parse(text) as { state?: unknown };
        state = typeof payload.state === 'string' ? payload.state : null;
      } catch {  }
      return {
        status: response.status(),
        state,
        requestEtag: response.request().headers()['if-match'] ?? null,
        responseEtag: response.headers().etag ?? null,
      };
    }).catch(() => ({
      status: response.status(), state: null,
      requestEtag: response.request().headers()['if-match'] ?? null,
      responseEtag: response.headers().etag ?? null,
    })));
  });
  page.on('pageerror', error => errors.push({ text: error.message, url: '' }));
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    await testInfo.attach('smoke-focus-context.json', {
      contentType: 'application/json',
      body: JSON.stringify(await page.evaluate(() => ({
        route: location.pathname + location.search + location.hash,
        viewport: { width: innerWidth, height: innerHeight },
        activeElement: document.activeElement ? {
          tag: document.activeElement.tagName,
          id: document.activeElement.id,
          role: document.activeElement.getAttribute('role'),
          label: document.activeElement.getAttribute('aria-label'),
        } : null,
        headings: Array.from(document.querySelectorAll('h1')).map(element => ({
          text: element.textContent, tabIndex: element.tabIndex,
          focused: element === document.activeElement, rect: element.getBoundingClientRect().toJSON(),
        })),
      }))),
    });
  }
  const authLockReceipts = await Promise.all(authLockReceiptsByPage.get(page) ?? []);
  const recoveredAuthLockConflicts = authLockReceipts.filter((receipt, index) => {
    const retry = authLockReceipts[index + 1];
    return receipt.status === 409
      && receipt.state === 'server_invalidation_unconfirmed'
      && !!receipt.responseEtag
      && retry?.status === 200
      && retry.state === 'server_invalidation_confirmed'
      && retry.requestEtag === receipt.responseEtag;
  }).length;
  const authLockConflicts = authLockReceipts.filter(receipt => receipt.status === 409).length;
  const errors = errorsByPage.get(page) ?? [];
  const pageOrigin = new URL(page.url()).origin;
  const isReconciledAuthLockConsole = (error: ObservedConsoleError) => {
    if (error.text !== AUTH_LOCK_CONFLICT_CONSOLE) return false;
    try {
      const url = new URL(error.url);
      return url.origin === pageOrigin && url.pathname === '/api/auth/lock';
    } catch { return false; }
  };
  const lockConsoleConflicts = errors.filter(isReconciledAuthLockConsole).length;
  const remainingErrors = authLockConflicts === recoveredAuthLockConflicts
    && lockConsoleConflicts === recoveredAuthLockConflicts
    ? errors.filter(error => !isReconciledAuthLockConsole(error))
    : errors;
  expect(remainingErrors).toEqual([]);
});

test('web smoke: unlock/setup + patients filters + settings navigation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  await page.goto('/');
  const lockScreen = page.getByLabel('MediFlow lock screen');
  await expect(lockScreen).toBeVisible();
  await expect(lockScreen.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
  await expect(lockScreen.getByText(/sessione protetta/i)).toHaveCount(0);
  await expect(lockScreen.getByText(/inserisci (il )?pin/i)).toHaveCount(0);
  await expect(lockScreen.getByText('PIN operatore', { exact: true })).toHaveClass(/sr-only/);
  await expect(lockScreen.getByLabel('PIN operatore')).toBeVisible();

  await bootstrapUnlockedSession(page, pin);
  await page.getByRole('navigation', { name: 'Navigazione principale', exact: true })
    .getByRole('link', { name: 'Pazienti', exact: true }).click();

  const patientsSearch = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
  await expect(patientsSearch).toBeVisible({ timeout: 20_000 });
  await patientsSearch.focus();
  await expect(patientsSearch).toBeFocused();

  await page.getByRole('button', { name: 'Archivio' }).click();
  await expect(page.getByRole('button', { name: 'Archivio' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Attivi' }).click();
  await expect(page.getByRole('button', { name: 'Attivi' })).toHaveAttribute('aria-pressed', 'true');
  await patientsSearch.fill('smoke');
  await patientsSearch.fill('');

  const patient = await page.evaluate(async () => {
    const marker = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const taxCode = `C17${marker}X`;
    const response = await fetch('/api/patients', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Sintetico', lastName: 'Percorso', taxCode,
        birthDate: '1980-01-01T00:00:00.000Z' }) });
    if (response.status !== 201) throw new Error(`Synthetic patient: HTTP ${response.status}`);
    return { ...(await response.json()), taxCode } as { id: string; taxCode: string };
  });
  await page.reload();
  await reopenSession(page);
  await patientsSearch.fill(patient.taxCode);
  const row = page.getByRole('option').filter({ hasText: 'Percorso Sintetico' });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`));
  await page.getByTestId('lume-scheda-header').getByRole('button', { name: 'Azioni', exact: true }).focus();
  await page.keyboard.press('Enter');
  const edit = page.locator(`a[href="/patients/${patient.id}/edit"]`).first();
  await edit.focus(); await page.keyboard.press('Enter');
  const firstName = page.getByRole('textbox', { name: /^Nome/ });
  await expect(firstName).toHaveValue('Sintetico');
  await firstName.fill('');
  await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
  await expect(firstName).toBeFocused();
  await expect(firstName).toHaveAttribute('aria-invalid', 'true');
  await expect(firstName).toHaveAttribute('aria-describedby', 'patient-firstName-error');
  await expect(page.locator('#patient-firstName-error')).toHaveAttribute('role', 'alert');
  await expect(page.getByRole('textbox', { name: /^Cognome/ })).toHaveValue('Percorso');
  await firstName.fill('Modificato');
  const update = page.getByRole('button', { name: 'Aggiorna scheda', exact: true });
  await update.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`));
  await page.reload();
  await reopenSession(page);
  await expect(page.getByTestId('lume-scheda-header')).toContainText('Modificato');
  const stored = await webRequest(page, `/api/patients/${patient.id}`);
  expect(stored.status).toBe(200);
  expect(stored.data).toMatchObject({ firstName: 'Modificato', taxCode: patient.taxCode, version: 2 });

  const settingsNav = page.getByRole('link', { name: 'Impostazioni', exact: true });
  await expect(settingsNav).toBeVisible();
  await expect(settingsNav).toHaveAttribute('href', '/settings');
  await settingsNav.focus();
  await expect(settingsNav).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Impostazioni', level: 1, exact: true })).toBeVisible();
  await expect(page.getByTestId('settings-overview-section')).toBeVisible();

  await page.locator('a[href="/settings/aspetto"]:visible').click();
  await expect(page).toHaveURL(/\/settings\/aspetto$/);
  await expect(page.getByTestId('settings-nav-sidebar')).toBeVisible();
  await expect(page.getByTestId('settings-appearance-section')).toBeVisible();
  await expect(page.getByTestId('ui-style-runtime-notice')).toBeVisible();
  await expect(page.getByTestId('ui-accessibility-controls')).toBeVisible();

  const returnToPatients = page.getByRole('navigation', { name: 'Navigazione principale', exact: true })
    .getByRole('link', { name: 'Pazienti', exact: true });
  await expect(returnToPatients).toHaveAttribute('href', '/?area=incarico');
  await returnToPatients.focus();
  await expect(returnToPatients).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]area=incarico/);
  await expect(page.getByRole('heading', { name: 'Pazienti', level: 1, exact: true })).toBeVisible();
  await expect(patientsSearch).toBeVisible();
});

test('web smoke: Rivedi agenda focuses its controlled heading without leaving turno', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/?area=turno');
  await reopenSession(page);

  const reviewAgenda = page.getByRole('button', { name: 'Rivedi agenda', exact: true });
  const agendaHeading = page.getByRole('heading', { name: 'Appuntamenti', exact: true, level: 2 });

  await expect(reviewAgenda).toBeVisible();
  await expect(reviewAgenda).toHaveAttribute('aria-controls', 'turno-agenda-heading');
  await expect(agendaHeading).toHaveAttribute('id', 'turno-agenda-heading');

  await reviewAgenda.focus();
  await expect(reviewAgenda).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(agendaHeading).toBeFocused();
  await expect(agendaHeading).toBeInViewport();
  await expect(page).toHaveURL(/[?&]area=turno(?:&|$)/);
});

test('web smoke: live decision CTAs always open their declared patient context', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const createPatient = async (firstName: string, exemptions: string[]) => {
    const lastName = `Smoke${marker}`;
    const taxCode = `SMK${firstName[0]}${marker}00`;
    const response = await webRequest<{ id: string }>(page, '/api/patients', 'POST', {
      firstName, lastName, taxCode, birthDate: '1980-01-01T00:00:00.000Z', exemptions,
      notes: `Contesto sintetico ${firstName}. Nessun dato reale.`, diagnoses: [],
    });
    expect(response.status).toBe(201);
    const patient = response.data;
    return { id: patient.id, name: `${lastName} ${firstName}`, taxCode };
  };
  const quadroPatient = await createPatient('Quadro', []);
  const documentsPatient = await createPatient('Documenti', ['031']);
  const latest = await webRequest<Array<{ date: string }>>(page, '/api/entries?limit=1&orderBy=date&orderDir=desc');
  expect(latest.status).toBe(200);
  const rows = latest.data;
  const date = new Date(Math.max(Date.now(), ...rows.map(row => Date.parse(row.date)).filter(Number.isFinite)) + 1_000).toISOString();
  const entryTitle = `Follow-up sintetico ${marker}`;
  const entryResponse = await webRequest<{ id: string; version: number }>(page, '/api/entries', 'POST', await sealDiaryEntry(page, {
    patientId: quadroPatient.id, type: 'note', title: entryTitle,
    content: 'Voce sintetica per verificare la destinazione della CTA.', date, setting: 'ambulatory',
  }));
  expect(entryResponse.status).toBe(201);
  const entry = entryResponse.data;

  await page.goto(`/?area=turno&paziente=${documentsPatient.id}`);
  await reopenSession(page);
  const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  await expect(page.getByRole('button', { name: 'Vai alla revisione', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apri esenzioni', exact: true })).toHaveCount(0);

  const review = page.getByRole('button', { name: 'Apri revisione', exact: true });
  await review.focus();
  await expect(review).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Evidenza, decisione e prossimo passo', level: 1, exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`[?&]area=revisione&.*paziente=${documentsPatient.id}`));
  await expect(page.getByTestId('lume-review-case').getByRole('heading', { name: documentsPatient.name, exact: true })).toBeVisible();
  const documents = page.getByRole('link', { name: 'Apri documenti', exact: true });
  await expect(documents).toHaveAttribute('href', `/patients/${documentsPatient.id}/modules#documenti`);
  await documents.focus();
  await expect(documents).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${documentsPatient.id}/modules#documenti$`));
  await expect(page.locator('#documenti')).toHaveAttribute('data-folder-active', 'true');
  await expect(page.getByRole('heading', { name: documentsPatient.name, level: 1, exact: true })).toBeVisible();

  await navigation.getByRole('link', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: 'Vai ai pazienti', exact: true }).click();
  await expect(navigation.getByRole('link', { name: 'Pazienti', exact: true })).toHaveAttribute('aria-current', 'page');
  const patientsSearch = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
  await patientsSearch.fill(documentsPatient.taxCode);
  const patientRow = page.getByRole('option').filter({ has: page.getByText(documentsPatient.name, { exact: true }) });
  await expect(patientRow).toBeVisible();
  await patientRow.focus();
  await expect(patientRow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${documentsPatient.id}/modules$`));
  await expect(page.getByTestId('lume-scheda-header')).toContainText(documentsPatient.taxCode);
  await openPatientSection(page, 'amministrazione');
  const exemptions = page.locator('#amministrazione').getByRole('list', { name: 'Esenzioni registrate' });
  await expect(exemptions).toContainText('031');

  await navigation.getByRole('link', { name: 'Diario', exact: true }).click();
  const diaryEntry = page.getByTestId('lume-diario-entry').filter({ has: page.getByRole('heading', { name: entryTitle, exact: true }) });
  await expect(diaryEntry).toContainText(quadroPatient.name);
  const openQuadro = diaryEntry.getByRole('button', { name: 'Apri quadro', exact: true });
  await openQuadro.focus();
  await expect(openQuadro).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${quadroPatient.id}/modules#quadro$`));
  await expect(page.locator('#quadro')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sezioni della vista', exact: true }).getByRole('link', { name: 'Riepilogo', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect(page.getByRole('heading', { name: quadroPatient.name, level: 1, exact: true })).toBeFocused();
  await expect(page.getByTestId('lume-scheda-header')).toContainText(quadroPatient.taxCode);
  await expect(page.getByRole('region', { name: 'Riepilogo clinico', exact: true })).toContainText('Contesto sintetico Quadro.');

  const removedEntry = await webRequest(page, `/api/entries/${entry.id}`, 'DELETE', { version: entry.version });
  expect(removedEntry.status).toBe(200);
  for (const resource of [`/api/patients/${documentsPatient.id}`, `/api/patients/${quadroPatient.id}`]) {
    const current = await webRequest<{ version: number }>(page, resource);
    expect(current.status).toBe(200);
    const removed = await webRequest(page, resource, 'DELETE', { version: current.data.version });
    expect(removed.status).toBe(200);
  }
});
