import { test, expect, type Page, type TestInfo, type Locator } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { randomInt, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { bootstrapUnlockedSession, openPatientSection } from '../e2e/utils';
import { isValidItalianTaxCodeChecksum } from '../lib/domain/documents/document-identity-resolution';

const directory = process.env.VISUAL_091_OUTPUT!;
async function capture(page: Page, info: TestInfo, name: string, target?: Locator) {
  await test.step(`Schermata ${name}`, async () => {
    if (target) await target.scrollIntoViewIfNeeded();
    const folder = path.join(directory, info.project.name, info.title.replaceAll(/[^a-z0-9-]/gi, '-'));
    mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: path.join(folder, `${name}.png`), fullPage: true, animations: 'disabled' });
    if (info.project.use.viewport?.width === 390) {
      const measures = await page.evaluate(() => [...new Set([document.documentElement, document.body,
        ...document.querySelectorAll('main, [role="main"], main section, [role="dialog"]')])]
        .filter(el => el.clientWidth > 0).map(el => ({ element: el.id || el.getAttribute('data-testid') || el.tagName,
          scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })));
      await info.attach(`overflow-${name}`, { body: JSON.stringify(measures), contentType: 'application/json' });
      for (const measure of measures) expect.soft(measure.scrollWidth, `${name}: overflow ${measure.element}`).toBeLessThanOrEqual(measure.clientWidth);
    }
  });
}
async function active(page: Page, target: Locator, step: string) {
  await test.step(`Tastiera ${step}`, async () => {
    await expect(target, `${step}: elemento attivo`).toBeFocused();
    const style = await target.evaluate(el => {
      const css = getComputedStyle(el);
      return { outline: css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0 && css.outlineColor !== 'rgba(0, 0, 0, 0)', shadow: css.boxShadow !== 'none' };
    });
    expect.soft(style.outline || style.shadow, `${step}: indicatore di focus visibile`).toBe(true);
  });
}
async function tabTo(page: Page, target: Locator, step: string, backwards = false) {
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    if (await target.evaluate(el => el === document.activeElement)) { await active(page, target, step); await capture(page, test.info(), `tastiera-${step.replaceAll(/[^a-z0-9]/gi, '-')}`); return; }
  }
  throw new Error(`${step}: focus perso, controllo non raggiunto con Tab`);
}
async function patient(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Persona', lastName: 'Sintetica', taxCode: `SYN${crypto.randomUUID().replaceAll('-', '').slice(0, 13)}`, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
    if (!response.ok) throw new Error(`Fixture paziente: ${response.status}`);
    return (await response.json()).id as string;
  });
}

test.beforeEach(async ({ page }) => {
  if (!process.env.MEDIFLOW_DATA_DIR || !directory) throw new Error('Usare npm run qualify:visual-091');
  await page.route('**/api/siss/session-status', route => route.fulfill({ json: { sessionHealth: 'none', lastModule: null, lastModuleAt: null, checkpoints: [] } }));
  await bootstrapUnlockedSession(page, '1234');
  await expect(page.locator('html')).toHaveClass(new RegExp(test.info().project.name.startsWith('giorno') ? 'light' : 'dark'));
});

test('01-assetti-territoriali', async ({ page }, info) => {
  const id = await patient(page);
  for (const preset of ['core', 'core+it', 'core+it+lom']) {
    await page.goto('/settings/profilo');
    await page.getByRole('button', { name: 'Personalizzazione territoriale', exact: true }).click();
    const radio = page.locator(`input[name="territorial-preset"][value="${preset}"]`);
    await radio.check();
    const apply = page.getByRole('button', { name: 'Applica assetto', exact: true });
    if (await apply.isEnabled()) {
      await apply.click(); await page.getByRole('dialog').getByRole('button', { name: 'Cambia assetto', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Assetto attivo:' })).toBeVisible();
    }
    expect(await (await page.request.get('/api/system/territorial-packs')).json()).toMatchObject({ preset });
    await capture(page, info, `${preset.replaceAll('+', '-')}-applicato`);
    await page.goto(`/patients/${id}/modules`);
    if (preset.endsWith('lom')) {
      await openPatientSection(page, 'siss');
      await expect(page.getByRole('button', { name: 'Apri Prescrittivo Regionale (PRREG), fuori da MediFlow', exact: true })).toBeVisible();
    } else {
      await expect(page.locator('#siss')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Apri Prescrittivo Regionale/ })).toHaveCount(0);
    }
    await capture(page, info, `${preset.replaceAll('+', '-')}-superfici`);
  }
});

