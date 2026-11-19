import { randomUUID } from 'node:crypto';
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

type DocumentRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  data?: unknown;
  binary?: boolean;
};

export async function requestInDocument(page: Page, path: string, options: DocumentRequestOptions = {}) {
  const { method = 'GET', headers, data, binary = false } = options;
  const body = data === undefined ? undefined : Buffer.isBuffer(data) ? data.toString('utf8')
    : typeof data === 'string' ? data : JSON.stringify(data);
  const result = await page.evaluate(async ({ path, method, headers, body, binary }) => {
    const url = new URL(path, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
      throw new Error('Expected a same-origin API path.');
    }
    const response = await fetch(url, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body,
    });
    if (!binary || !response.ok) return { status: response.status, text: await response.text() };
    const bytes = new Uint8Array(await response.arrayBuffer());
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    }
    return { status: response.status, text: btoa(chunks.join('')), base64: true };
  }, { path, method, headers, body, binary });
  return {
    status: () => result.status,
    ok: () => result.status >= 200 && result.status < 300,
    text: async () => result.text,
    json: async () => JSON.parse(result.text),
    body: async () => Buffer.from(result.text, result.base64 ? 'base64' : 'utf8'),
  };
}

export function documentRequests(page: Page) {
  return {
    get: (path: string, options?: DocumentRequestOptions) => requestInDocument(page, path, options),
    post: (path: string, options?: DocumentRequestOptions) => requestInDocument(page, path, { ...options, method: 'POST' }),
    put: (path: string, options?: DocumentRequestOptions) => requestInDocument(page, path, { ...options, method: 'PUT' }),
    delete: (path: string, options?: DocumentRequestOptions) => requestInDocument(page, path, { ...options, method: 'DELETE' }),
    fetch: (path: string, options?: DocumentRequestOptions) => requestInDocument(page, path, options),
  };
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

export async function reviewedRestoreHeaders(page: Page, data: string | Buffer) {
  const response = await requestInDocument(page, '/api/system/backup-restore/verify', { method: 'POST', data });
  expect(response.status(), await response.text()).toBe(200);
  const { expectedSnapshot, sourceChecksum } = await response.json();
  return {
    'x-mediflow-restore-id': randomUUID(),
    'x-mediflow-restore-snapshot': expectedSnapshot,
    'x-mediflow-restore-source-checksum': sourceChecksum,
    'x-mediflow-restore-confirmation': 'RIPRISTINA',
  };
}
