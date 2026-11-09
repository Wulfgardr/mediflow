import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openDocumentActions, openPatientSection } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';
import { loginWithWebAuthControl } from '../scripts/web-auth-control-test-client.mjs';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { switchPreset, type TerritorialPreset } from './fixtures/territorial-preset';
import {
  RETENTION_CATEGORIES, RETENTION_CATEGORY_LABELS, RETENTION_PROFILES, RETENTION_SOURCES, effectiveRetentionTerm,
  type EffectiveTerm, type RetentionProfileId, type RetentionTerm, type RetentionWindows,
} from '../lib/retention-policy';

const endpoint = '/api/system/retention';

test('conservazione: profilo, finestre, blocchi, scarto e autorizzazione su runtime isolato', async ({ page, isolatedRuntime }, info) => {
  test.setTimeout(180_000);
  const evidence = process.env.RETENTION_EVIDENCE_DIR || info.outputPath('retention');
  mkdirSync(evidence, { recursive: true });
  const negatives: unknown[] = [];
  for (const method of ['GET', 'PUT', 'POST']) {
    const anonymous = await fetch(isolatedRuntime.url + endpoint, { method,
      ...(method === 'GET' ? {} : { headers: { Origin: isolatedRuntime.url, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: '{}' }) });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'Unauthorized' });
    negatives.push({ case: 'no-session', method, status: 401, body: { error: 'Unauthorized' } });
  }
  await bootstrapUnlockedSession(page, '314159');
  let headers = await trustedArchiveWebRequestHeaders(page);
  let db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
  try {
    const setting = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    setting.run('territorial.packs', JSON.stringify({ schemaVersion: 'mediflow.territorial-packs.v1', revision: 1, preset: 'core+it+lom' }));
    setting.run('territorial.packs.initialization', 'synthetic');
    const overview = async () => {
      const response = await page.request.get(endpoint); expect(response.status()).toBe(200); return response.json();
    };
    const reject = async (method: 'POST' | 'PUT', data: unknown, status: number, body: unknown, path = endpoint) => {
      const response = await page.request.fetch(path, { method, headers, data });
      expect(response.status()).toBe(status); expect(await response.json()).toEqual(body);
      negatives.push({ case: path, method, input: data, status, body });
    };
    for (const method of ['POST', 'PUT'] as const) {
      await reject(method, '{', 400, { code: 'input_invalid' });
      await reject(method, [], 400, { code: 'input_invalid' });
    }
    await page.goto('/settings/conservazione');
    await expect(page.getByTestId('retention-profile')).toContainText('Lombardia, massimario rev04');
    await expect(page.getByTestId('retention-profile').getByRole('link', { name: /Regione Lombardia/ })).toHaveAttribute('href', /^https:\/\//);
    expect(await overview()).toMatchObject({ preset: 'core+it+lom', profileId: 'it-lom-rev04', review: [] });
    await page.screenshot({ path: join(evidence, 'profilo.png'), fullPage: true });
    await page.getByTestId('retention-review').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, 'vuoto.png'), fullPage: true });
    const input = page.getByTestId('retention-term-ambulatory_record').getByRole('spinbutton');
    await input.fill('12');
    await page.getByTestId('retention-save-windows').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salva finestre', exact: true }).click();
    await expect(page.getByText('Finestre salvate', { exact: true })).toBeVisible();
    await page.reload(); await expect(input).toHaveValue('12');
    const saved = await overview();
    expect(saved.windows.ambulatory_record).toEqual({ kind: 'years', years: 12 });
    await reject('PUT', { confirmed: true, expectedRevision: saved.windowsRevision - 1, windows: {} }, 409, { code: 'conflict' });
    await reject('PUT', { confirmed: true, expectedRevision: saved.windowsRevision, windows: { ambulatory_record: { kind: 'years', years: 2 } } }, 400, { code: 'below_minimum' });
    await input.fill('2');
    await page.getByTestId('retention-save-windows').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salva finestre', exact: true }).click();
    await expect(page.getByText('La finestra è più breve del minimo del profilo attivo.', { exact: true })).toBeVisible();
    expect((await overview()).windows).toEqual(saved.windows);
    await page.reload(); await expect(input).toHaveValue('12');

    // R-4: la finestra salvata sopravvive a un riavvio del server, non solo alla ricarica della pagina.
    db.close();
    await isolatedRuntime.restart();
    db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
    await bootstrapUnlockedSession(page, '314159');
    headers = await trustedArchiveWebRequestHeaders(page);
    await page.goto('/settings/conservazione');
    await expect(input).toHaveValue('12');
    const afterRestart = await overview();
    expect(afterRestart.windows).toEqual(saved.windows);
    expect(afterRestart.windowsRevision).toBe(saved.windowsRevision);
    await page.screenshot({ path: join(evidence, 'dopo-riavvio.png'), fullPage: true });

    const at = Date.UTC(2000, 0, 1) / 1000;
    const ambulatory = db.prepare('SELECT id FROM ambulatories WHERE is_default=1').pluck().get();
    db.prepare(`INSERT INTO patients(id,first_name,last_name,tax_code,is_archived,version,created_at,updated_at,ambulatory_id)
      VALUES ('retention-synthetic','Persona','Sintetica','SYNTHETIC',1,1,?,?,?)`).run(at, at, ambulatory);
    db.prepare('INSERT INTO patients_to_ambulatories(patient_id,ambulatory_id,assigned_at) VALUES (?,?,?)').run('retention-synthetic', ambulatory, at);
    db.prepare(`INSERT INTO entries(id,patient_id,type,date,content,created_at,updated_at)
      VALUES ('retention-entry','retention-synthetic','visit',?,'Sintetico',?,?)`).run(at, at, at);
    await page.reload();
    const row = page.getByTestId('retention-review-item');
    await expect(row).toContainText('Sintetica Persona');
    await expect(row).toHaveAttribute('data-status', 'expired');
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, 'scaduto.png'), fullPage: true });
    const expired = (await overview()).review[0];
    const command = { action: 'discard', patientId: expired.patientId, expectedVersion: expired.version, expectedExpiresAt: expired.expiresAt };
    await reject('POST', command, 400, { code: 'input_invalid' });
    await page.getByTestId('retention-hold-patient').selectOption(expired.patientId);
    await page.getByTestId('retention-place-hold').click();
    await expect(page.getByTestId('retention-holds')).toContainText('Sintetica Persona');
    await expect(row).toHaveAttribute('data-status', 'held');
    await page.getByTestId('retention-holds').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, 'blocco.png'), fullPage: true });
    await reject('POST', { ...command, confirmed: true }, 409, { code: 'legal_hold' });
    db.prepare('UPDATE patients SET deleted_at=? WHERE id=?').run(at, expired.patientId);
    await reject('POST', { patientId: expired.patientId, version: 1 }, 409, { error: 'Legal hold active', code: 'legal_hold' }, '/api/system/purge-patient');
    expect(db.prepare('SELECT id FROM patients WHERE id=?').get(expired.patientId)).toBeTruthy();
    db.prepare('UPDATE patients SET deleted_at=NULL WHERE id=?').run(expired.patientId);
    await page.getByRole('button', { name: 'Revoca', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoca blocco', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'expired');
    await page.getByTestId('retention-discard').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Annulla', exact: true }).click();
    expect(db.prepare('SELECT id FROM patients WHERE id=?').get(expired.patientId)).toBeTruthy();
    await page.getByTestId('retention-discard').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Scarta definitivamente', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(db.prepare('SELECT id FROM patients WHERE id=?').get(expired.patientId)).toBeUndefined();
    expect(db.prepare('SELECT id FROM entries WHERE patient_id=?').get(expired.patientId)).toBeUndefined();
    expect(db.prepare('SELECT id FROM patient_retired_ids WHERE id=?').get(expired.patientId)).toBeTruthy();
    const audit = db.prepare("SELECT * FROM audit_events WHERE event_type LIKE 'retention.%' ORDER BY occurred_at,rowid").all();
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'retention.windows.changed', source_surface: 'web', outcome: 'success' }),
      expect.objectContaining({ event_type: 'retention.hold.placed', subject_ref: expired.patientId }),
      expect.objectContaining({ event_type: 'retention.hold.released', subject_ref: expired.patientId }),
      expect.objectContaining({ event_type: 'retention.fascicolo.discarded', subject_ref: expired.patientId, source_surface: 'web', outcome: 'success' }),
    ]));
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const user = db.prepare('SELECT * FROM users LIMIT 1').get() as { id: string; username: string };
    db.prepare("UPDATE users SET role='doctor' WHERE id=?").run(user.id);
    const login = await loginWithWebAuthControl(isolatedRuntime.url, { username: user.username, password: '314159' });
    expect(login.response.status).toBe(200);
    if (!login.webHeaders?.Cookie) throw new Error('Sessione sintetica non disponibile');
    for (const method of ['GET', 'PUT', 'POST']) {
      const response = await fetch(isolatedRuntime.url + endpoint, { method, headers: { ...login.webHeaders!, ...headers, Cookie: login.webHeaders!.Cookie, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'Forbidden' });
      negatives.push({ case: 'non-admin', method, status: 403, body: { error: 'Forbidden' } });
    }
    writeFileSync(join(evidence, 'audit.json'), JSON.stringify(audit, null, 2));
  } finally {
    db.close(); writeFileSync(join(evidence, 'http-negatives.json'), JSON.stringify(negatives, null, 2));
  }
});

