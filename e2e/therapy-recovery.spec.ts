import { expect, test, type Page, type Route } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, unlockIfNeeded } from './utils';

// Real authenticated routes and synthetic SQLite records. Only the named
// transport failures are injected; writes forwarded by route.fetch still commit.
type Fixture = { patientId: string; therapyId: string; secondId: string };
const dosage = (page: Page) => page.locator('#terapie input[name="dosage"]');
const note = (page: Page) => page.locator('#terapie textarea[name="motivation"]');
const save = (page: Page) => page.locator('#terapie').getByRole('button', { name: 'Aggiorna terapia', exact: true });
const recovery = (page: Page) => page.locator('#terapie').getByRole('alert');
const aiWrites = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const calls: string[] = [];
  aiWrites.set(page, calls);
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/ai/')) calls.push(request.url()); });
});
test.afterEach(async ({ page }) => { expect(aiWrites.get(page)).toEqual([]); });

async function fixture(page: Page): Promise<Fixture> {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  return page.evaluate(async () => {
    const marker = crypto.randomUUID();
    for (const key of ['aiPatientInsightKillSwitch', 'aiSmartImportKillSwitch', 'aiDocumentSynthesisKillSwitch', 'aiTreatmentReasoningKillSwitch']) {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: 'disabled' }) });
      if (!response.ok) throw new Error(`No-AI setting: ${response.status}`);
    }
    const response = await fetch('/api/patients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Sintetico', lastName: 'Recupero', taxCode: `SYN${marker}`, birthDate: '1972-04-12T00:00:00.000Z' }),
    });
    if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`);
    const { id: patientId } = await response.json() as { id: string };
    const therapyId = `therapy-${marker}`;
    const secondId = `second-${marker}`;
    for (const [id, drugName] of [[therapyId, 'Farmaco sintetico principale'], [secondId, 'Farmaco sintetico secondario']]) {
      const added = await fetch('/api/therapies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, patientId, drugName, activePrinciple: 'Principio sintetico', motivation: 'Nota iniziale sintetica', dosage: 'Dose iniziale sintetica', status: 'active', startDate: '2026-10-01T08:00:00.000Z' }) });
      if (!added.ok) throw new Error(`Synthetic therapy: ${added.status}`);
    }
    return { patientId, therapyId, secondId };
  });
}

async function openDraft(page: Page, data: Fixture): Promise<void> {
  await page.goto(`/patients/${data.patientId}/modules`);
  await openPatientSection(page, 'terapie');
  await page.locator('#terapie').getByRole('heading', { name: 'Farmaco sintetico principale', exact: true })
    .locator('..').locator('..').locator('..').getByRole('button', { name: 'Modifica', exact: true }).click();
  await dosage(page).fill('Dose della bozza sintetica');
  await note(page).fill('Nota sintetica da conservare');
}

async function concurrentEdit(page: Page, data: Fixture, version = 1): Promise<void> {
  expect(await page.evaluate(async ({ id, expected }) => {
    const response = await fetch(`/api/therapies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: expected, dosage: `Dose concorrente ${expected + 1}`, status: 'suspended' }) });
    return response.status;
  }, { id: data.therapyId, expected: version })).toBe(200);
}

async function records(page: Page, patientId: string) {
  return page.evaluate(async id => {
    const response = await fetch(`/api/therapies?patientId=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Authoritative read: ${response.status}`);
    return response.json() as Promise<Array<{ id: string; patientId: string; version: number; dosage: string; motivation: string | null; status: string }>>;
  }, patientId);
}

