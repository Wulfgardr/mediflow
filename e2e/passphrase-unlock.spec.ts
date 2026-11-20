import { hkdfSync, pbkdf2Sync } from 'node:crypto';
import type { Page, Request } from '@playwright/test';
import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession } from './utils';
import { documentRequests } from './fixtures/trusted-web-request';
import { isTrustedWebMutationRequest } from '../lib/security/request-transport';

const PIN = 'demo086086';
const PASSPHRASE = 'cavallo batteria graffetta corretta';
const LONG_PIN = 'un pin lungo quanto una frase';
const LONG_PIN_NOTICE = 'Questo archivio si sblocca con il PIN, e ciò che hai scritto è lungo come una passphrase. Se è il tuo PIN, confermalo.';
const LONG_PIN_CONFIRM = 'È il mio PIN';

test.describe.configure({ retries: 0 });

const isPost = (request: Request, pathname: string) => request.method() === 'POST' && new URL(request.url()).pathname === pathname;

async function showPinResidueNoticeOnNextSuccess(page: Page, pathname: string) {
  await page.evaluate(pathname => {
    const browserFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      const response = await browserFetch(input, init);
      if (url.pathname !== pathname || !response.ok) return response;
      window.fetch = browserFetch;
      const body = await response.json();
      return new Response(JSON.stringify({ ...body, earlierCopiesCleared: false }), {
        status: response.status, headers: response.headers,
      });
    };
  }, pathname);
}

async function expectUnlocked(page: Page): Promise<void> {
  await expect(page.getByLabel('MediFlow lock screen', { exact: true })).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  const manualEntry = page.getByRole('link', { name: 'Apri la cartella manualmente', exact: true });
  await expect(navigation.or(manualEntry).first()).toBeVisible();
  if (await manualEntry.isVisible()) await manualEntry.click();
  await expect(navigation).toBeVisible();
  expect((await documentRequests(page).get('/api/patients')).status()).toBe(200);
}

const pinAccount = test.extend({ existingPin: PIN });
const longPinAccount = test.extend({ existingPin: LONG_PIN });

