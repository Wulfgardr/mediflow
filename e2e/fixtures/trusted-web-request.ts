import { expect, type Page } from '@playwright/test';

/* APIRequestContext does not synthesize browser Fetch Metadata. */
export function trustedWebRequestHeaders(baseURL: string | undefined): Record<string, string> {
  if (!baseURL) throw new Error('A base URL is required for trusted Web test requests.');
  const url = new URL(baseURL);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Trusted Web test requests require an HTTP(S) base URL.');
  }
  return { Origin: url.origin, 'Sec-Fetch-Site': 'same-origin' };
}

// Capture once after unlock; keep this identity for every seed/replay in the flow.
// Never refresh it per mutation: an archive replacement must remain observable.
export async function trustedArchiveWebRequestHeaders(page: Page): Promise<Record<string, string>> {
  const response = await page.request.get(new URL('/api/auth/check', page.url()).href);
  expect(response.status()).toBe(200);
  const control = await response.json();
  expect(control.hasSession).toBe(true);
  expect(control.archiveGeneration).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  return Object.freeze({ ...trustedWebRequestHeaders(page.url()), 'x-mediflow-archive-generation': control.archiveGeneration });
}
