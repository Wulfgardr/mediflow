import 'server-only';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { assertArchiveGeneration } from './archive-generation';
import { dbServer, runDbServerImmediateTransaction } from './db-server';
import { buildNetworkCapabilitiesResponse, NETWORK_MODE_KEY } from './network-contract';
import { mutateNetworkPairingState } from './network-home-base-server';
import { createNetworkPairedClient } from './network-pairing-model';
import type { NetworkPairingEndpoint } from './network-pairing-endpoint';
import { PAIRING_OFFERS_KEY, type DevicePairingClaim, type DevicePairingOffer, type DevicePairingRedemption } from './network-pairing-offer-contract';
import { settings } from './schema';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { writeAuditEventInTransaction } from './security/audit';

const MAX_ACTIVE_OFFERS = 4;
const OFFER_LIFETIME_MS = 5 * 60 * 1000;
const MISSING_OFFER_HASH = Buffer.alloc(32);

type Offer = { id: string; secretHash: string; expiresAt: number };
type PairingOfferIssue = DevicePairingOffer | 'capacity' | 'disabled';
type PairingOfferRedemption = DevicePairingRedemption | 'unavailable' | 'disabled' | 'conflict';

class PairingOfferExpired extends Error {}
class PairingDisabled extends Error {}

function readSetting(key: string): string | undefined {
    return dbServer.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value;
}

function networkEnabled(): boolean {
    return readSetting(NETWORK_MODE_KEY) === 'network-home-base';
}

function readOffers(generation: string): Offer[] {
    const raw = readSetting(PAIRING_OFFERS_KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw) as { archiveGeneration: string; offers: Offer[] };
    return stored.archiveGeneration === generation ? stored.offers : [];
}

function saveOffers(offers: Offer[], archiveGeneration: string): void {
    const value = JSON.stringify({ archiveGeneration, offers });
    dbServer.insert(settings).values({ key: PAIRING_OFFERS_KEY, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

function hashSecret(secret: string): Buffer {
    return createHash('sha256').update(secret).digest();
}

export function issueDevicePairingOffer(input: {
    archiveGeneration: string;
    actorRef: string;
    endpoint: NetworkPairingEndpoint;
}): PairingOfferIssue {
    const { archiveGeneration, actorRef, endpoint } = input;
    return runDbServerImmediateTransaction(() => {
        assertArchiveGeneration(dbServer, archiveGeneration);
        if (!networkEnabled()) return 'disabled';
        const now = Date.now();
        const offers = readOffers(archiveGeneration).filter(offer => offer.expiresAt > now);
        if (offers.length >= MAX_ACTIVE_OFFERS) return 'capacity';
        const id = randomUUID();
        const secret = randomBytes(32).toString('base64url');
        const expiresAt = now + OFFER_LIFETIME_MS;
        saveOffers([...offers, { id, secretHash: hashSecret(secret).toString('hex'), expiresAt }], archiveGeneration);
        writeAuditEventInTransaction(dbServer, {
            eventType: 'network.pairing.offer.created',
            outcome: 'success',
            actorType: 'user',
            actorRef,
            subjectType: 'network_pairing',
            subjectRef: id,
            sourceSurface: 'web',
            archiveGeneration,
        });
        const link = new URL('mediflow://collega');
        link.search = new URLSearchParams({ ...endpoint, id, secret }).toString().replaceAll('+', '%20');
        return { link: link.href, expiresAt: new Date(expiresAt).toISOString() };
    });
}

function matchingOffer(offers: Offer[], id: string, presentedHash: Buffer): Offer | undefined {
    const offer = offers.find(candidate => candidate.id === id);
    const storedHash = offer ? Buffer.from(offer.secretHash, 'hex') : MISSING_OFFER_HASH;
    const matches = timingSafeEqual(presentedHash, storedHash);
    return matches && offer && offer.expiresAt > Date.now() ? offer : undefined;
}

export async function redeemDevicePairingOffer(claim: DevicePairingClaim): Promise<PairingOfferRedemption> {
    if (!networkEnabled()) return 'disabled';
    const archiveGeneration = currentArchiveGeneration();
    const presentedHash = hashSecret(claim.secret);
    if (!matchingOffer(readOffers(archiveGeneration), claim.offerId, presentedHash)) return 'unavailable';
    const grantedCapabilities = buildNetworkCapabilitiesResponse({
        nodeId: '',
        snapshot: { [NETWORK_MODE_KEY]: 'network-home-base' },
        platform: process.platform,
    }).capabilities.filter(capability => capability.requiresPairing && capability.status === 'available')
        .map(capability => capability.key);

    try {
        const persisted = await mutateNetworkPairingState<PairingOfferRedemption>(state => {
            if (!matchingOffer(readOffers(archiveGeneration), claim.offerId, presentedHash)) {
                return { write: false, result: 'unavailable' };
            }
            const { client, pairedClientToken } = createNetworkPairedClient({
                sourceIntentId: claim.offerId,
                clientPlatform: claim.clientPlatform,
                deviceName: claim.deviceName,
                appVersion: null,
                grantedCapabilities,
                now: new Date(),
            });
            return {
                write: true,
                nextState: { ...state, clients: [...state.clients, client] },
                result: { clientId: client.clientId, pairedClientToken },
                commit() {
                    if (!networkEnabled()) throw new PairingDisabled();
                    const offers = readOffers(archiveGeneration);
                    if (!matchingOffer(offers, claim.offerId, presentedHash)) throw new PairingOfferExpired();
                    saveOffers(offers.filter(offer => offer.id !== claim.offerId), archiveGeneration);
                    writeAuditEventInTransaction(dbServer, {
                        eventType: 'network.pairing.offer.redeemed',
                        outcome: 'success',
                        actorType: 'system',
                        actorRef: client.clientId,
                        subjectType: 'network_pairing',
                        subjectRef: claim.offerId,
                        sourceSurface: 'native',
                        archiveGeneration,
                    });
                },
            };
        }, archiveGeneration);
        return persisted.conflict ? 'conflict' : persisted.result;
    } catch (error) {
        if (error instanceof PairingOfferExpired) return 'unavailable';
        if (error instanceof PairingDisabled) return 'disabled';
        throw error;
    }
}