async function catalog(page: Page, info: TestInfo, keyboard: boolean) {
  await page.goto('/settings/repertori');
  const panel = page.getByRole('region', { name: 'Catalogo farmaci di un’altra agenzia', exact: true });
  const open = panel.getByRole('button', { name: /Farmaci da un’altra agenzia/ });
  const go = async (target: Locator, name: string) => {
    if (keyboard) { await tabTo(page, target, name); await page.keyboard.press('Enter'); }
    else await target.click();
  };
  if (keyboard) {
    // Predisposizione dei dati di input; il percorso qualificato parte dal pannello aperto.
    await open.click();
    for (const [label, value] of [['Agenzia o ente', 'Agenzia sintetica'], ['Codifica dei farmaci', 'SYN'], ['Versione', 'fixture-091'], ['Data del catalogo', '2026-11-01']]) await panel.getByLabel(label, { exact: true }).fill(value);
    await open.click();
  }
  await go(open, 'apri-import');
  for (const [label, value] of [['Agenzia o ente', 'Agenzia sintetica'], ['Codifica dei farmaci', 'SYN'], ['Versione', 'fixture-091']]) {
    const field = panel.getByLabel(label, { exact: true });
    if (keyboard) { await tabTo(page, field, label); await expect(field).toHaveValue(value); }
    else await field.fill(value);
  }
  const date = panel.getByLabel('Data del catalogo', { exact: true });
  // Date input and OS file dialog are fixture boundaries, not simulated keyboard claims.
  if (keyboard) await tabTo(page, date, 'data-catalogo'); else await date.fill('2026-11-01');
  const file = panel.getByLabel('File del catalogo (.csv, UTF-8)', { exact: true });
  if (keyboard) await tabTo(page, file, 'file-catalogo');
  await file.setInputFiles({ name: 'catalogo-sintetico.csv', mimeType: 'text/csv', buffer: Buffer.from('codice,denominazione,principio_attivo\nSYN091,Farmaco sintetico,Principio sintetico\n') });
  await expect(panel.getByRole('group', { name: 'Associazione delle colonne' })).toBeVisible();
  await capture(page, info, 'mappatura', panel.getByRole('group', { name: 'Associazione delle colonne' }));
  if (keyboard) {
    const labels = ['Separatore', 'Codice', 'Denominazione', 'Principio attivo', 'ATC', 'Forma farmaceutica', 'Confezione', 'Classe di rimborsabilità', 'Titolare'];
    for (const [index, label] of labels.entries()) await tabTo(page, panel.getByRole('combobox').nth(index), `mappatura-${label}`);
  }
  await go(panel.getByRole('button', { name: 'Genera anteprima', exact: true }), 'genera-anteprima');
  await expect(panel.getByLabel('Anteprima catalogo farmaci')).toContainText('1 voce importabile');
  const confirm = panel.getByRole('button', { name: 'Importa catalogo', exact: true });
  await expect(confirm).toBeDisabled();
  await capture(page, info, 'anteprima', panel.getByLabel('Anteprima catalogo farmaci'));
  const check = panel.getByRole('checkbox');
  if (keyboard) { await tabTo(page, check, 'accetta-anteprima'); await page.keyboard.press('Space'); }
  else await check.check();
  await expect(confirm).toBeEnabled();
  await go(confirm, 'conferma-import');
  await expect(panel.getByRole('status')).toContainText('Catalogo attivo: Agenzia sintetica, SYN fixture-091, 1 voce.');
  const db = new Database(path.join(process.env.MEDIFLOW_DATA_DIR!, 'medical.db'), { readonly: true });
  try {
    expect(db.prepare('SELECT aic,name FROM drugs').all()).toEqual([{ aic: 'SYN091', name: 'Farmaco sintetico' }]);
    expect(JSON.parse((db.prepare("SELECT value FROM settings WHERE key='drugCatalogSource'").get() as { value: string }).value)).toMatchObject({ agency: 'Agenzia sintetica', codeSystem: 'SYN' });
  } finally { db.close(); }
  await capture(page, info, 'catalogo-attivo', panel.getByRole('status'));
}
test('02-import-catalogo', async ({ page }, info) => catalog(page, info, false));

