import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';

const endpoint = '/api/settings/aiDocumentSynthesisKillSwitch';
type Gate = {
  captured: boolean; denied: boolean; returned: boolean; requests: number;
  status?: number; signal?: AbortSignal; denials: number; caller?: string; stack?: string;
  dispatch: () => void; deliver: () => void;
};
declare global { interface Window { killSwitchReadGate: Gate } }

async function installGate(page: Page, consumer: string, selectedRead: number) {
  await page.addInitScript(({ endpoint, consumer, selectedRead }) => {
    const original = window.fetch.bind(window);
    let dispatch!: () => void, deliver!: () => void;
    const dispatchGate = new Promise<void>(done => { dispatch = done; });
    const deliveryGate = new Promise<void>(done => { deliver = done; });
    const state = window.killSwitchReadGate = {
      captured: false, denied: false, returned: false, requests: 0, denials: 0, dispatch, deliver,
    } as Gate;
    window.addEventListener('mediflow:api-auth-unavailable', () => { state.denials++; });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname !== endpoint || state.captured) return original(input, init);
      state.requests++;
      const stack = new Error().stack ?? '';
      const caller = stack.includes('DocumentUploadSession') ? 'document-upload' : stack.includes('PatientDetailPage') ? 'modules' : undefined;
      if (caller ? caller !== consumer : state.requests !== selectedRead) return original(input, init);
      state.caller = caller;
      state.stack = stack;
      state.signal = init?.signal ?? undefined;
      state.captured = true;
      await dispatchGate;
      // Transport deliberately ignores cancellation so the real facade must retire its continuation too.
      const response = await original(input, { ...init, signal: undefined });
      state.status = response.status;
      state.denied = true;
      await deliveryGate;
      state.returned = true;
      return response;
    };
  }, { endpoint, consumer, selectedRead });
}

for (const [index, consumer] of ['modules', 'document-upload'].entries()) test(`${consumer}: old real 401 cannot clear the new PIN session`, async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const fixture = { id: randomUUID(), firstName: 'Sonda', lastName: 'Sintetica', taxCode: `UI792${randomUUID().replaceAll('-', '').slice(0, 11).toUpperCase()}` };
  expect(await page.evaluate(async fixture => (await fetch('/api/patients', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture),
  })).status, fixture)).toBe(201);
  await installGate(page, consumer, index + 1);
  await page.goto(`/patients/${fixture.id}/modules`);
  await page.waitForFunction(() => window.killSwitchReadGate.captured);
  const receipt = page.waitForResponse(response => response.url().endsWith('/api/auth/lock') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Blocca', exact: true }).click();
  expect((await receipt).status()).toBe(200);
  expect((await (await receipt).json()).state).toBe('server_invalidation_confirmed');
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Cartelle aperte' })).toHaveCount(0);
  await page.evaluate(() => window.killSwitchReadGate.dispatch());
  await page.waitForFunction(() => window.killSwitchReadGate.denied);
  expect(await page.evaluate(() => window.killSwitchReadGate.status)).toBe(401);
  await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
  const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  await expect(nav).toBeVisible();
  expect(await page.evaluate(async endpoint => (await fetch(endpoint)).status, endpoint)).toBe(200);
  const denialsBefore = await page.evaluate(() => window.killSwitchReadGate.denials);
  await test.info().attach('controlled-read.json', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => {
    const state = window.killSwitchReadGate;
    return { caller: state.caller, stack: state.stack, status: state.status, retired: state.signal?.aborted, denialsBefore: state.denials };
  })) });
  await page.evaluate(async () => {
    window.killSwitchReadGate.deliver();
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
  await page.waitForFunction(() => window.killSwitchReadGate.returned);
  expect(await page.evaluate(() => window.killSwitchReadGate.denials)).toBe(denialsBefore);
  await expect(nav).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toHaveCount(0);
  expect(await page.evaluate(async endpoint => (await fetch(endpoint)).status, endpoint)).toBe(200);
});
