/* ADR 0143: real UI on an isolated server. An account moved to a passphrase is unlocked by it in
   the browser, and what the person types never reaches the network. The move itself is asked
   through the route, as the page will ask it once the guided procedure exists. */
import { createCipheriv, createDecipheriv, hkdfSync, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { Page, Request } from '@playwright/test';
import { expect, test } from './fixtures/isolated-runtime';
import { trustedWebRequestHeaders } from './fixtures/trusted-web-request';
import { bootstrapUnlockedSession } from './utils';

const PIN = 'demo086086';
const PASSPHRASE = 'cavallo batteria graffetta corretta';
const LONG_PIN = 'un pin lungo quanto una frase';
const LONG_PIN_NOTICE = 'Questo archivio si sblocca con il PIN, e ciò che hai scritto è lungo come una passphrase. Se è il tuo PIN, premi di nuovo Sblocca.';

test.describe.configure({ retries: 0 });

const isPost = (request: Request, pathname: string) => request.method() === 'POST' && new URL(request.url()).pathname === pathname;

// The documented construction, written apart from the product code: AES-256-GCM as base64 of
// IV, ciphertext and tag; version 3 is PBKDF2-HMAC-SHA256 then HKDF-SHA256 into two values.
function wrap(masterKey: Buffer, kek: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  return Buffer.concat([iv, cipher.update(masterKey), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function openPinWrapping(blob: string, salt: string): Buffer {
  const payload = Buffer.from(blob.replace(/^v2:/u, ''), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', pbkdf2Sync(PIN, Buffer.from(salt, 'base64'), 600_000, 32, 'sha256'), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([decipher.update(payload.subarray(12, payload.length - 16)), decipher.final()]);
}
function passphraseCredential(masterKey: Buffer) {
  const salt = randomBytes(16);
  const root = pbkdf2Sync(Buffer.from(PASSPHRASE.normalize('NFKC'), 'utf8'), salt, 2_000_000, 32, 'sha256');
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), info, 32));
  const recoveryKey = randomBytes(20);
  const recoverySalt = randomBytes(16);
  const recover = (info: string) => Buffer.from(hkdfSync('sha256', recoveryKey, recoverySalt, info, 32));
  return {
    encryptedMasterKey: `v3:${wrap(masterKey, derive('mediflow.unlock.kek.v3'))}`,
    salt: salt.toString('base64'),
    verifier: derive('mediflow.unlock.verifier.v3').toString('base64'),
    recovery: {
      wrappedMasterKey: `r1:${wrap(masterKey, recover('mediflow.recovery.kek.v1'))}`,
      salt: recoverySalt.toString('base64'),
      verifier: recover('mediflow.recovery.verifier.v1').toString('base64'),
    },
  };
}

async function expectUnlocked(page: Page): Promise<void> {
  await expect(page.getByLabel('MediFlow lock screen', { exact: true })).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  const manualEntry = page.getByRole('link', { name: 'Apri la cartella manualmente', exact: true });
  await expect(navigation.or(manualEntry).first()).toBeVisible();
  if (await manualEntry.isVisible()) await manualEntry.click();
  await expect(navigation).toBeVisible();
  expect((await page.request.get('/api/patients')).status()).toBe(200);
}

test('an account moved to a passphrase is unlocked by it, and the passphrase never reaches the network', async ({ page, browser, baseURL, browserName }) => {
  expect(browserName, 'The held answer needs Chromium: it must not be skipped silently').toBe('chromium');
  // Ordinary onboarding with a PIN: the provider generates and wraps the real master key.
  const setup = page.waitForRequest(request => isPost(request, '/api/auth/setup'));
  await bootstrapUnlockedSession(page, PIN);
  const pinWrapping = (await setup).postDataJSON() as { encryptedMasterKey: string; salt: string };
  const credential = passphraseCredential(openPinWrapping(pinWrapping.encryptedMasterKey, pinWrapping.salt));

  // Asked by another site with this browser's cookie, the move is refused.
  const foreign = await page.request.post('/api/auth/passphrase', {
    headers: { Origin: 'http://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' }, data: { currentPin: PIN, ...credential },
  });
  expect(foreign.status()).toBe(403);
  expect((await page.request.get('/api/patients')).status()).toBe(200);

  // Another browser reaches the lock screen while the account still unlocks with its PIN, and stays there.
  const stale = await browser.newContext({ baseURL });
  const stalePage = await stale.newPage();
  const staleLogins: string[] = [];
  stalePage.on('request', request => { if (isPost(request, '/api/auth/login')) staleLogins.push(request.postData() ?? ''); });
  await stalePage.goto('/');
  // The person starts typing while the field still says PIN; what they type is the passphrase they are about to set.
  const staleInput = stalePage.locator('#mediflow-lock-pin');
  await expect(stalePage.getByLabel('PIN operatore', { exact: true })).toBeEnabled();
  await staleInput.fill(PASSPHRASE);

  // The person submits there at the very moment of the move. The answer to "what unlocks this
  // account" is produced while it still says PIN, and is held here until the move is done: it is
  // the oldest answer the browser can act on. Chromium only: the response is paused, not replaced.
  const cdp = await stale.newCDPSession(stalePage);
  let heldCheck: string | undefined;
  cdp.on('Fetch.requestPaused', event => { heldCheck = event.requestId; });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: new URL('/api/auth/check', baseURL).href, requestStage: 'Response' }] });
  await staleInput.press('Enter');
  await expect.poll(() => heldCheck, 'the real answer of the server must reach the gate').toBeTruthy();

  const adopted = await page.request.post('/api/auth/passphrase', {
    headers: trustedWebRequestHeaders(baseURL), data: { currentPin: PIN, ...credential },
  });
  expect(adopted.status()).toBe(200);
  // The move retires the session of the page that asked.
  expect((await page.request.get('/api/patients')).status()).toBe(401);

  try {
    await cdp.send('Fetch.continueRequest', { requestId: heldCheck! });
    await cdp.send('Fetch.disable');
    // The answer said PIN, the field said PIN, and the account now has a passphrase. A text the
    // policy accepts as a passphrase is not sent as a PIN on the first gesture: it stays in the field.
    const notice = stalePage.locator('#mediflow-lock-confirm');
    const refusal = stalePage.locator('#mediflow-lock-error');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    await expect(staleInput).toHaveValue(PASSPHRASE);
    expect(staleLogins).toEqual([]);
    // On the second gesture the browser asks again, learns of the move and still sends nothing.
    await staleInput.press('Enter');
    await expect(refusal).toHaveText('Questo archivio ora si sblocca con la passphrase. Inseriscila.');
    await expect(notice).toHaveCount(0);
    await expect(stalePage.getByLabel('Passphrase', { exact: true })).toHaveValue('');
    expect(staleLogins).toEqual([]);
    // Typed into a field that says passphrase, it unlocks, and only its verifier travels.
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

  // The PIN is shorter than any passphrase: it cannot even be submitted.
  await field.fill(PIN);
  await expect(submit).toBeDisabled();

  await field.fill(`${PASSPHRASE}!`);
  const denied = page.waitForResponse(response => isPost(response.request(), '/api/auth/login'));
  await field.press('Enter');
  expect((await denied).status()).toBe(401);
  await expect(page.locator('#mediflow-lock-error')).toHaveText('Passphrase non valida. Tentativi rimasti: 4.');
  await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toHaveCount(0);

  await field.fill(PASSPHRASE);
  const accepted = page.waitForResponse(response => isPost(response.request(), '/api/auth/login'));
  await submit.click();
  const response = await accepted;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, encryptedMasterKey: credential.encryptedMasterKey, salt: credential.salt });
  // The shell is rendered only after the provider has opened the returned wrapping with the key it derived.
  await expectUnlocked(page);

  // The access settings describe the account as it is now, and no longer offer the PIN rotation the server refuses.
  await page.goto('/settings/accesso');
  await expect(page.getByTestId('settings-access-passphrase')).toContainText('Questo archivio si sblocca con la passphrase.');
  await expect(page.getByRole('button', { name: 'Aggiorna PIN', exact: true })).toHaveCount(0);
  await expect(page.getByText('Il blocco richiede la passphrase al prossimo accesso.')).toBeVisible();

  // Both attempts sent a verifier and nothing else; the accepted one is the value node:crypto derived.
  expect(logins).toHaveLength(2);
  for (const body of logins) {
    expect(Object.keys(JSON.parse(body))).toEqual(['verifier']);
    expect(body).not.toContain(PASSPHRASE);
  }
  expect(JSON.parse(logins[1])).toEqual({ verifier: credential.verifier });

  // A browser with no cookie, storage or key of the first one unlocks the same way.
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