for (const width of [1440, 390]) {
  test(`409 recovery reads suspended therapy dosage and note after reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const data = await fixture(page);
    await openDraft(page, data);
    await concurrentEdit(page, data);
    const writes: Array<{ version: number }> = [];
    page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith(`/api/therapies/${data.therapyId}`)) writes.push(request.postDataJSON()); });
    const conflict = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/api/therapies/${data.therapyId}`));
    await save(page).click();
    expect((await conflict).status()).toBe(409);
    await expect(dosage(page)).toHaveValue('Dose della bozza sintetica');
    await expect(note(page)).toHaveValue('Nota sintetica da conservare');
    await expect(save(page)).toBeDisabled();
    await expect(recovery(page)).toBeFocused();
    await expect(recovery(page)).toContainText('La bozza è conservata');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Rileggi terapia', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(recovery(page)).toContainText('Dose concorrente 2');
    await expect(recovery(page)).toContainText('Sospesa');
    await expect(save(page)).toBeDisabled();
    expect(writes.map(write => write.version)).toEqual([1]);
    await test.info().attach(`recovery-${width}px`, { body: await page.locator('#terapie').screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Ho confrontato i dati: mantieni la bozza', exact: true }).click();
    await expect(dosage(page)).toHaveValue('Dose della bozza sintetica');
    await expect(save(page)).toBeEnabled();
    const accepted = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/api/therapies/${data.therapyId}`));
    await save(page).click();
    expect((await accepted).status()).toBe(200);
    expect(writes.map(write => write.version)).toEqual([1, 2]);
    const stored = (await records(page, data.patientId)).find(item => item.id === data.therapyId);
    expect(stored).toMatchObject({ patientId: data.patientId, version: 3, dosage: 'Dose della bozza sintetica', motivation: 'Nota sintetica da conservare', status: 'suspended' });
    await expect(save(page)).toBeHidden();

    // Read the saved dosage and note from the suspended card after a fresh load.
    await page.reload();
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    await openPatientSection(page, 'terapie');
    const suspendedCard = page.locator('#terapie').getByText('Farmaco sintetico principale', { exact: true })
      .locator('..').locator('..').locator('..');
    await expect(suspendedCard.getByText('Sospesa', { exact: true })).toBeVisible();
    await expect(suspendedCard.getByText('Dose della bozza sintetica', { exact: true })).toBeVisible();
    await expect(suspendedCard.getByText('Nota sintetica da conservare', { exact: true })).toBeVisible();
    await expect(suspendedCard.getByRole('textbox')).toHaveCount(0);
    await expect(suspendedCard.getByRole('button', { name: 'Modifica', exact: true })).toHaveCount(0);
    await expect(suspendedCard.getByRole('button', { name: 'Riprendi', exact: true })).toBeVisible();
    const reloaded = (await records(page, data.patientId)).find(item => item.id === data.therapyId);
    expect(reloaded).toMatchObject({ patientId: data.patientId, version: 3, dosage: 'Dose della bozza sintetica', motivation: 'Nota sintetica da conservare', status: 'suspended' });
    expect(writes.map(write => write.version)).toEqual([1, 2]);
    await assertNoHorizontalOverflow(page, [{ label: 'therapy pane', selector: '#terapie' }]);
  });
}

test('a list refresh during editing cannot silently advance the draft version', async ({ page }) => {
  const data = await fixture(page);
  await openDraft(page, data);
  await concurrentEdit(page, data);
  const refreshed = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/therapies?'));
  await page.locator('#terapie').getByRole('heading', { name: 'Farmaco sintetico secondario', exact: true })
    .locator('..').locator('..').locator('..').getByRole('button', { name: 'Sospendi', exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(page.locator('#terapie').getByText('Dose concorrente 2', { exact: true })).toBeVisible();
  const response = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/api/therapies/${data.therapyId}`));
  await save(page).click();
  expect((await response).status()).toBe(409);
  expect((await records(page, data.patientId)).find(item => item.id === data.therapyId)).toMatchObject({ version: 2, dosage: 'Dose concorrente 2' });
});

test('an invalid form keeps input and does not issue a write', async ({ page }) => {
  const data = await fixture(page);
  await openDraft(page, data);
  let writes = 0;
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith(`/api/therapies/${data.therapyId}`)) writes++; });
  await dosage(page).fill('');
  await save(page).click();
  await expect(page.locator('#terapie').getByText('La posologia è richiesta', { exact: true })).toBeVisible();
  await expect(note(page)).toHaveValue('Nota sintetica da conservare');
  await expect(dosage(page)).toBeFocused();
  expect(writes).toBe(0);
  expect((await records(page, data.patientId)).find(item => item.id === data.therapyId)?.version).toBe(1);
});

test('a rejected create can be explicitly retried with the same identity after readback', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(`/patients/${data.patientId}/modules`);
  await openPatientSection(page, 'terapie');
  await page.getByRole('button', { name: 'Nuova terapia', exact: true }).click();
  await page.getByText('Farmaco manuale o galenico', { exact: true }).click();
  await page.locator('#terapie input[name="drugName"]').fill('Nuovo farmaco sintetico');
  await dosage(page).fill('Dose nuova sintetica');
  const ids: string[] = [];
  await page.route('**/api/therapies', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push(route.request().postDataJSON().id);
    if (ids.length === 1) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Synthetic rejection before commit"}' });
    return route.continue();
  });
  const create = page.getByRole('button', { name: 'Salva terapia', exact: true });
  await create.click();
  await expect(create).toBeDisabled();
  await page.getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
  await expect(recovery(page)).toContainText('La terapia non compare nella cartella');
  await expect(create).toBeDisabled();
  expect(ids).toHaveLength(1);
  await page.getByRole('button', { name: 'Ho verificato: continua con la bozza', exact: true }).click();
  const committed = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/therapies'));
  await create.click();
  expect((await committed).status()).toBe(201);
  expect(ids).toEqual([ids[0], ids[0]]);
  expect((await records(page, data.patientId)).filter(item => item.id === ids[0])).toHaveLength(1);
});