test('03-scheda-affollata', async ({ page }, info) => {
  const id = await patient(page);
  const db = new Database(path.join(process.env.MEDIFLOW_DATA_DIR!, 'medical.db'));
  try {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 1; i <= 15; i++) db.prepare('INSERT INTO therapies(id,patient_id,drug_name,dosage,status,start_date) VALUES (?,?,?,?,?,?)').run(`${id}-t${i}`, id, `Terapia sintetica ${i}`, '1 compressa al giorno', 'active', now);
    for (let i = 1; i <= 20; i++) db.prepare('INSERT INTO entries(id,patient_id,type,date,content) VALUES (?,?,?,?,?)').run(`${id}-v${i}`, id, 'visit', now - i * 86400, `Visita sintetica ${i}`);
    for (let i = 1; i <= 30; i++) db.prepare('INSERT INTO attachments(id,patient_id,name,type,size,path,data,document_source_ref,document_revision,document_freshness_epoch) VALUES (?,?,?,?,?,?,?,?,?,?)').run(`${id}-d${i}`, id, `Documento sintetico ${i}.txt`, 'text/plain', 9, '', Buffer.from('Sintetico').toString('base64'), createHash('sha256').update(`${id}-source${i}`).digest('hex'), 1, 1);
    for (const [table, count] of [['therapies', 15], ['entries', 20], ['attachments', 30]] as const) expect(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE patient_id=?`).get(id)).toEqual({ n: count });
  } finally { db.close(); }
  await page.goto(`/patients/${id}/modules`);
  await expect(page.getByText('Sintetica Persona', { exact: true }).first()).toBeVisible();
  await capture(page, info, 'scheda');
  for (const section of ['terapie', 'documenti', 'diario']) {
    await openPatientSection(page, section);
    await expect(page.locator(`#${section}`)).toContainText(section === 'terapie' ? 'Terapia sintetica' : section === 'documenti' ? 'Documento sintetico' : 'Visita sintetica');
    await capture(page, info, section);
  }
});

