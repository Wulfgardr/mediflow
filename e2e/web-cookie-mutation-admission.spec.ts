import { expect, test } from './fixtures/isolated-runtime';
import { trustedWebRequestHeaders } from './fixtures/trusted-web-request';
import { bootstrapUnlockedSession } from './utils';

test('standalone cookie admission rejects hostile logout before retiring the Web session', async ({ page, baseURL }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
  const request = page.context().request;
  // Keep the authenticated cookie jar, without UI polling or recovery during logout.
  await page.close();

  expect((await request.get('/api/patients')).status()).toBe(200);
  const trusted = trustedWebRequestHeaders(baseURL);
  const deniedTransports = [
    { name: 'cross-origin', headers: { ...trusted, Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' } },
    { name: 'unsupported media type', headers: { ...trusted, 'Content-Type': 'text/plain' } },
  ];

  // Logout has no duplicate transport guard. Without the packaged proxy these
  // requests retire the session, so both the denial and absence of effects matter.
  for (const { name, headers } of deniedTransports) {
    const denied = await request.post('/api/auth/logout', { headers, data: '{}' });
    expect(denied.status(), name).toBe(403);
    expect(denied.headers()['cache-control'], name).toBe('no-store');
    expect(await denied.json(), name).toEqual({
      error: 'Request transport unavailable',
      code: 'request_transport_invalid',
    });
    expect((await request.get('/api/patients')).status(), `${name} must not retire the session`).toBe(200);
  }

  const accepted = await request.post('/api/auth/logout', {
    headers: { ...trusted, 'Content-Type': 'application/json' },
    data: '{}',
  });
  expect(accepted.status()).toBe(204);
  expect(await accepted.text()).toBe('');
  expect((await request.get('/api/patients')).status()).toBe(401);
});