test('a newer edit after readback still conflicts with the explicitly reviewed version', async ({ page }) => {
  const data = await fixture(page);
  await openDraft(page, data);
  await concurrentEdit(page, data);
  await save(page).click();
  await expect(recovery(page)).toContainText('Terapia aggiornata altrove');
  await page.getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
  await expect(recovery(page)).toContainText('Dose concorrente 2');
  await concurrentEdit(page, data, 2);
  await page.getByRole('button', { name: 'Ho confrontato i dati: mantieni la bozza', exact: true }).click();
  const conflict = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/api/therapies/${data.therapyId}`));
  await save(page).click();
  expect((await conflict).status()).toBe(409);
  await expect(save(page)).toBeDisabled();
  await expect(dosage(page)).toHaveValue('Dose della bozza sintetica');
  expect((await records(page, data.patientId)).find(item => item.id === data.therapyId)).toMatchObject({ version: 3, dosage: 'Dose concorrente 3', status: 'suspended' });
});

test('changing patient requires deliberate discard and never carries the therapy draft', async ({ page }) => {
  const original = await fixture(page);
  const other = await fixture(page);
  await openDraft(page, original);
  const patients = page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).getByRole('link', { name: 'Pazienti', exact: true });
  await patients.click();
  const confirmation = page.getByRole('dialog', { name: 'Lasciare la compilazione?', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Continua a scrivere', exact: true }).click();
  await expect(dosage(page)).toHaveValue('Dose della bozza sintetica');
  await expect(note(page)).toHaveValue('Nota sintetica da conservare');
  expect((await records(page, original.patientId)).find(item => item.id === original.therapyId)?.version).toBe(1);
  await patients.click();
  await confirmation.getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
  await expect(page).toHaveURL(/area=incarico/);
  await page.goto(`/patients/${other.patientId}/modules`);
  await expect(page).toHaveURL(new RegExp(`/patients/${other.patientId}/modules`));
  await openPatientSection(page, 'terapie');
  await expect(dosage(page)).toHaveCount(0);
  expect((await records(page, other.patientId)).find(item => item.id === other.therapyId)).toMatchObject({ patientId: other.patientId, version: 1, dosage: 'Dose iniziale sintetica' });
});

test('a failed write and a failed reread retain the draft without resubmitting', async ({ page }) => {
  const data = await fixture(page);
  await openDraft(page, data);
  let writes = 0;
  await page.route(`**/api/therapies/${data.therapyId}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Synthetic failure before commit"}' });
  });
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  await expect(recovery(page)).toContainText('Esito del salvataggio non confermato');
  await page.route('**/api/therapies?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic read failure"}' }));
  await page.getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
  await expect(recovery(page)).toContainText('Rilettura non riuscita');
  await expect(save(page)).toBeDisabled();
  await expect(dosage(page)).toHaveValue('Dose della bozza sintetica');
  await expect(note(page)).toHaveValue('Nota sintetica da conservare');
  expect(writes).toBe(1);
  await page.unroute('**/api/therapies?*');
  await page.unroute(`**/api/therapies/${data.therapyId}`);
  await page.getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
  await expect(recovery(page)).toContainText('Dose iniziale sintetica');
  await page.getByRole('button', { name: 'Ho confrontato i dati: mantieni la bozza', exact: true }).click();
  await save(page).click();
  expect((await records(page, data.patientId)).find(item => item.id === data.therapyId)).toMatchObject({ version: 2, dosage: 'Dose della bozza sintetica' });
});