pinAccount('an account moved to a passphrase is unlocked by it, and the passphrase never reaches the network', async ({ page, browser, baseURL, browserName }) => {
  expect(browserName, 'The held answer needs Chromium: it must not be skipped silently').toBe('chromium');
  await bootstrapUnlockedSession(page, PIN);
  expect(isTrustedWebMutationRequest(new globalThis.Request(new URL('/api/auth/passphrase', baseURL!), {
    method: 'POST', headers: { Origin: 'http://other.synthetic.invalid', 'Sec-Fetch-Site': 'cross-site' },
  }))).toBe(false);
  expect((await documentRequests(page).get('/api/patients')).status()).toBe(200);

  const stale = await browser.newContext({ baseURL });
  const stalePage = await stale.newPage();
  const staleLogins: string[] = [];
  stalePage.on('request', request => { if (isPost(request, '/api/auth/login')) staleLogins.push(request.postData() ?? ''); });
  await stalePage.goto('/');
  const staleInput = stalePage.locator('#mediflow-lock-pin');
  await expect(stalePage.getByLabel('PIN operatore', { exact: true })).toBeEnabled();
  await staleInput.fill(PASSPHRASE);

  const cdp = await stale.newCDPSession(stalePage);
  let heldCheck: string | undefined;
  cdp.on('Fetch.requestPaused', event => { heldCheck = event.requestId; });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: new URL('/api/auth/check', baseURL).href, requestStage: 'Response' }] });
  await staleInput.press('Enter');
  await expect.poll(() => heldCheck, 'the real answer of the server must reach the gate').toBeTruthy();

  await page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Impostazioni', exact: true }).click();
  await page.getByRole('link', { name: 'Accesso', exact: true }).click();
  await page.getByLabel('PIN attuale', { exact: true }).first().fill(PIN);
  await page.getByLabel('Nuova passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('Conferma nuova passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Prepara il nuovo kit', exact: true }).click();
  const kitPanel = page.getByTestId('recovery-kit');
  await expect(kitPanel.getByRole('button', { name: 'Attiva la nuova passphrase' })).toBeDisabled();
  const download = page.waitForEvent('download');
  await kitPanel.getByRole('button', { name: 'Scarica kit di recupero' }).click(); await download;
  await kitPanel.getByRole('checkbox').check();
  await showPinResidueNoticeOnNextSuccess(page, '/api/auth/passphrase');
  const adoption = page.waitForResponse(response => isPost(response.request(), '/api/auth/passphrase'));
  await kitPanel.getByRole('button', { name: 'Attiva la nuova passphrase' }).click();
  const adopted = await adoption;
  expect(adopted.status()).toBe(200);
  await expect(page.getByTestId('pin-residue-notice')).toContainText('rimozione');
  const payload = adopted.request().postDataJSON();
  expect(payload.currentPin).toBe(PIN); expect(JSON.stringify(payload)).not.toContain(PASSPHRASE);
  const credential = payload;
  const root = pbkdf2Sync(Buffer.from(PASSPHRASE.normalize('NFKC'), 'utf8'), Buffer.from(credential.salt, 'base64'), 2_000_000, 32, 'sha256');
  expect(credential.verifier).toBe(Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), 'mediflow.unlock.verifier.v3', 32)).toString('base64'));
  expect((await documentRequests(page).get('/api/patients')).status()).toBe(401);

  try {
    await cdp.send('Fetch.continueRequest', { requestId: heldCheck! });
    await cdp.send('Fetch.disable');
    const notice = stalePage.locator('#mediflow-lock-confirm');
    const refusal = stalePage.locator('#mediflow-lock-error');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    await expect(staleInput).toHaveValue(PASSPHRASE);
    expect(staleLogins).toEqual([]);
    await stalePage.getByRole('button', { name: LONG_PIN_CONFIRM, exact: true }).click();
    await expect(refusal).toHaveText('Questo archivio ora si sblocca con la passphrase. Inseriscila.');
    await expect(notice).toHaveCount(0);
    await expect(stalePage.getByLabel('Passphrase', { exact: true })).toHaveValue('');
    expect(staleLogins).toEqual([]);
    await staleInput.fill(PASSPHRASE);
    await staleInput.press('Enter');
    await expectUnlocked(stalePage);
    expect(staleLogins.map(body => Object.keys(JSON.parse(body)))).toEqual([['verifier']]);
    expect(staleLogins.join('')).not.toContain(PASSPHRASE);
  } finally {
    await stale.close();
  }

  const logins: string[] = [];
  page.on('request', request => { if (isPost(request, '/api/auth/login')) logins.push(request.postData() ?? ''); });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
  const field = page.getByLabel('Passphrase', { exact: true });
  const submit = page.getByRole('button', { name: 'Sblocca', exact: true });
  await expect(field).toBeEnabled();
  await expect(field).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('PIN operatore', { exact: true })).toHaveCount(0);

  await field.fill(PIN);
  await expect(submit).toBeDisabled();

  await field.fill(`${PASSPHRASE}!`);
  const denied = page.waitForResponse(response => isPost(response.request(), '/api/auth/login'));
  await field.press('Enter');
  expect((await denied).status()).toBe(401);
  await expect(page.locator('#mediflow-lock-error')).toHaveText('Passphrase non valida. Tentativi rimasti: 4.');
  await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toHaveCount(0);

  await showPinResidueNoticeOnNextSuccess(page, '/api/auth/login');
  await field.fill(PASSPHRASE);
  const accepted = page.waitForResponse(response => isPost(response.request(), '/api/auth/login'));
  await submit.click();
  const response = await accepted;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, encryptedMasterKey: credential.encryptedMasterKey, salt: credential.salt });
  await expectUnlocked(page);
  await expect(page.getByTestId('pin-residue-notice')).toBeVisible(); // Pending remains visible in the unlocked shell.

  await page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Impostazioni', exact: true }).click();
  await page.getByRole('link', { name: 'Accesso', exact: true }).click();
  await expect(page.getByTestId('settings-access-passphrase')).toContainText('Questo archivio si sblocca con la passphrase.');
  await expect(page.getByRole('button', { name: 'Aggiorna PIN', exact: true })).toHaveCount(0);
  await expect(page.getByText('Il blocco richiede la passphrase al prossimo accesso.')).toBeVisible();

  expect(logins).toHaveLength(2);
  for (const body of logins) {
    expect(Object.keys(JSON.parse(body))).toEqual(['verifier']);
    expect(body).not.toContain(PASSPHRASE);
  }
  expect(JSON.parse(logins[1])).toEqual({ verifier: credential.verifier });
  await expect(page.getByTestId('pin-residue-notice')).toBeVisible();
  await page.getByRole('button', { name: 'Blocca sessione adesso', exact: true }).click();
  await expect(field).toBeEnabled();
  await field.fill(PASSPHRASE);
  await field.press('Enter');
  await expectUnlocked(page);
  await expect(page.getByTestId('pin-residue-notice')).toHaveCount(0); // Only canonical true clears the warning.

  const reopened = await browser.newContext({ baseURL });
  try {
    const second = await reopened.newPage();
    await second.goto('/');
    const secondField = second.getByLabel('Passphrase', { exact: true });
    await expect(secondField).toBeEnabled();
    await secondField.fill(PASSPHRASE);
    await secondField.press('Enter');
    await expectUnlocked(second);
  } finally {
    await reopened.close();
  }
});

