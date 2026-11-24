import { getNetworkOperatingMode, loadNetworkPairingState, loadNetworkSettingsSnapshot } from '@/lib/network-home-base-server';
import { readNetworkPairingEndpoint } from '@/lib/network-pairing-endpoint';
import { issueDevicePairingOffer } from '@/lib/network-pairing-offers-server';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';
import { requireDevicePairingAdminSession } from '@/lib/security/device-pairing-web-auth';
import { verifyHostCredentials } from '@/lib/security/host-credential-verification';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
    try {
        if (!await requireDevicePairingAdminSession(request, false)) return reply({ code: 'LOCAL_ADMIN_REQUIRED' }, 403);
        const { clients } = await loadNetworkPairingState();
        return reply({ clients: clients.map(({ clientId, deviceName, clientPlatform, appVersion,
            grantedCapabilities, pairedAt, lastSeenAt }) =>
            ({ clientId, deviceName, clientPlatform, appVersion, grantedCapabilities, pairedAt, lastSeenAt })) });
    } catch {
        return reply({ code: 'PAIRING_UNAVAILABLE' }, 503);
    }
}

export async function POST(request: Request) {
    try {
        const access = await requireDevicePairingAdminSession(request, true);
        if (!access) return reply({ code: 'LOCAL_ADMIN_REQUIRED' }, 403);
        const payload = await readNativeNetworkJson(request, 128, {
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(2000)]),
            deadline: performance.now() + 2000, sensitive: true,
        }).catch(() => null);
        const pin = (payload as { pin?: unknown } | null)?.pin;
        if (!payload || Object.keys(payload).join(',') !== 'pin' || typeof pin !== 'string'
            || !/^[0-9]{4,8}$/u.test(pin) || /\s/u.test(pin)) return reply({ code: 'PIN_INVALID' }, 400);

        const verified = await verifyHostCredentials({ username: access.session.username, pin });
        if (verified.kind !== 'verified' || verified.account.id !== access.session.userId) {
            return reply({ code: 'PIN_DENIED' }, 403);
        }
        if (await getNetworkOperatingMode() !== 'network-home-base') return reply({ code: 'NETWORK_MODE_DISABLED' }, 409);
        const endpoint = await readNetworkPairingEndpoint((await loadNetworkSettingsSnapshot()).clinicName);
        if (!endpoint) return reply({ code: 'PAIRING_ENDPOINT_UNAVAILABLE' }, 409);
        const current = await requireDevicePairingAdminSession(request, true);
        if (!current || current.session.id !== access.session.id || current.session.userId !== access.session.userId
            || current.generation !== access.generation) return reply({ code: 'LOCAL_ADMIN_REQUIRED' }, 403);
        const offer = issueDevicePairingOffer({ archiveGeneration: current.generation, actorRef: current.session.userId, endpoint });
        if (offer === 'capacity') return reply({ code: 'PAIRING_OFFERS_FULL' }, 409);
        if (offer === 'disabled') return reply({ code: 'NETWORK_MODE_DISABLED' }, 409);
        return reply(offer, 201);
    } catch {
        return reply({ code: 'PAIRING_UNAVAILABLE' }, 503);
    }
}