test('04-C6-PDF-nuova-scheda', async ({ page }, info) => {
  const surname = `Bianchi${info.project.name.startsWith('giorno') ? 'giorno' : 'grafite'}${info.project.use.viewport?.width === 390 ? 'mobile' : 'desktop'}`;
  const root = mkdtempSync(path.join(tmpdir(), 'mediflow-visual-pdf-'));
  try {
    const folder = path.join(root, 'Nuovo'); mkdirSync(folder);
    const db = new Database(path.join(process.env.MEDIFLOW_DATA_DIR!, 'medical.db'), { readonly: true });
    let cf: string;
    try {
      do {
        const prefix = `RSSMRA${String(randomInt(100)).padStart(2, '0')}A${String(randomInt(1, 29)).padStart(2, '0')}Z${String(randomInt(1000)).padStart(3, '0')}`;
        cf = prefix + [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(letter => isValidItalianTaxCodeChecksum(prefix + letter));
      } while (db.prepare('SELECT id FROM patients WHERE tax_code=?').get(cf));
    } finally { db.close(); }
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const sheet = pdf.addPage([595, 842]);
    ['Referto sintetico per una nuova scheda', `Cognome: ${surname}`, 'Nome: Anna', `Codice fiscale paziente: ${cf}`, 'Data referto: 05/05/2025', 'Diagnosi: asma bronchiale']
      .forEach((line, i) => sheet.drawText(line, { x: 40, y: 800 - i * 40, size: 11, font }));
    writeFileSync(path.join(folder, 'nuovo-sintetico.pdf'), await pdf.save());
    await page.goto('/patients/new'); await page.getByRole('link', { name: 'Importa documenti da cartella' }).click();
    await capture(page, info, 'cartella');
    await page.getByTestId('dossier-folder').setInputFiles(root);
    const group = page.getByTestId('dossier-group');
    await expect(group).toHaveAttribute('data-identity', 'unmatched_cf', { timeout: 120_000 });
    await capture(page, info, 'identita-da-documento', group);
    await group.getByRole('button', { name: 'Crea la scheda da questo documento' }).click();
    const create = group.getByTestId('patient-document-create');
    await create.getByRole('button', { name: 'Avvia la revisione del documento' }).click();
    await expect(create.getByRole('heading', { name: 'Revisione dei dati' })).toBeVisible({ timeout: 60_000 });
    for (const field of ['codice fiscale', 'cognome', 'nome']) await create.getByRole('button', { name: `Usa per ${field}`, exact: true }).click();
    await expect(create.getByLabel('Codice fiscale', { exact: true })).toHaveValue(cf);
    await expect(create.getByLabel('Cognome', { exact: true })).toHaveValue(surname);
    await expect(create.getByLabel('Nome', { exact: true })).toHaveValue('Anna');
    await capture(page, info, 'revisione', create.getByRole('heading', { name: 'Revisione dei dati' }));
    await create.getByRole('button', { name: 'Prosegui alla conferma' }).click();
    await create.getByLabel('PIN di conferma').fill('1234'); await capture(page, info, 'conferma-pin');
    await create.getByRole('button', { name: 'Conferma creazione con PIN' }).click();
    await expect(create.getByRole('heading', { name: 'Scheda creata', exact: true })).toBeVisible();
    await capture(page, info, 'scheda-creata', create.getByRole('heading', { name: 'Scheda creata', exact: true }));
    const id = await group.getByLabel('Scheda di destinazione').inputValue(); expect(id).not.toBe('');
    expect(await (await page.request.get(`/api/attachments?patientId=${id}&metadata=true`)).json()).toHaveLength(1);
    await page.goto(`/patients/${id}/modules`);
    await expect(page.getByText(`${surname} Anna`, { exact: true }).first()).toBeVisible();
    await capture(page, info, 'scheda-finale');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('05-tastiera-conservazione', async ({ page }, info) => {
  await page.goto('/settings/conservazione');
  const field = page.getByTestId('retention-term-ambulatory_record').getByRole('spinbutton');
  // Finestra predisposta prima del percorso: la qualifica misura navigazione e conferma.
  await field.fill('12');
  await tabTo(page, field, 'finestra-anni');
  await capture(page, info, 'finestra');
  const save = page.getByTestId('retention-save-windows');
  await tabTo(page, save, 'salva-finestre'); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const cancel = dialog.getByRole('button', { name: 'Annulla', exact: true });
  await tabTo(page, cancel, 'annulla-dialogo');
  const confirm = dialog.getByRole('button', { name: 'Salva finestre', exact: true });
  await tabTo(page, confirm, 'conferma-finestre', true);
  await capture(page, info, 'conferma'); await page.keyboard.press('Enter');
  await expect(page.getByText('Finestre salvate', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/system/retention')).json()).windows.ambulatory_record).toEqual({ kind: 'years', years: 12 });
  await capture(page, info, 'finestre-salvate');
});
test('06-tastiera-import', async ({ page }, info) => catalog(page, info, true));