longPinAccount('a PIN as long as a passphrase opens its archive only when it is confirmed on the control shown with the notice', async ({ page, browser, baseURL }) => {
  await bootstrapUnlockedSession(page, LONG_PIN);

  const locked = await browser.newContext({ baseURL });
  try {
    const lockPage = await locked.newPage();
    const logins: string[] = [];
    lockPage.on('request', request => { if (isPost(request, '/api/auth/login')) logins.push(request.postData() ?? ''); });
    const sent = () => logins.map(body => JSON.parse(body));
    const settled = async () => {
      await lockPage.waitForLoadState('networkidle');
      await expect(lockPage.locator('form')).toHaveAttribute('aria-busy', 'false');
    };
    await lockPage.goto('/');
    const input = lockPage.locator('#mediflow-lock-pin');
    const notice = lockPage.locator('#mediflow-lock-confirm');
    const confirm = lockPage.getByRole('button', { name: LONG_PIN_CONFIRM, exact: true });
    const unlock = lockPage.getByRole('button', { name: 'Sblocca', exact: true });
    await expect(lockPage.getByLabel('PIN operatore', { exact: true })).toBeEnabled();

    await input.fill(LONG_PIN);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    await expect(input).toHaveValue(LONG_PIN);
    await expect(input).toBeFocused();
    await settled();
    expect(sent()).toEqual([]);

    await lockPage.keyboard.press('Enter');
    await settled();
    await lockPage.keyboard.down('Enter');
    await lockPage.keyboard.down('Enter');
    await lockPage.keyboard.down('Enter');
    await lockPage.keyboard.up('Enter');
    await settled();
    await unlock.click();
    await settled();
    await unlock.dblclick();
    await settled();
    await lockPage.evaluate(() => { const form = document.querySelector('form')!; form.requestSubmit(); form.requestSubmit(); });
    await settled();
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    expect(sent()).toEqual([]);

    await input.focus();
    await lockPage.keyboard.down('Enter');
    await settled();
    await lockPage.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await lockPage.keyboard.down('Enter');
    await lockPage.keyboard.down('Enter');
    await lockPage.keyboard.up('Enter');
    await settled();
    const target = await confirm.boundingBox();
    await lockPage.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2);
    await lockPage.mouse.down({ clickCount: 2 });
    await lockPage.mouse.up({ clickCount: 2 });
    await settled();
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    expect(sent()).toEqual([]);

    await lockPage.evaluate(() => window.dispatchEvent(new Event('mediflow:api-auth-unavailable')));
    await expect(lockPage.locator('#mediflow-lock-error')).toHaveText('Sessione scaduta.');
    await expect(notice).toHaveCount(0);
    await expect(confirm).toHaveCount(0);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);

    await input.fill(`${LONG_PIN}!`);
    await expect(confirm).toHaveCount(0);
    await input.fill(LONG_PIN);
    await expect(notice).toHaveCount(0);
    await expect(confirm).toHaveCount(0);
    await settled();
    expect(sent()).toEqual([]);

    await input.fill(`${LONG_PIN}!`);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    await expect(input).toBeFocused();
    await lockPage.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await lockPage.keyboard.press('Enter');
    await expect(lockPage.locator('#mediflow-lock-error')).toBeVisible();
    await settled();
    expect(sent()).toEqual([{ password: `${LONG_PIN}!` }]);

    await input.fill(LONG_PIN);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expectUnlocked(lockPage);
    await lockPage.waitForLoadState('networkidle');
    expect(sent()).toEqual([{ password: `${LONG_PIN}!` }, { password: LONG_PIN }]);
  } finally {
    await locked.close();
  }
});
