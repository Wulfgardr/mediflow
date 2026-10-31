import Database from 'better-sqlite3';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection } from '../utils';
import { createFixture } from './treatment-reasoning';

export function seedTreatmentReasoningSetting(value: 'enabled' | 'disabled') {
  const directory = process.env.MEDIFLOW_DATA_DIR;
  const baseURL = process.env.E2E_BASE_URL;
  if (!directory || !baseURL || (new URL(baseURL).port === '3000' || new URL(baseURL).hostname !== '127.0.0.1')
    || process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1') throw new Error('Archivio sintetico isolato richiesto');
  const root = realpathSync(directory);
  if (!existsSync(path.join(root, 'SYNTHETIC_ONLY'))) throw new Error('Marcatore SYNTHETIC_ONLY richiesto');
  if (/Antigravity\/medical-record-app|MediFlowCoreTests\/Fixtures/.test(root)) throw new Error('Archivio non autorizzato');
  const db = new Database(path.join(root, 'medical.db'), { fileMustExist: true });
  const key = 'aiTreatmentReasoningKillSwitch';
  const before = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  db.close();
  return () => {
    const connection = new Database(path.join(root, 'medical.db'), { fileMustExist: true });
    try {
      if (before) connection.prepare('UPDATE settings SET value = ? WHERE key = ?').run(before.value, key);
      else connection.prepare('DELETE FROM settings WHERE key = ?').run(key);
    } finally { connection.close(); }
  };
}

export async function openTreatmentReasoningDenial(page: Page, value: 'enabled' | 'disabled' = 'enabled') {
  const restore = seedTreatmentReasoningSetting(value);
  try {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const fixture = await createFixture(page);
    const before = await (await page.request.get(`/api/therapies?patientId=${fixture.patientId}`)).json();
    const calls: string[] = [];
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(process.env.E2E_BASE_URL!).origin || /\/api\/(ai\/|proxy\/ollama\/(chat|generate))/.test(url.pathname)
        || (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && /^\/api\/(patients|therapies|entries|observations|attachments|settings)(\/|$)/.test(url.pathname))) {
        calls.push(`${request.method()} ${url.href}`); await route.abort(); return;
      }
      await route.continue();
    });
    await page.goto(`/patients/${fixture.patientId}/modules`);
    await openPatientSection(page, 'terapie');
    const proposals = page.locator('#terapie').getByRole('button', { name: 'Proposte', exact: true });
    await expect(proposals).toHaveAttribute('aria-expanded', 'false');
    await proposals.click();
    await expect(proposals).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByTestId('treatment-reasoning-panel');
    const assertDenied = async () => {
      await expect(panel).toContainText('Non disponibile in questa versione');
      await expect(panel.getByRole('button')).toHaveCount(0);
      await expect(panel.getByTestId('model-picker-treatment_reasoning')).toHaveCount(0);
      await expect(panel.getByTestId('treatment-reasoning-proposal')).toHaveCount(0);
      expect(calls).toEqual([]);
      expect(await (await page.request.get(`/api/therapies?patientId=${fixture.patientId}`)).json()).toEqual(before);
      expect((await (await page.request.get('/api/settings/aiTreatmentReasoningKillSwitch')).json()).value).toBe(value);
    };
    await assertDenied();
    return { panel, proposals, assertDenied, restore };
  } catch (error) { restore(); throw error; }
}
