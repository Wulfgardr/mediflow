import { expect, test, type Page } from '@playwright/test';
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
    return response.json() as Promise<Array<{ id: string; patientId: string; version: number; dosage: string; status: string }>>;
  }, patientId);
}

for (const width of [1440, 390]) {
  test(`409 recovery preserves draft and reads suspended therapy after reload at ${width}px`, async ({ page }) => {
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
    expect(stored).toMatchObject({ patientId: data.patientId, version: 3, dosage: 'Dose della bozza sintetica', status: 'suspended' });
    await expect(save(page)).toBeHidden();

    // Read the supported suspended card in a fresh authenticated document.
    // This card does not expose the note, so this does not qualify note readback.
    await page.reload();
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    await openPatientSection(page, 'terapie');
    const suspendedCard = page.locator('#terapie').getByText('Farmaco sintetico principale', { exact: true })
      .locator('..').locator('..').locator('..');
    await expect(suspendedCard.getByText('Sospesa', { exact: true })).toBeVisible();
    await expect(suspendedCard.getByText('Dose della bozza sintetica', { exact: true })).toBeVisible();
    await expect(suspendedCard.getByRole('button', { name: 'Riprendi', exact: true })).toBeVisible();
    const reloaded = (await records(page, data.patientId)).find(item => item.id === data.therapyId);
    expect(reloaded).toMatchObject({ patientId: data.patientId, version: 3, dosage: 'Dose della bozza sintetica', status: 'suspended' });
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