test('a lost create response is reconciled by stable identity without a duplicate write', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(`/patients/${data.patientId}/modules`);
  await openPatientSection(page, 'terapie');
  await page.getByRole('button', { name: 'Nuova terapia', exact: true }).click();
  await page.getByText('Farmaco manuale o galenico', { exact: true }).click();
  await page.locator('#terapie input[name="drugName"]').fill('Nuovo farmaco sintetico');
  await dosage(page).fill('Dose nuova sintetica');
  let writes = 0;
  await page.route('**/api/therapies', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort('failed');
  });
  const create = page.getByRole('button', { name: 'Salva terapia', exact: true });
  await create.click();
  await expect(create).toBeDisabled();
  await expect(dosage(page)).toHaveValue('Dose nuova sintetica');
  await page.getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
  await expect(recovery(page)).toContainText('La terapia risulta già registrata');
  await expect(create).toBeDisabled();
  expect(writes).toBe(1);
  const created = (await records(page, data.patientId)).filter(item => item.dosage === 'Dose nuova sintetica');
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ patientId: data.patientId, version: 1 });
  await page.getByRole('button', { name: 'Chiudi scheda terapia', exact: true }).click();
  await expect(create).toBeHidden();
});

const deleteRecovery = (page: Page) => page.getByRole('alert', { name: 'Recupero eliminazione terapia', exact: true });
const reviewedDelete = (page: Page) => deleteRecovery(page).getByRole('button', { name: 'Ho confrontato i dati: elimina con questa motivazione', exact: true });
const deletionReason = 'Inserimento duplicato sintetico: motivazione da conservare';

async function openTherapies(page: Page, data: Fixture): Promise<void> {
  await page.goto(`/patients/${data.patientId}/modules`);
  await openPatientSection(page, 'terapie');
  await expect(page.locator('#terapie').getByRole('heading', { name: 'Farmaco sintetico principale', exact: true })).toBeVisible();
}

async function requestDeletion(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Elimina Farmaco sintetico principale solo se inserito per errore', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Eliminare questo farmaco dalla cartella?', exact: true });
  await dialog.getByRole('textbox', { name: "Motivazione dell'eliminazione" }).fill(deletionReason);
  await dialog.getByRole('button', { name: 'Elimina', exact: true }).click();
}

