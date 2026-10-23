import { isTrustedWebMutationRequest } from './request-transport';

export function isLocalUiPairingRequest(request: Request, write = false): boolean {
  try {
    const url = new URL(request.url);
    const host = request.headers.get('host') ?? url.host;
    if (/[\s/@\\]/u.test(host)) return false;
    if (new URL(`${url.protocol}//${host}`).hostname !== '127.0.0.1') return false;
    if (!['same-origin', 'none'].includes(request.headers.get('sec-fetch-site') ?? '')) return false;
    return !write || isTrustedWebMutationRequest(request);
  } catch { return false; }
}
