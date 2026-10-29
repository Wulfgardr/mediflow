import { isLocalUiPairingRequest } from './plugin-local-ui-pairing-request';

export function localUiLeaseRequest(request: Request, value: unknown): { tab: string; action: 'renew' | 'release' } | null {
    if (!isLocalUiPairingRequest(request, true) || !value || typeof value !== 'object') return null;
    const input = value as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'action,tab' || typeof input.tab !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(input.tab)
        || input.action !== 'renew' && input.action !== 'release') return null;
    return { tab: input.tab, action: input.action };
}
