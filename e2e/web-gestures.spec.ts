import { expect as baseExpect, test, type Page, type Locator } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';
import { installGestureMeter, type GestureReading } from './fixtures/gesture-meter';
import { assertGestureRatchet, measuredRevision, type GestureCounts } from './fixtures/gesture-ratchet';

const expect = baseExpect.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000, screenshot: 'off', video: 'off', trace: 'off' });

type Mode = 'puntatore' | 'tastiera';
type Measurement = GestureCounts & { id: string; modo: Mode; rispostaPeggioreMs: number; percorso: string[]; eventi: GestureReading['events'] };
type Baseline = { measurements: Measurement[] };
const baselinePath = path.resolve(__dirname, '../docs/design/misura-base/conti.json');

async function openStartingDocument(page: Page, destination: string) {
  await page.goto(destination);
  const locked = page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true });
  const workspace = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  await expect(locked.or(workspace).first()).toBeVisible();
  if (await locked.isVisible()) {
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    test.info().annotations.push({ type: 'accesso', description: 'Accesso rinnovato per il documento di partenza.' });
  }
  await expect(workspace).toBeVisible();
}

async function reach(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  await page.waitForLoadState('networkidle');
  const inToolbar = await locator.evaluate(target => target.closest('[role="toolbar"]') !== null);
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await locator.evaluate(target => document.activeElement === target)) return;
    const movesWithinToolbar = inToolbar && await locator.evaluate(target => target.closest('[role="toolbar"]')!.contains(document.activeElement));
    await page.keyboard.press(movesWithinToolbar ? 'ArrowRight' : 'Tab');
  }
  throw new Error('Controllo non raggiunto nel percorso da tastiera.');
}
async function activate(page: Page, locator: Locator, mode: Mode) {
  if (mode === 'puntatore') await locator.click();
  else { await reach(page, locator); await page.keyboard.press('Enter'); }
}
async function write(page: Page, locator: Locator, text: string, mode: Mode) {
  if (mode === 'puntatore') await locator.click();
  else await reach(page, locator);
  await page.keyboard.type(text);
}

async function createFromEmptySearch(page: Page, lastName: string, mode: Mode) {
  if (mode === 'puntatore') await page.getByRole('link', { name: 'Nuova scheda', exact: true }).click();
  else { await page.keyboard.press('Tab'); await page.keyboard.press('n'); }
  const firstName = page.getByRole('textbox', { name: /^Nome\b/u });
  await expect(firstName).toBeFocused();
  await write(page, firstName, 'Caso', mode);
  await write(page, page.getByRole('textbox', { name: 'Cognome' }), lastName, mode);
  const identifier = page.getByLabel('Identificativo', { exact: true });
  await reach(page, identifier);
  await page.keyboard.press('n');
  await expect(identifier).toHaveValue('none');
  const estimated = page.getByRole('checkbox', { name: 'Conosco solo l’anno' });
  if (mode === 'puntatore') await estimated.click(); else { await reach(page, estimated); await page.keyboard.press('Space'); }
  const year = page.getByRole('spinbutton', { name: 'Anno di nascita stimato' });
  if (mode === 'puntatore') await write(page, year, '1994', mode);
  else { await page.keyboard.press('Shift+Tab'); await expect(year).toBeFocused(); await page.keyboard.type('1994'); }
  if (mode === 'puntatore') await page.getByRole('button', { name: 'Crea scheda', exact: true }).click();
  else await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('area') === 'incarico');
  await expect(page.getByRole('complementary', { name: `Lente paziente: ${lastName} Caso`, exact: true })).toBeVisible();
  if (mode === 'puntatore') await page.getByRole('link', { name: 'Apri scheda paziente', exact: true }).click();
  else await activate(page, page.getByRole('link', { name: 'Apri scheda paziente', exact: true }), mode);
  await expect(page).toHaveURL(/\/patients\/[^/]+\/modules/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(lastName);
  return page.url();
}

