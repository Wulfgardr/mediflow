import type { NetworkPairedClientSummary } from './api/v1/types';

export const PAIRING_OFFERS_KEY = 'network.pairing.offers';
export const PAIRING_OFFER_REQUEST_MAX_BYTES = 2048;

export const PAIRING_OFFER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const PAIRING_OFFER_SECRET = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;

export type DevicePairingOffer = { link: string; expiresAt: string };
export type DevicePairingList = { clients: NetworkPairedClientSummary[] };
export type DevicePairingRedemption = { clientId: string; pairedClientToken: string };

export type DevicePairingClaim = {
    offerId: string;
    secret: string;
    deviceName: string;
    clientPlatform: 'macos' | 'ios' | 'ipados';
};

export function readDevicePairingClaim(value: unknown): DevicePairingClaim | null {
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'clientPlatform,deviceName,offerId,secret') return null;
    const { offerId, secret, deviceName, clientPlatform } = value as Record<string, unknown>;
    if (typeof offerId !== 'string' || offerId.length !== 36 || !PAIRING_OFFER_ID.test(offerId)
        || typeof secret !== 'string' || secret.length !== 43 || !PAIRING_OFFER_SECRET.test(secret)
        || typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 64 || /\p{C}/u.test(deviceName)
        || (clientPlatform !== 'macos' && clientPlatform !== 'ios' && clientPlatform !== 'ipados')) return null;
    return { offerId, secret, deviceName: deviceName.trim(), clientPlatform };
}
