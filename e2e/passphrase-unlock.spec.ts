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

test('an account moved to a passphrase is unlocked by it, and the passphrase never reaches the network', async ({ page, browser, baseURL }) => {
  // Ordinary onboarding with a PIN: the provider generates and wraps the real master key.
  const setup = page.waitForRequest(request => isPost(request, '/api/auth/setup'));
  await bootstrapUnlockedSession(page, PIN);
  const pinWrapping = (await setup).postDataJSON() as { encryptedMasterKey: string; salt: string };
  const credential = passphraseCredential(openPinWrapping(pinWrapping.encryptedMasterKey, pinWrapping.salt));

  const adopted = await page.request.post('/api/auth/passphrase', {
    headers: trustedWebRequestHeaders(baseURL), data: { currentPin: PIN, ...credential },
  });
  expect(adopted.status()).toBe(200);
  // The move retires the session of the page that asked.
  expect((await page.request.get('/api/patients')).status()).toBe(401);

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
