import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';
import { loginWithWebAuthControl } from '../scripts/web-auth-control-test-client.mjs';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

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
  const headers = await trustedArchiveWebRequestHeaders(page);
  const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
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
