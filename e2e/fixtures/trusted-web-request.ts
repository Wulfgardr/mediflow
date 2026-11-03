import { expect, type Page, type Route } from '@playwright/test';

/* APIRequestContext does not synthesize browser Origin or Fetch Metadata, so a
   test that wants a Web mutation admitted passes these headers on that call.
   Never set them as context extraHTTPHeaders: the browser would send them on
   every request, hiding its real metadata, and Chrome 156+ fails every
   subresource with net::ERR_INVALID_ARGUMENT when Sec-Fetch-Site is forged. */
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

/* route.fetch() replays an intercepted browser request through APIRequestContext.
   Playwright intercepts it before the network stack adds Fetch Metadata, so the
   replay keeps the browser's Origin but loses Sec-Fetch-Site. Restore the value
   the browser sends when the page and the target share an origin; otherwise the
   replay keeps only what the browser actually produced. */
export function fetchInterceptedRequest(route: Route, options: Parameters<Route['fetch']>[0] = {}) {
  const request = route.request();
  const headers: Record<string, string> = { ...request.headers(), ...options.headers };
  const target = new URL(options.url ?? request.url()).origin;
  let initiator = headers.origin;
  if (!initiator && !request.isNavigationRequest()) {
    try { initiator = new URL(request.frame().url()).origin; } catch { /* worker or detached frame */ }
  }
  if (initiator === target && !Object.keys(headers).some((name) => name.toLowerCase() === 'sec-fetch-site')) {
    headers['sec-fetch-site'] = 'same-origin';
  }
  return route.fetch({ ...options, headers });
}