test('blocco su documento dal browser: il documento resta finché il blocco non è revocato', async ({ page, isolatedRuntime }, info) => {
  test.setTimeout(180_000);
  const evidence = process.env.RETENTION_EVIDENCE_DIR || info.outputPath('retention-documento');
  mkdirSync(evidence, { recursive: true });
  await bootstrapUnlockedSession(page, '314159');
  const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
  try {
    const setting = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    setting.run('territorial.packs', JSON.stringify({ schemaVersion: 'mediflow.territorial-packs.v1', revision: 1, preset: 'core+it+lom' }));
    setting.run('territorial.packs.initialization', 'synthetic');
    const patientId = await page.evaluate(async () => {
      const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ firstName: 'Documento', lastName: 'Bloccato', taxCode: 'BLCDCM80A01H501X',
          birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
      if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
      return (await response.json() as { id: string }).id;
    });
    const name = 'Referto sintetico sotto blocco.txt';
    const openDocuments = async () => {
      await page.goto(`/patients/${patientId}/modules`);
      await openPatientSection(page, 'documenti');
      const docs = page.getByTestId('patient-documents');
      await expect(docs.locator('[data-document-area="list"]')).toHaveAttribute('aria-busy', 'false');
      return docs;
    };
    let docs = await openDocuments();
    await docs.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('Referto sintetico. Nessun dato reale.') });
    await expect(docs.getByRole('status').filter({ hasText: 'allegato salvato' })).toBeVisible();
    const attachmentId = db.prepare('SELECT id FROM attachments WHERE patient_id=?').pluck().get(patientId) as string;
    expect(attachmentId).toBeTruthy();

    await page.goto('/settings/conservazione');
    await page.getByTestId('retention-hold-patient').selectOption(patientId);
    const holds = page.getByTestId('retention-holds');
    await holds.getByRole('combobox', { name: 'Documento' }).selectOption(attachmentId);
    await page.getByTestId('retention-place-hold').click();
    await expect(holds).toContainText('documento');
    await holds.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, 'blocco-documento.png'), fullPage: true });

    const tryDelete = async () => {
      docs = await openDocuments();
      await openDocumentActions(page, name);
      await docs.getByRole('menuitem', { name: 'Elimina ' + name, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
    };
    await tryDelete();
    await expect(page.getByTestId('attachment-delete-held')).toBeVisible();
    await page.screenshot({ path: join(evidence, 'eliminazione-respinta.png'), fullPage: true });
    expect(db.prepare('SELECT id FROM attachments WHERE id=?').get(attachmentId)).toBeTruthy();
    await page.reload(); await openPatientSection(page, 'documenti');
    await expect(docs.getByRole('button', { name: `Visualizza ${name}`, exact: true })).toBeVisible();

    await page.goto('/settings/conservazione');
    await holds.getByRole('button', { name: 'Revoca', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoca blocco', exact: true }).click();
    await expect(holds).toContainText('Nessun blocco attivo.');
    await tryDelete();
    await expect(docs.getByRole('button', { name: `Visualizza ${name}`, exact: true })).toHaveCount(0);
    expect(db.prepare('SELECT id FROM attachments WHERE id=?').get(attachmentId)).toBeUndefined();

    const audit = db.prepare("SELECT event_type, redacted_metadata AS flags FROM audit_events WHERE event_type LIKE 'retention.hold.%' ORDER BY occurred_at,rowid").all() as { event_type: string; flags: string }[];
    expect(audit.map(row => row.event_type)).toEqual(['retention.hold.placed', 'retention.hold.released']);
    expect(audit[0].flags).toContain('scope:document');
    expect(audit[0].flags).toContain(`attachment:${attachmentId}`);
    writeFileSync(join(evidence, 'audit.json'), JSON.stringify(audit, null, 2));
  } finally { db.close(); }
});

// R-1: il contratto 0.9.1 fissa la corrispondenza fra assetto e profilo; minimi e fonti si leggono dalla tabella del prodotto.
const PROFILE_FOR_PRESET: Record<TerritorialPreset, RetentionProfileId> = { core: 'none', 'core+it': 'it-national', 'core+it+lom': 'it-lom-rev04' };
const termText = (term: RetentionTerm | EffectiveTerm) => term.kind === 'years' ? `${term.years} anni` : term.kind === 'unlimited' ? 'Illimitata' : 'Da fissare';

test('R-1: profilo di conservazione per nucleo, Italia e Lombardia con minimi e fonti della tabella del prodotto', async ({ page }, info) => {
  test.setTimeout(240_000);
  const evidence = process.env.RETENTION_EVIDENCE_DIR || info.outputPath('retention-profili');
  mkdirSync(evidence, { recursive: true });
  await bootstrapUnlockedSession(page, '314159');
  const overview = async () => {
    const response = await page.request.get(endpoint); expect(response.status()).toBe(200);
    return await response.json() as { preset: string; profileId: RetentionProfileId; windows: RetentionWindows; windowsRevision: number; review: unknown[] };
  };
  const observed: unknown[] = [];
  const saveWindow = async (category: string, years: number) => {
    await page.getByTestId(`retention-term-${category}`).getByRole('spinbutton').fill(String(years));
    await page.getByTestId('retention-save-windows').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salva finestre', exact: true }).click();
  };
  for (const preset of ['core', 'core+it', 'core+it+lom'] as const) {
    const profileId = PROFILE_FOR_PRESET[preset];
    const profile = RETENTION_PROFILES[profileId];
    await switchPreset(page, preset);
    await page.goto('/settings/conservazione');
    const state = await overview();
    expect(state, `R-1 profilo ${profileId} per ${preset}`).toMatchObject({ preset, profileId, review: [] });
    const card = page.getByTestId('retention-profile');
    await expect(card.getByText(profile.label, { exact: true }), `R-1 nome del profilo ${profileId}`).toBeVisible();
    const sources = [...new Set(RETENTION_CATEGORIES.map(category => profile.terms[category].sourceId).filter(id => id !== null))];
    await expect(card.getByRole('link'), `R-1 fonti del profilo ${profileId}`).toHaveText(sources.map(id => RETENTION_SOURCES[id].label));
    for (const id of sources) await expect(card.getByRole('link', { name: RETENTION_SOURCES[id].label, exact: true })).toHaveAttribute('href', RETENTION_SOURCES[id].href);
    await expect(card.getByText(/Senza profilo, nessun fascicolo scade/u)).toHaveCount(profileId === 'none' ? 1 : 0);
    for (const category of RETENTION_CATEGORIES) {
      const minimum = profile.terms[category];
      const row = page.getByTestId(`retention-term-${category}`);
      await expect(row).toContainText(RETENTION_CATEGORY_LABELS[category]);
      await expect(row, `R-1 minimo ${profileId}/${category}`).toContainText(`Minimo: ${termText(minimum.term)}.`);
      if (minimum.sourceId) await expect(row, `R-1 fonte ${profileId}/${category}`).toContainText(RETENTION_SOURCES[minimum.sourceId].label);
      await expect(row.getByText('Non modificabile', { exact: true })).toHaveCount(minimum.term.kind === 'unlimited' ? 1 : 0);
      await expect(row, `R-1 termine applicato ${profileId}/${category}`)
        .toContainText(`Applicato: ${termText(effectiveRetentionTerm(profileId, category, state.windows[category]))}`);
    }
    await page.screenshot({ path: join(evidence, `profilo-${profileId}.png`), fullPage: true });

    if (preset === 'core+it+lom') { observed.push({ preset, profileId }); continue; }
    // Finestre: sotto il minimo del profilo il salvataggio è respinto, sopra resta dopo la ricarica.
    const bounded = RETENTION_CATEGORIES.find(category => profile.terms[category].term.kind === 'years');
    if (bounded) {
      const minimum = profile.terms[bounded].term as { kind: 'years'; years: number };
      await saveWindow(bounded, minimum.years - 1);
      await expect(page.getByText('La finestra è più breve del minimo del profilo attivo.', { exact: true })).toBeVisible();
      expect((await overview()).windows, `R-1 finestra sotto il minimo respinta per ${profileId}`).toEqual(state.windows);
      await page.reload();
    } else {
      // Senza minimi in anni (nessun profilo) il titolare fissa il termine: nessun fascicolo scade prima.
      expect(RETENTION_CATEGORIES.filter(category => profile.terms[category].term.kind === 'owner')).toHaveLength(RETENTION_CATEGORIES.length - 1);
    }
    const category = bounded ?? 'ambulatory_record';
    const years = (profile.terms[category].term.kind === 'years' ? (profile.terms[category].term as { years: number }).years : 0) + 3;
    await saveWindow(category, years);
    await expect(page.getByText('Finestre salvate', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`retention-term-${category}`).getByRole('spinbutton')).toHaveValue(String(years));
    await expect(page.getByTestId(`retention-term-${category}`)).toContainText(`Applicato: ${years} anni`);
    const saved = await overview();
    expect(saved.windows[category], `R-1 finestra del titolare salvata per ${profileId}`).toEqual({ kind: 'years', years });
    observed.push({ preset, profileId, sources, window: { category, years } });
  }
  writeFileSync(join(evidence, 'profili.json'), JSON.stringify(observed, null, 2));
});