for (const width of [1440, 390]) {
  test(`delete conflict keeps its reason through a failed reread and requires renewed confirmation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const data = await fixture(page);
    await openTherapies(page, data);
    await concurrentEdit(page, data);
    const writes: Array<{ version: number; deletionReason: string }> = [];
    page.on('request', request => {
      if (request.method() === 'DELETE' && request.url().endsWith(`/api/therapies/${data.therapyId}`)) writes.push(request.postDataJSON());
    });
    const conflict = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/api/therapies/${data.therapyId}`));
    await requestDeletion(page);
    expect((await conflict).status()).toBe(409);
    await expect(deleteRecovery(page)).toBeFocused();
    await expect(deleteRecovery(page)).toContainText('Eliminazione rifiutata: terapia aggiornata altrove');
    await expect(deleteRecovery(page)).toContainText(deletionReason);
    await assertNoHorizontalOverflow(page, [{ label: 'therapy deletion recovery', selector: '#terapie' }]);
    await expect(reviewedDelete(page)).toHaveCount(0);
    expect(writes.map(write => write.version)).toEqual([1]);

    await page.route('**/api/therapies?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic read failure"}' }));
    await page.keyboard.press('Tab');
    await expect(deleteRecovery(page).getByRole('button', { name: 'Rileggi terapia', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(deleteRecovery(page)).toContainText('Verifica non riuscita');
    await expect(deleteRecovery(page)).toContainText(deletionReason);
    await expect(reviewedDelete(page)).toHaveCount(0);
    expect(writes).toHaveLength(1);

    await page.unroute('**/api/therapies?*');
    await deleteRecovery(page).getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
    await expect(deleteRecovery(page).locator('[aria-label="Terapia attualmente registrata"]')).toContainText('Dose concorrente 2');
    await expect(deleteRecovery(page)).toContainText(deletionReason);
    await assertNoHorizontalOverflow(page, [{ label: 'therapy deletion comparison', selector: '#terapie' }]);
    await test.info().attach(`delete-recovery-${width}px`, { body: await deleteRecovery(page).screenshot(), contentType: 'image/png' });
    expect(writes).toHaveLength(1);
    await reviewedDelete(page).click();
    const confirmation = page.getByRole('dialog', { name: 'Confermi l’eliminazione della terapia riletta?', exact: true });
    await expect(confirmation).toBeVisible();
    expect(writes).toHaveLength(1);
    const accepted = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/api/therapies/${data.therapyId}`));
    await confirmation.getByRole('button', { name: 'Conferma nuovo invio', exact: true }).click();
    expect((await accepted).status()).toBe(200);
    await expect(deleteRecovery(page)).toHaveCount(0);
    expect(writes.map(write => write.version)).toEqual([1, 2]);
    expect(writes.every(write => typeof write.deletionReason === 'string' && write.deletionReason.length > 0)).toBe(true);
    const remaining = await records(page, data.patientId);
    expect(remaining.some(item => item.id === data.therapyId)).toBe(false);
    expect(remaining.find(item => item.id === data.secondId)).toMatchObject({ patientId: data.patientId, version: 1 });
    await assertNoHorizontalOverflow(page, [{ label: 'therapy pane', selector: '#terapie' }]);
  });
}

test('lost delete response keeps the reason and absence does not authorize another deletion', async ({ page }) => {
  const data = await fixture(page);
  await openTherapies(page, data);
  let writes = 0;
  await page.route(`**/api/therapies/${data.therapyId}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await requestDeletion(page);
  await expect(deleteRecovery(page)).toContainText('L’esito non è confermato');
  await expect(deleteRecovery(page)).toContainText(deletionReason);
  await expect(reviewedDelete(page)).toHaveCount(0);
  await deleteRecovery(page).getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
  await expect(deleteRecovery(page)).toContainText('Questo non conferma che la richiesta di eliminazione sia riuscita');
  await expect(deleteRecovery(page)).toContainText(deletionReason);
  await expect(reviewedDelete(page)).toHaveCount(0);
  expect(writes).toBe(1);
  const remaining = await records(page, data.patientId);
  expect(remaining.some(item => item.id === data.therapyId)).toBe(false);
  expect(remaining.find(item => item.id === data.secondId)).toMatchObject({ patientId: data.patientId, version: 1 });
  await deleteRecovery(page).getByRole('button', { name: 'Annulla recupero e scarta la motivazione', exact: true }).click();
  await expect(deleteRecovery(page)).toHaveCount(0);
  expect(writes).toBe(1);
});

test('discarding recovery still requires reread and a new reason before another deletion', async ({ page }) => {
  const data = await fixture(page);
  await openTherapies(page, data);
  let writes = 0;
  await page.route(`**/api/therapies/${data.therapyId}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    writes++;
    if (writes === 1) return route.abort('failed');
    return route.continue();
  });
  await requestDeletion(page);
  await expect(deleteRecovery(page)).toContainText('L’esito non è confermato');
  await deleteRecovery(page).getByRole('button', { name: 'Annulla recupero e scarta la motivazione', exact: true }).click();
  await expect(deleteRecovery(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Elimina Farmaco sintetico principale solo se inserito per errore', exact: true }).click();
  await expect(deleteRecovery(page)).toContainText('La motivazione precedente è stata scartata');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toBe(1);
  await deleteRecovery(page).getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
  await deleteRecovery(page).getByRole('button', { name: 'Ho confrontato i dati: indica una nuova motivazione', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Confermi l’eliminazione della terapia riletta?', exact: true });
  await expect(confirmation.getByRole('button', { name: 'Conferma nuovo invio', exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  await confirmation.getByRole('textbox', { name: "Motivazione dell'eliminazione" }).fill('Nuova motivazione sintetica');
  const accepted = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/api/therapies/${data.therapyId}`));
  await confirmation.getByRole('button', { name: 'Conferma nuovo invio', exact: true }).click();
  expect((await accepted).status()).toBe(200);
  await expect(deleteRecovery(page)).toHaveCount(0);
  expect(writes).toBe(2);
  expect((await records(page, data.patientId)).some(item => item.id === data.therapyId)).toBe(false);
});

