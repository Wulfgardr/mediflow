/* @Codex */
import { timingSafeEqual } from 'node:crypto';
/* @Codex */
import {
    hashNetworkPairedClientToken,
    NETWORK_PAIRED_CLIENT_ID_HEADER,
    NETWORK_PAIRED_CLIENT_TOKEN_HEADER,
    type StoredNetworkPairedClient,
} from './network-pairing-model.ts';

function extractNetworkPairedClientCredentials(request: Request): {
    clientId: string;
    pairedClientToken: string;
} | null {
    const clientId = request.headers.get(NETWORK_PAIRED_CLIENT_ID_HEADER)?.trim() ?? '';
    const pairedClientToken = request.headers.get(NETWORK_PAIRED_CLIENT_TOKEN_HEADER)?.trim() ?? '';
    if (!clientId || !pairedClientToken) return null;

    return {
        clientId,
        pairedClientToken,
    };
}

function safeEqualHex(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return timingSafeEqual(leftBuffer, rightBuffer);
}

/* @Codex */
export function authenticatePairedClientRequest(
    request: Request,
    clients: StoredNetworkPairedClient[]
): StoredNetworkPairedClient | null {
    const credentials = extractNetworkPairedClientCredentials(request);
    if (!credentials) return null;

    const matchedClient = clients.find((client) => client.clientId === credentials.clientId);
    if (!matchedClient) return null;

    const tokenHash = hashNetworkPairedClientToken(credentials.pairedClientToken);
    return safeEqualHex(matchedClient.tokenHash, tokenHash) ? matchedClient : null;
}