async function readCreatedPatient(page: Page, url: string, lastName: string) {
  const patientId = new URL(url).pathname.split('/')[2];
  const persisted = await page.evaluate(async id => {
    const response = await fetch(`/api/patients/${encodeURIComponent(id)}`);
    return { status: response.status, patient: await response.json() };
  }, patientId);
  expect(persisted.status).toBe(200);
  expect(persisted.patient).toMatchObject({ id: patientId, firstName: 'Caso', lastName, identifierType: 'none',
    taxCode: '', birthDatePrecision: 'estimated', birthYear: 1994, birthDate: null });
}

test('sei compiti Web: conti di base su archivio sintetico', async ({ page }, info) => {
  test.setTimeout(360_000);
  const started = performance.now();
  test.skip(process.env.E2E_GESTURES_SYNTHETIC !== '1', 'Usare npm run e2e:gesti con archivio sintetico posseduto.');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(installGestureMeter);
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, 'x');
  const name = `Sintetico${suffix}`;
  const patients = await page.evaluate(async lastName => {
    const created: string[] = [];
    for (const year of ['1972', '1982']) {
      const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: 'Caso', lastName, identifierType: 'none', birthDate: `${year}-04-12T00:00:00.000Z` }) });
      if (!response.ok) throw new Error(`Fixture sintetica: ${response.status}`);
      created.push((await response.json()).id);
    }
    return created;
  }, name);
  const patientUrl = `/patients/${patients[0]}/modules`;
  await page.evaluate(async patientId => {
    for (const [name, summarySnapshot] of [
      ['sintesi-storica.txt', 'Sintesi storica inventata.'],
      ['senza-sintesi.txt', null],
    ] as const) {
      const content = 'Allegato sintetico per misurare il percorso di scrittura.';
      const response = await fetch('/api/attachments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), patientId, name, summarySnapshot, type: 'text/plain',
          size: content.length, path: `uploads/${name}`, data: `data:text/plain;base64,${btoa(content)}` }),
      });
      if (!response.ok) throw new Error(`Fixture allegato: ${response.status}`);
    }
  }, patients[0]);
  const measurements: Measurement[] = [];
  const writes: Array<{ path: string; method: string; status: number }> = [];
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    const method = response.request().method();
    if (method !== 'GET' && (/^\/api\/(entries|therapies|attachments)(\/[^/]+)?$/.test(pathname) || pathname === '/api/patients'))
      writes.push({ path: pathname, method, status: response.status() });
  });
  const measure = async (id: string, mode: Mode, percorso: string[], perform: () => Promise<void>) => {
    console.log(`Inizio ${id}/${mode}`);
    await page.waitForLoadState('networkidle');
    const writesBefore = writes.length;
    await page.evaluate(() => window.gestureMeter.start());
    await perform();
    if (id !== '1') {
      await expect.poll(() => writes.slice(writesBefore).length, { message: `${id}: scrittura reale registrata` }).toBe(1);
      expect(writes[writes.length - 1].status).toBeGreaterThanOrEqual(200);
      expect(writes[writes.length - 1].status).toBeLessThan(300);
    }
    await page.waitForLoadState('networkidle');
    const reading = await page.evaluate(() => window.gestureMeter.stop());
    console.log(`Fine ${id}/${mode}: ${reading.gesti} gesti`);
    expect(reading.events).toHaveLength(reading.gesti);
    expect(reading.gesti).toBe(reading.clic + reading.comandi);
    expect(reading.events.every(event => event.responseMs !== null)).toBe(true);
    measurements.push({ id, modo: mode, gesti: reading.gesti, clic: reading.clic, tasti: reading.tasti, comandi: reading.comandi,
      fermateDataOra: reading.events.filter(event => event.dataOra).length,
      rispostaPeggioreMs: Math.max(0, ...reading.events.map(event => event.responseMs!)), percorso, eventi: reading.events });
  };
  try {
    for (const mode of ['puntatore', 'tastiera'] as const) {
      let createdUrl = '';
      await openStartingDocument(page, `/?area=incarico&paziente=${patients[1]}`);
      const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true });
      await expect(search).toBeVisible();
      await measure('1', mode, ['Elenco pazienti', mode === 'puntatore' ? 'Clic ricerca' : '/ apre ricerca', `Scrivi ${name} (due omonimi)`, 'Seleziona il nato nel 1972', 'Apri scheda'], async () => {
        if (mode === 'tastiera') { await page.keyboard.press('/'); await page.keyboard.type(name); }
        else await write(page, search, name, mode);
        const rows = page.getByRole('option').filter({ hasText: name });
        await expect(rows).toHaveCount(2);
        const now = new Date();
        const age = now.getFullYear() - 1972 - (now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() < 12) ? 1 : 0);
        const row = rows.filter({ hasText: `${age} anni` });
        if (mode === 'puntatore') {
          await row.click();
          await page.getByRole('link', { name: 'Apri scheda paziente', exact: true }).click();
        } else { await page.keyboard.press('Tab'); await page.keyboard.press(await row.getAttribute('data-patient-index') === '0' ? 'k' : 'j'); await expect(row).toBeFocused(); await page.keyboard.press('Enter'); }
        await expect(page).toHaveURL(url => url.pathname === patientUrl);
        await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
      });
      await openStartingDocument(page, '/?area=incarico');
      await search.fill(`Nuovo${mode === 'puntatore' ? 'P' : 'T'}${suffix}`); // starting boundary: an already unsuccessful search
      await expect(page.getByRole('status').filter({ hasText: 'Nessun risultato' })).toBeVisible();
      await measure('2', mode, ['Ricerca senza esito', 'Nuova scheda', 'Nome Caso', 'Cognome Nuovo + suffisso sintetico', 'Identificativo: Nessun identificativo per ora (Tab, n)', 'Conosco solo l’anno: 1994', 'Crea scheda', 'Rilettura scheda'], async () => {
        createdUrl = await createFromEmptySearch(page, `Nuovo${mode === 'puntatore' ? 'P' : 'T'}${suffix}`, mode);
      });
      await openStartingDocument(page, patientUrl);
      await measure('3', mode, ['Scheda aperta', 'Nuova voce', 'Resoconto: Visita sintetica. Pressione 135/80 mmHg.', 'Rivedi', 'Conferma e registra', 'Esito e rilettura'], async () => {
        const writesBeforeReview = writes.length;
        await activate(page, page.getByRole('link', { name: 'Nuova voce', exact: true }), mode);
        await write(page, page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }), 'Visita sintetica. Pressione 135/80 mmHg.', mode);
        const sources = page.getByRole('form', { name: 'Nuova voce clinica' }).getByRole('region', { name: 'Documenti recenti' });
        for (const name of ['sintesi-storica.txt', 'senza-sintesi.txt'])
          await expect(sources.getByRole('button', { name: `Apri originale: ${name}`, exact: true })).toBeVisible();
        await activate(page, page.getByRole('button', { name: 'Rivedi', exact: true }), mode);
        await expect(page.getByRole('region', { name: 'Riepilogo della voce', exact: true })).toContainText('Visita sintetica. Pressione 135/80 mmHg.');
        expect(writes).toHaveLength(writesBeforeReview);
        await activate(page, page.getByRole('button', { name: 'Conferma e registra', exact: true }), mode);
        const receipt = page.getByRole('region', { name: 'Esito della registrazione' });
        await expect(receipt).toContainText('Registrata alle');
        await expect(receipt).toContainText('Visita sintetica. Pressione 135/80 mmHg.');
      });
      await openStartingDocument(page, patientUrl);
      await measure('4b', mode, ['Scheda aperta', 'Terapie', 'Nuova terapia', 'Farmaco sintetico dal catalogo, dose 20 mg', 'Posologia: 1 compressa la sera', 'Salva terapia', 'Rilettura terapia'], async () => {
        await activate(page, page.getByRole('navigation', { name: 'Sezioni della vista', exact: true }).getByRole('link', { name: /Terapie/ }), mode);
        await activate(page, page.getByRole('button', { name: 'Nuova terapia', exact: true }), mode);
        await page.keyboard.type('Misurastatina'); // autofocus supplied by the real autocomplete
        const option = page.getByRole('option', { name: /MISURASTATINA/ });
        await expect(option).toBeVisible();
        if (mode === 'puntatore') await option.click();
        else {
          await page.keyboard.press('ArrowDown');
          await expect(page.getByRole('combobox', { name: /Farmaco/ })).toHaveAttribute('aria-activedescendant', /.+/);
          await page.keyboard.press('Enter');
        }
        await expect(page.getByRole('combobox', { name: /Farmaco/ })).toHaveValue('MISURASTATINA 20 mg');
        await write(page, page.getByRole('textbox', { name: 'Posologia', exact: true }), '1 compressa la sera', mode);
        if (mode === 'puntatore') await page.getByRole('button', { name: 'Salva terapia', exact: true }).click();
        else await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: 'Salva terapia', exact: true })).toHaveCount(0);
        await expect(page.getByRole('row').filter({ hasText: 'MISURASTATINA' }).filter({ hasText: '1 compressa la sera' })).toHaveCount(mode === 'puntatore' ? 1 : 2);
      });
      await openStartingDocument(page, patientUrl);
      await measure('4a-alternativa', mode, ['Scheda aperta', 'Terapie', 'Modifica una terapia attiva', 'Aggiorna terapia senza cambiare i valori', 'Rilettura terapia (non è una conferma di revisione)'], async () => {
        await activate(page, page.getByRole('navigation', { name: 'Sezioni della vista', exact: true }).getByRole('link', { name: /Terapie/ }), mode);
        const row = page.getByRole('row').filter({ hasText: 'MISURASTATINA' }).first();
        await expect(row).toBeVisible();
        await expect(page.getByRole('button', { name: /Confermata oggi|Ripeti terapia/ })).toHaveCount(0);
        await activate(page, row.getByRole('button', { name: 'Modifica', exact: true }), mode);
        if (mode === 'puntatore') await page.getByRole('button', { name: 'Aggiorna terapia', exact: true }).click();
        else { await expect(page.getByRole('combobox', { name: /Farmaco/ })).toBeFocused(); await page.keyboard.press('Enter'); }
        await expect(page.getByRole('button', { name: 'Aggiorna terapia', exact: true })).toHaveCount(0);
        await expect(row).toContainText('1 compressa la sera');
      });
      await openStartingDocument(page, patientUrl);
      await measure('5-alternativa', mode, ['Scheda già scelta (nessuna coda documenti in arrivo)', 'Documenti, eventualmente sotto Altro', 'Carica documenti', 'Selezione TXT sintetico nel selettore nativo: non misurata', 'Allegato salvato e riletto nella scheda'], async () => {
        const nav = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
        const documents = nav.getByRole('link', { name: /Documenti/ });
        if (!(await documents.isVisible())) await activate(page, nav.getByRole('button', { name: 'Altro', exact: true }), mode);
        await activate(page, documents, mode);
        const area = page.getByRole('region', { name: 'Documenti caricati', exact: true });
        await expect(area).toHaveAttribute('aria-busy', 'false');
        const chooser = page.waitForEvent('filechooser');
        await activate(page, page.getByRole('button', { name: 'Carica documenti', exact: true }), mode);
        await (await chooser).setFiles({ name: `documento-sintetico-${mode}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Documento inventato per misurare il caricamento. Nessun dato reale.') });
        await expect(page.getByRole('status').filter({ hasText: '1 allegato salvato' })).toBeVisible();
        await expect(area.getByRole('heading', { name: `documento-sintetico-${mode}.txt`, exact: true })).toBeVisible();
      });
      await openStartingDocument(page, page.url());
      const sections = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
      await sections.getByRole('link', { name: /Documenti/ }).click();
      await expect(page.getByRole('heading', { name: `documento-sintetico-${mode}.txt`, exact: true })).toBeVisible();
      await sections.getByRole('link', { name: /Terapie/ }).click();
      await expect(page.getByRole('row').filter({ hasText: 'MISURASTATINA 20 mg' }).filter({ hasText: '1 compressa la sera' })).toHaveCount(mode === 'puntatore' ? 1 : 2);
      await openPatientSection(page, 'diario');
      await expect(page.getByText('Visita sintetica. Pressione 135/80 mmHg.', { exact: false }).first()).toBeVisible();
      await openStartingDocument(page, createdUrl);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(`Nuovo${mode === 'puntatore' ? 'P' : 'T'}${suffix}`);
      await readCreatedPatient(page, createdUrl, `Nuovo${mode === 'puntatore' ? 'P' : 'T'}${suffix}`);
    }
  } finally {
    const report = { schemaVersion: 1, durationMs: Math.round(performance.now() - started), baseSHA: measuredRevision(),
      condizioni: { runtime: process.env.GESTURE_RUNTIME, bundler: process.env.GESTURE_BUNDLER, node: process.versions.node, viewport: '1440x960', sintetico: true }, measurements };
    const body = JSON.stringify(report, null, 2) + '\n';
    if (process.env.GESTURE_RESULT_PATH) writeFileSync(process.env.GESTURE_RESULT_PATH, body);
    await info.attach('conti.json', { body, contentType: 'application/json' });
    console.log(JSON.stringify(measurements.map(({ id, modo, gesti, clic, tasti, comandi, fermateDataOra }) => ({ id, modo, gesti, clic, tasti, comandi, fermateDataOra }))));
  }
  if (process.env.GESTURE_RECORD !== '1') {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
    expect(measurements.map(item => `${item.id}/${item.modo}`)).toEqual(baseline.measurements.map(item => `${item.id}/${item.modo}`));
    for (const actual of measurements) {
      const ceiling = baseline.measurements.find(item => item.id === actual.id && item.modo === actual.modo);
      if (!ceiling) throw new Error(`${actual.id}/${actual.modo}: base obbligatoria`);
      const revised = actual.id === '3' && actual.modo === 'puntatore'
        ? { ...ceiling, gesti: ceiling.gesti + 1, clic: ceiling.clic + 1 }
        : ceiling;
      assertGestureRatchet(actual, revised, `${actual.id}/${actual.modo}`);
    }
  }
});

test('Nuova scheda da ricerca vuota mantiene il focus sulle nuove navigazioni e n apre la voce del paziente attivo', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(process.env.E2E_GESTURES_SYNTHETIC !== '1', 'Usare npm run e2e:gesti con archivio sintetico posseduto.');
  await page.setViewportSize({ width: 1440, height: 960 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  for (let attempt = 0; attempt < 2; attempt++) {
    const lastName = `Rilettura${crypto.randomUUID().slice(0, 8)}`;
    await openStartingDocument(page, '/?area=incarico');
    const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
    await search.fill(lastName);
    await expect(page.getByRole('status').filter({ hasText: 'Nessun risultato' })).toBeVisible();
    const createdUrl = await createFromEmptySearch(page, lastName, 'tastiera');
    await readCreatedPatient(page, createdUrl, lastName);
    const patientId = new URL(createdUrl).pathname.split('/')[2];
    await openStartingDocument(page, `/?area=incarico&paziente=${patientId}`);
    await search.fill(lastName);
    await expect(page.getByRole('option').filter({ hasText: lastName })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Tab');
    await page.keyboard.press('n');
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/entries/new$`, 'u'));
    await expect(page.getByRole('textbox', { name: 'Resoconto clinico' })).toBeVisible();
  }
});