test('unreadable therapy note blocks renewed deletion after a conflict', async ({ page }) => {
  const data = await fixture(page);
  await openTherapies(page, data);
  expect(await page.evaluate(async id => {
    const response = await fetch(`/api/therapies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, motivation: 'ENC:malformed' }) });
    return response.status;
  }, data.therapyId)).toBe(200);
  let writes = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && request.url().endsWith(`/api/therapies/${data.therapyId}`)) writes++; });
  await requestDeletion(page);
  await expect(deleteRecovery(page)).toContainText('Eliminazione rifiutata');
  await deleteRecovery(page).getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
  await expect(deleteRecovery(page)).toContainText('dati non leggibili');
  await expect(deleteRecovery(page)).toContainText(deletionReason);
  await expect(reviewedDelete(page)).toHaveCount(0);
  expect(writes).toBe(1);
});

// A deterministic response barrier, not a claim about a real transport race.
// Fetch first so the server outcome is known, then hold delivery across a real
// React context transition. Session lock may abort the browser request instead.
async function holdTherapyResponse(page: Page, patientId: string, therapyId: string, method: 'GET' | 'DELETE') {
  // Passive observers return the native promises and preserve receivers/results.
  // Observe both reread branches; the parent may finish after the held list.
  // Crypto tracking conservatively includes work in the replacement context.
  // Fixture therapy fields are plaintext; no decryption delay is injected.
  await page.evaluate(({ patientId, therapyId, method }) => {
    const nativeFetch = window.fetch;
    const nativeDecrypt = crypto.subtle.decrypt;
    const decryptDescriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'decrypt');
    const requests: Record<string, { seen: boolean; settled: boolean; rejected: boolean; jsonCalls: number; jsonSettled: number }> = {};
    for (const name of method === 'GET' ? ['list', 'parent'] : ['delete']) {
      requests[name] = { seen: false, settled: false, rejected: false, jsonCalls: 0, jsonSettled: 0 };
    }
    const state = { requests, pending: 0, activity: 0, decryptCalls: 0, restore: () => {} };
    const restoreResponses: Array<() => void> = [];
    const observe = <T,>(promise: Promise<T>, completed?: () => void) => {
      state.pending++;
      state.activity++;
      const finish = () => { state.pending--; state.activity++; completed?.(); };
      void promise.then(finish, finish);
      return promise;
    };
    const trackedDecrypt: SubtleCrypto['decrypt'] = function (this: SubtleCrypto, ...args: Parameters<SubtleCrypto['decrypt']>) {
      state.decryptCalls++;
      return observe(Reflect.apply(nativeDecrypt, this, args) as Promise<ArrayBuffer>);
    };
    const trackedFetch: typeof fetch = function (this: Window, input, init) {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const requestMethod = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const name = method === 'GET' && requestMethod === 'GET'
        ? url.pathname === '/api/therapies' && url.searchParams.get('patientId') === patientId ? 'list'
          : url.pathname === `/api/patients/${patientId}` ? 'parent' : undefined
        : method === 'DELETE' && requestMethod === 'DELETE' && url.pathname === `/api/therapies/${therapyId}` ? 'delete' : undefined;
      const promise = Reflect.apply(nativeFetch, this, [input, init]) as Promise<Response>;
      if (name && !requests[name].seen) {
        const request = requests[name];
        request.seen = true;
        state.activity++;
        // Register before the caller's await continuation, while returning its
        // original fetch promise. Wrap json only on this observed Response.
        void promise.then(response => {
          request.settled = true;
          state.activity++;
          const nativeJson = response.json;
          const descriptor = Object.getOwnPropertyDescriptor(response, 'json');
          response.json = function (this: Response) {
            request.jsonCalls++;
            return observe(Reflect.apply(nativeJson, this, []) as Promise<unknown>, () => { request.jsonSettled++; });
          };
          restoreResponses.push(() => {
            if (descriptor) Object.defineProperty(response, 'json', descriptor);
            else Reflect.deleteProperty(response, 'json');
          });
        }, () => { request.settled = true; request.rejected = true; state.activity++; });
      }
      return promise;
    };
    window.fetch = trackedFetch;
    crypto.subtle.decrypt = trackedDecrypt;
    state.restore = () => {
      if (window.fetch === trackedFetch) window.fetch = nativeFetch;
      if (crypto.subtle.decrypt === trackedDecrypt) {
        if (decryptDescriptor) Object.defineProperty(crypto.subtle, 'decrypt', decryptDescriptor);
        else Reflect.deleteProperty(crypto.subtle, 'decrypt');
      }
      for (const restore of restoreResponses) restore();
      Reflect.deleteProperty(window, '__therapyLifecycleCompletion');
    };
    Reflect.set(window, '__therapyLifecycleCompletion', state);
  }, { patientId, therapyId, method });
  const matches = (url: URL) => method === 'GET'
    ? url.pathname === '/api/therapies' && url.searchParams.get('patientId') === patientId
    : url.pathname === `/api/therapies/${therapyId}`;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let taken = false;
  let entered = false;
  let settled = false;
  let terminal = false;
  let heldRequest: ReturnType<Route['request']> | undefined;
  let status: number | undefined;
  const errors: unknown[] = [];
  const completed = (request: ReturnType<Route['request']>) => { if (request === heldRequest) terminal = true; };
  page.on('requestfinished', completed);
  page.on('requestfailed', completed);
  const handler = async (route: Route) => {
    if (taken || route.request().method() !== method) return route.continue();
    taken = true;
    heldRequest = route.request();
    try {
      const response = await route.fetch();
      status = response.status();
      entered = true;
      await gate;
      if (!route.request().failure()) await route.fulfill({ response });
    } catch (error) {
      // Only a browser-observed cancellation is allowed to retire delivery.
      if (!route.request().failure()) errors.push(error);
    } finally {
      settled = true;
    }
  };
  await page.route(matches, handler);
  return {
    async wait() {
      await expect.poll(() => entered || settled, 'authoritative response reached the delay barrier').toBe(true);
      expect(errors).toEqual([]);
      expect(status).toBe(200);
      expect(entered).toBe(true);
    },
    async finish(allowAbortedRead = false) {
      release();
      try {
        if (taken) {
          await expect.poll(() => settled, 'held route handler completed').toBe(true);
          await expect.poll(() => terminal, 'held browser request finished or was cancelled').toBe(true);
          await expect.poll(() => page.evaluate(async ({ requireJson }) => {
            const state = Reflect.get(window, '__therapyLifecycleCompletion') as {
              requests: Record<string, { seen: boolean; settled: boolean; jsonCalls: number; jsonSettled: number }>;
              pending: number; activity: number;
            };
            const complete = () => state.pending === 0 && Object.values(state.requests).every(request =>
              request.seen && request.settled && request.jsonCalls === request.jsonSettled && (!requireJson || request.jsonCalls > 0));
            if (!complete()) return false;
            const activity = state.activity;
            // A task drains preceding promise continuations, including chained
            // field decrypts; the frame lets resulting React work reach the DOM.
            await new Promise<void>(resolve => {
              const channel = new MessageChannel();
              channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
              channel.port2.postMessage(null);
            });
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            return complete() && state.activity === activity;
          }, { requireJson: method === 'GET' && !allowAbortedRead }), 'held fetch/body/decrypt continuations reached a stable task and frame').toBe(true);
        }
      } finally {
        await page.unroute(matches, handler);
        page.off('requestfinished', completed);
        page.off('requestfailed', completed);
        await page.evaluate(() => (Reflect.get(window, '__therapyLifecycleCompletion') as { restore: () => void } | undefined)?.restore());
      }
      expect(errors).toEqual([]);
    },
  };
}

async function leaveTherapyContext(page: Page, destination: 'patient' | 'unmount', other: Fixture) {
  const link = destination === 'patient'
    ? page.getByRole('navigation', { name: 'Cartelle aperte', exact: true }).locator(`a[href="/patients/${other.patientId}/modules"]`)
    : page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).getByRole('link', { name: 'Analisi', exact: true });
  await link.click();
  const discard = page.getByRole('dialog', { name: 'Lasciare la compilazione?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
  await expect(page).toHaveURL(destination === 'patient' ? new RegExp(`/patients/${other.patientId}/modules`) : /\/analytics$/);
  await expect(deleteRecovery(page)).toHaveCount(0);
}

for (const transition of ['patient', 'session', 'unmount'] as const) {
  for (const phase of ['reviewed recovery', 'pending reread', 'pending committed response'] as const) {
    test(`${transition} retires delete ${phase} without contaminating the next therapy context`, async ({ page }) => {
      const original = await fixture(page);
      const other = await fixture(page);
      // Register both record tabs through ordinary SPA navigation. A second
      // page.goto would reset the frame's in-memory list of opened records.
      await openTherapies(page, original);
      await page.getByRole('navigation', { name: 'Navigazione principale', exact: true })
        .getByRole('link', { name: 'Pazienti', exact: true }).click();
      await expect(page).toHaveURL(/area=incarico/);
      await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true })
        .fill(other.therapyId.replace(/^therapy-/, 'SYN'));
      // Search includes raw synthetic taxCode; the visible row masks that code.
      const otherRow = page.getByRole('listbox', { name: 'Elenco pazienti in carico', exact: true }).getByRole('option');
      await expect(otherRow).toHaveCount(1);
      await otherRow.click();
      await expect(page).toHaveURL(new RegExp(`/patients/${other.patientId}/modules`));
      const openRecords = page.getByRole('navigation', { name: 'Cartelle aperte', exact: true });
      await openRecords.locator(`a[href="/patients/${original.patientId}/modules"]`).click();
      await expect(page).toHaveURL(new RegExp(`/patients/${original.patientId}/modules`));
      await expect(openRecords.locator(`a[href="/patients/${other.patientId}/modules"]`)).toBeVisible();
      await openPatientSection(page, 'terapie');
      await expect(page.locator('#terapie').getByRole('heading', { name: 'Farmaco sintetico principale', exact: true })).toBeVisible();
      // The lifecycle transition must retain this document; a reload would
      // destroy callbacks and could falsely appear to prove controller fencing.
      const documentMarker = await page.evaluate(() => {
        const marker = crypto.randomUUID();
        Object.defineProperty(window, '__therapyLifecycleDocument', { value: marker });
        return marker;
      });
      const beforeOriginal = await records(page, original.patientId);
      const beforeOther = await records(page, other.patientId);
      const writes: Array<{ id: string; version: number }> = [];
      page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'DELETE' && path.startsWith('/api/therapies/')) {
          writes.push({ id: path.split('/').pop()!, version: request.postDataJSON().version });
        }
      });
      let held: Awaited<ReturnType<typeof holdTherapyResponse>> | undefined;
      try {
        if (phase === 'pending committed response') {
          held = await holdTherapyResponse(page, original.patientId, original.therapyId, 'DELETE');
          await requestDeletion(page);
          await held.wait();
          await expect(deleteRecovery(page)).toContainText('Invio dell’eliminazione in corso');
        } else {
          // Explicit injected rejection before commit; no production failure assumed.
          const endpoint = `**/api/therapies/${original.therapyId}`;
          const reject = (route: Route) => route.request().method() === 'DELETE'
            ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Synthetic lifecycle rejection before commit"}' })
            : route.continue();
          await page.route(endpoint, reject);
          await requestDeletion(page);
          await expect(deleteRecovery(page)).toContainText('L’esito non è confermato');
          await page.unroute(endpoint, reject);
          if (phase === 'pending reread') held = await holdTherapyResponse(page, original.patientId, original.therapyId, 'GET');
          await deleteRecovery(page).getByRole('button', { name: 'Rileggi terapia', exact: true }).click();
          if (held) {
            await held.wait();
            await expect(deleteRecovery(page)).toContainText('Rilettura della cartella in corso');
          } else {
            await expect(reviewedDelete(page)).toBeVisible();
          }
        }
        expect(writes).toEqual([{ id: original.therapyId, version: 1 }]);

        if (transition === 'session') {
          const locked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/lock' && response.request().method() === 'POST');
          await page.getByRole('button', { name: 'Blocca', exact: true }).click();
          expect((await locked).status()).toBe(200);
          await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
          expect((await page.request.get(`/api/therapies?patientId=${original.patientId}`)).status()).toBe(401);
          await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
          await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
        } else {
          await leaveTherapyContext(page, transition, other);
        }
        // Release only after the old component/context has retired. The new
        // context exists before delivery; late state must not replace its state.
        if (transition === 'unmount') {
          await page.getByRole('navigation', { name: 'Cartelle aperte', exact: true })
            .locator(`a[href="/patients/${original.patientId}/modules"]`).click();
          await expect(page).toHaveURL(new RegExp(`/patients/${original.patientId}/modules`));
        }
        await openPatientSection(page, 'terapie');
        await expect(page.locator('#terapie').getByRole('heading', { name: 'Farmaco sintetico secondario', exact: true })).toBeVisible();
        await expect(deleteRecovery(page)).toHaveCount(0);
        // Establish a fresh prompt before releasing the old result. It must
        // retain an empty reason and remain cancellable without another DELETE.
        await page.getByRole('button', { name: 'Elimina Farmaco sintetico secondario solo se inserito per errore', exact: true }).click();
        const freshPrompt = page.getByRole('dialog', { name: 'Eliminare questo farmaco dalla cartella?', exact: true });
        await expect(freshPrompt.getByRole('textbox', { name: "Motivazione dell'eliminazione" })).toHaveValue('');
        if (held) {
          const pending = held;
          held = undefined;
          await pending.finish(transition === 'session');
        }
        expect(await page.evaluate(() => Reflect.get(window, '__therapyLifecycleDocument'))).toBe(documentMarker);
        // Authoritative reads after request completion also precede the final
        // UI observations, rather than asserting immediate absence at release.
        const afterOriginal = await records(page, original.patientId);
        const expectedOriginal = phase === 'pending committed response'
          ? beforeOriginal.filter(item => item.id !== original.therapyId) : beforeOriginal;
        expect(afterOriginal).toEqual(expectedOriginal);
        expect(await records(page, other.patientId)).toEqual(beforeOther);
        await expect(freshPrompt).toBeVisible();
        await expect(freshPrompt.getByRole('textbox', { name: "Motivazione dell'eliminazione" })).toHaveValue('');
        await expect(deleteRecovery(page)).toHaveCount(0);
        await freshPrompt.getByRole('button', { name: 'Annulla', exact: true }).click();
        await expect(freshPrompt).toHaveCount(0);
        await expect(deleteRecovery(page)).toHaveCount(0);
        expect(writes).toEqual([{ id: original.therapyId, version: 1 }]);
      } finally {
        if (held) await held.finish(transition === 'session');
      }
    });
  }
}