test('a PIN as long as a passphrase still opens its archive, on a second gesture made while the notice is on screen', async ({ page, browser, baseURL }) => {
  // First setup accepts a PIN of any length: this account has one the policy would accept as a passphrase.
  await bootstrapUnlockedSession(page, LONG_PIN);

  const locked = await browser.newContext({ baseURL });
  try {
    const lockPage = await locked.newPage();
    const logins: string[] = [];
    lockPage.on('request', request => { if (isPost(request, '/api/auth/login')) logins.push(request.postData() ?? ''); });
    await lockPage.goto('/');
    const input = lockPage.locator('#mediflow-lock-pin');
    const notice = lockPage.locator('#mediflow-lock-confirm');
    await expect(lockPage.getByLabel('PIN operatore', { exact: true })).toBeEnabled();

    await input.fill(LONG_PIN);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    await expect(input).toHaveValue(LONG_PIN);
    // The second gesture is asked on this field: focus is back on it.
    await expect(input).toBeFocused();
    expect(logins).toEqual([]);

    // Another message takes the place of the notice, as when an old request of this page comes
    // back unauthorized. The confirmation goes with the notice: the next submit is a first gesture again.
    await lockPage.evaluate(() => window.dispatchEvent(new Event('mediflow:api-auth-unavailable')));
    await expect(lockPage.locator('#mediflow-lock-error')).toHaveText('Sessione scaduta.');
    await expect(notice).toHaveCount(0);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    expect(logins).toEqual([]);

    // An edit ends the confirmation even when the text is typed back before any submit: the
    // notice does not return by itself and the next submit is a first gesture again.
    await input.fill(`${LONG_PIN}!`);
    await expect(notice).toHaveCount(0);
    await input.fill(LONG_PIN);
    await expect(notice).toHaveCount(0);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    expect(logins).toEqual([]);

    // So does an editing gesture that leaves the same text, like pasting it over itself: the
    // value does not change, the confirmation still ends.
    await input.selectText();
    await lockPage.keyboard.insertText(LONG_PIN);
    await expect(input).toHaveValue(LONG_PIN);
    await expect(notice).toHaveCount(0);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    expect(logins).toEqual([]);

    // So does a key that edits nothing, like a deletion with nothing after the caret.
    await expect(input).toBeFocused();
    await input.evaluate((field: HTMLInputElement) => field.setSelectionRange(field.value.length, field.value.length));
    await lockPage.keyboard.press('Delete');
    await expect(input).toHaveValue(LONG_PIN);
    await expect(notice).toHaveCount(0);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    expect(logins).toEqual([]);

    // A changed text is another text: it is held in its turn. Confirmed from the keyboard
    // alone, it leaves as the PIN it claims to be, and the server refuses it.
    await input.fill(`${LONG_PIN}!`);
    await expect(notice).toHaveCount(0);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    expect(logins).toEqual([]);
    await expect(input).toBeFocused();
    await lockPage.keyboard.press('Enter');
    await expect(lockPage.locator('#mediflow-lock-error')).toBeVisible();
    expect(logins.map(body => JSON.parse(body))).toEqual([{ password: `${LONG_PIN}!` }]);

    // The unchanged text, submitted again under its notice, is the PIN and opens the archive.
    // Leaving the field for the button is not an edit: the second gesture can be made there.
    await input.fill(LONG_PIN);
    await input.press('Enter');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    await input.press('Tab');
    await expect(notice).toHaveText(LONG_PIN_NOTICE);
    await lockPage.getByRole('button', { name: 'Sblocca' }).click();
    await expectUnlocked(lockPage);
    expect(logins.map(body => JSON.parse(body))).toEqual([{ password: `${LONG_PIN}!` }, { password: LONG_PIN }]);
  } finally {
    await locked.close();
  }
});
