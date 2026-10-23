import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession } from './utils';

test.use({ pluginLocalUiRuntime: true });

test('trusted UI consent binds an ephemeral navigation capability and revokes it', async ({ page, isolatedRuntime }, testInfo) => {
  await bootstrapUnlockedSession(page, '1234');
  const pair = isolatedRuntime.offerPairing();
  await expect(page.getByText('Consenti a Codex/Claude di aprire schermate qui?', { exact: true })).toBeVisible();
  await testInfo.attach('pairing-confirmation', { body: await page.screenshot(), contentType: 'image/png' });
  expect(await isolatedRuntime.usePairing(pair.nonce, pair.host)).toBe('denied');
  await page.getByLabel('Codice di abbinamento', { exact: true }).fill('a'.repeat(24));
  await page.getByRole('button', { name: 'Consenti', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  expect(await isolatedRuntime.usePairing(pair.nonce, pair.host)).toBe('denied');
  await page.getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revoca il collegamento del plugin', exact: true })).toBeVisible();
  expect(await isolatedRuntime.usePairing(pair.nonce, pair.host)).toBe('accepted');
  expect(await isolatedRuntime.usePairing(pair.nonce, 'b'.repeat(36))).toBe('denied');
  await page.getByRole('button', { name: 'Revoca il collegamento del plugin', exact: true }).click();
  await expect.poll(() => isolatedRuntime.usePairing(pair.nonce, pair.host)).toBe('denied');
  isolatedRuntime.offerPairing({ nonce: pair.nonce });
  await expect(page.getByRole('button', { name: 'Consenti', exact: true })).toHaveCount(0);
});

test('refusal, expiry, different instance and application lock deny navigation', async ({ page, isolatedRuntime }) => {
  await bootstrapUnlockedSession(page, '1234');
  const refused = isolatedRuntime.offerPairing();
  await page.getByRole('button', { name: 'Rifiuta', exact: true }).click();
  expect(await isolatedRuntime.usePairing(refused.nonce, refused.host)).toBe('denied');
  const expired = isolatedRuntime.offerPairing({ expiresIn: 1200 });
  await expect(page.getByRole('button', { name: 'Consenti', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Consenti', exact: true })).toHaveCount(0);
  expect(await isolatedRuntime.usePairing(expired.nonce, expired.host)).toBe('denied');
  const other = isolatedRuntime.offerPairing({ instance: 'another-instance' });
  expect(await isolatedRuntime.usePairing(other.nonce, other.host)).toBe('denied');
  const locked = isolatedRuntime.offerPairing();
  await page.getByLabel('Codice di abbinamento', { exact: true }).fill('a'.repeat(24));
  await page.getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revoca il collegamento del plugin', exact: true })).toBeVisible();
  expect(await isolatedRuntime.usePairing(locked.nonce, locked.host)).toBe('accepted');
  await page.getByRole('button', { name: 'Blocca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
  expect(await isolatedRuntime.usePairing(locked.nonce, locked.host)).toBe('denied');
});
