import { jsonBodyTooLargeResponse, readNativeNetworkJson } from '@/lib/native-network-json-body';
import { PAIRING_OFFER_REQUEST_MAX_BYTES, readDevicePairingClaim } from '@/lib/network-pairing-offer-contract';
import { redeemDevicePairingOffer } from '@/lib/network-pairing-offers-server';
import { requireAttestedTlsProxyContext } from '@/lib/security/loopback-ingress.mjs';

const MAX_IN_FLIGHT = 8;
let inFlight = 0;

const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const invalid = () => reply({ error: 'Bad Request', code: 'PAIRING_REQUEST_INVALID', message: 'Invalid pairing claim.' }, 400);
const busy = () => reply({ error: 'Pairing temporarily unavailable', code: 'PAIRING_STATE_CONFLICT' }, 503);

export async function POST(request: Request) {
    if (!requireAttestedTlsProxyContext(request)) return reply({ error: 'HTTPS required', code: 'PAIRING_HTTPS_REQUIRED' }, 403);
    if (request.headers.get('content-type')?.toLowerCase() !== 'application/json') return invalid();
    if (inFlight >= MAX_IN_FLIGHT) return busy();
    inFlight++;
    try {
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(2000)]);
        let payload: unknown;
        try {
            payload = await readNativeNetworkJson(request, PAIRING_OFFER_REQUEST_MAX_BYTES, {
                signal, deadline: performance.now() + 2000, sensitive: true,
            });
        } catch (error) {
            return jsonBodyTooLargeResponse(error) ?? invalid();
        }
        const claim = readDevicePairingClaim(payload);
        if (!claim || signal.aborted) return invalid();
        const result = await redeemDevicePairingOffer(claim);
        if (result === 'unavailable') return reply({ error: 'Pairing offer unavailable', code: 'PAIRING_OFFER_UNAVAILABLE' }, 404);
        if (result === 'disabled') return reply({ error: 'Conflict', code: 'NETWORK_MODE_DISABLED', message: 'Home-base network mode is not enabled on this node.' }, 409);
        if (result === 'conflict') return busy();
        return reply(result, 201);
    } catch {
        return busy();
    } finally {
        inFlight--;
    }
}
