/* @Codex: APIRequestContext does not synthesize browser Fetch Metadata. */
export function trustedWebRequestHeaders(baseURL: string | undefined): Record<string, string> {
  if (!baseURL) throw new Error('A base URL is required for trusted Web test requests.');
  const url = new URL(baseURL);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Trusted Web test requests require an HTTP(S) base URL.');
  }
  return { Origin: url.origin, 'Sec-Fetch-Site': 'same-origin' };
}
