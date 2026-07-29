/* @Codex */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
/* @Codex */
import type {
    NetworkErrorResponse,
    NetworkPairedClientSummary,
    NetworkPairingConfirmationResponse,
    NetworkPairingIntentResponse,
} from './api/v1/types';
/* @Codex */
import { createConfirmedPairingResponse } from './network-contract';

/* @Codex */
export const NETWORK_PAIRING_STATE_KEY = 'network.pairing.state';
/* @Codex */
export const NETWORK_PAIRED_CLIENT_ID_HEADER = 'x-mediflow-paired-client-id';
/* @Codex */
export const NETWORK_PAIRED_CLIENT_TOKEN_HEADER = 'x-mediflow-paired-client-token';

type NetworkPairingErrorStatus = 404 | 409;

/* @Codex */
export type StoredNetworkPairedClient = NetworkPairedClientSummary & {
    sourceIntentId: string;
    tokenHash: string;
};

/* @Codex */
export type NetworkPairingState = {
    intents: NetworkPairingIntentResponse[];
    clients: StoredNetworkPairedClient[];
};

/* @Codex */
type ConfirmPairingSuccess = {
    ok: true;
    status: 201;
    value: NetworkPairingConfirmationResponse;
    nextState: NetworkPairingState;
};

/* @Codex */
type ConfirmPairingFailure = {
    ok: false;
    status: NetworkPairingErrorStatus;
    value: NetworkErrorResponse;
};

/* @Codex */
export type ConfirmPairingResult = ConfirmPairingSuccess | ConfirmPairingFailure;

/* @Codex */
type RemovePairedClientSuccess = {
    ok: true;
    status: 200;
    value: { removedClientId: string };
    nextState: NetworkPairingState;
};

/* @Codex */
type RemovePairedClientFailure = {
    ok: false;
    status: 404;
    value: Omit<NetworkErrorResponse, 'code'> & { code: 'PAIRING_CLIENT_NOT_FOUND' };
};

/* @Codex */
export type RemovePairedClientResult = RemovePairedClientSuccess | RemovePairedClientFailure;

const EMPTY_NETWORK_PAIRING_STATE: NetworkPairingState = {
    intents: [],
    clients: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function isIsoDateTime(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function parseRequestedCapabilities(value: unknown): string[] {
    return Array.isArray(value)
        ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
        : [];
}

function parsePairingIntent(value: unknown): NetworkPairingIntentResponse | null {
    if (!isObject(value)) return null;

    const requestedBy = isObject(value.requestedBy) ? value.requestedBy : null;
    if (!requestedBy) return null;

    const deviceName = typeof requestedBy.deviceName === 'string' ? requestedBy.deviceName.trim() : '';
    const clientPlatform = requestedBy.clientPlatform;
    if (!deviceName || (clientPlatform !== 'macos' && clientPlatform !== 'ios' && clientPlatform !== 'ipados')) {
        return null;
    }

    if (
        typeof value.intentId !== 'string'
        || value.status !== 'pending-home-base-confirmation'
        || typeof value.nodeId !== 'string'
        || typeof value.nodeDisplayName !== 'string'
        || typeof value.protocolVersion !== 'string'
        || !isIsoDateTime(value.requestedAt)
        || !isIsoDateTime(value.expiresAt)
    ) {
        return null;
    }

    return {
        intentId: value.intentId,
        status: 'pending-home-base-confirmation',
        nodeId: value.nodeId,
        nodeDisplayName: value.nodeDisplayName,
        protocolVersion: value.protocolVersion,
        requestedAt: value.requestedAt,
        expiresAt: value.expiresAt,
        requestedBy: {
            deviceName,
            clientPlatform,
            appVersion: typeof requestedBy.appVersion === 'string' && requestedBy.appVersion.trim().length > 0
                ? requestedBy.appVersion.trim()
                : null,
        },
        requestedCapabilities: parseRequestedCapabilities(value.requestedCapabilities),
    };
}

function parsePairedClient(value: unknown): StoredNetworkPairedClient | null {
    if (!isObject(value)) return null;
    const clientPlatform = value.clientPlatform;
    if (
        typeof value.clientId !== 'string'
        || typeof value.deviceName !== 'string'
        || (clientPlatform !== 'macos' && clientPlatform !== 'ios' && clientPlatform !== 'ipados')
        || !isIsoDateTime(value.pairedAt)
        || typeof value.sourceIntentId !== 'string'
        || typeof value.tokenHash !== 'string'
    ) {
        return null;
    }

    return {
        clientId: value.clientId,
        deviceName: value.deviceName,
        clientPlatform,
        appVersion: typeof value.appVersion === 'string' && value.appVersion.trim().length > 0
            ? value.appVersion.trim()
            : null,
        grantedCapabilities: parseRequestedCapabilities(value.grantedCapabilities),
        pairedAt: value.pairedAt,
        lastSeenAt: isIsoDateTime(value.lastSeenAt) ? value.lastSeenAt : null,
        sourceIntentId: value.sourceIntentId,
        tokenHash: value.tokenHash,
    };
}

/* @Codex */
export function parseNetworkPairingState(
    rawValue: string | null | undefined,
    now: Date = new Date()
): NetworkPairingState {
    if (!rawValue) return EMPTY_NETWORK_PAIRING_STATE;

    try {
        const parsed = JSON.parse(rawValue) as Record<string, unknown>;
        const intents = Array.isArray(parsed.intents)
            ? parsed.intents.map(parsePairingIntent).filter((item): item is NetworkPairingIntentResponse => item !== null)
            : [];
        const clients = Array.isArray(parsed.clients)
            ? parsed.clients.map(parsePairedClient).filter((item): item is StoredNetworkPairedClient => item !== null)
            : [];

        return pruneExpiredPairingIntents({ intents, clients }, now);
    } catch {
        return EMPTY_NETWORK_PAIRING_STATE;
    }
}

/* @Codex */
export function serializeNetworkPairingState(state: NetworkPairingState): string {
    return JSON.stringify(state);
}

/* @Codex */
export function pruneExpiredPairingIntents(
    state: NetworkPairingState,
    now: Date = new Date()
): NetworkPairingState {
    const cutoff = now.getTime();
    return {
        intents: state.intents.filter((intent) => new Date(intent.expiresAt).getTime() > cutoff),
        clients: state.clients,
    };
}

/* @Codex */
export function addPendingPairingIntent(
    state: NetworkPairingState,
    intent: NetworkPairingIntentResponse,
    now: Date = new Date()
): NetworkPairingState {
    const next = pruneExpiredPairingIntents(state, now);
    return {
        intents: [...next.intents.filter((item) => item.intentId !== intent.intentId), intent],
        clients: next.clients,
    };
}

/* @Codex */
export function hashNetworkPairedClientToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function notFoundError(): ConfirmPairingFailure {
    return {
        ok: false,
        status: 404,
        value: {
            error: 'Not Found',
            code: 'PAIRING_INTENT_NOT_FOUND',
            message: 'Pairing intent not found.',
        },
    };
}

function expiredError(): ConfirmPairingFailure {
    return {
        ok: false,
        status: 409,
        value: {
            error: 'Conflict',
            code: 'PAIRING_INTENT_EXPIRED',
            message: 'Pairing intent has expired and must be requested again.',
        },
    };
}

/* @Codex */
export function confirmPendingPairingIntent(input: {
    state: NetworkPairingState;
    intentId: string;
    now?: Date;
}): ConfirmPairingResult {
    const requestedAt = input.now ?? new Date();
    const originalIntent = input.state.intents.find((item) => item.intentId === input.intentId);
    if (!originalIntent) return notFoundError();

    if (new Date(originalIntent.expiresAt).getTime() <= requestedAt.getTime()) {
        return expiredError();
    }

    const clientId = randomUUID();
    const pairedClientToken = randomBytes(24).toString('base64url');
    const pairedAt = requestedAt.toISOString();
    const nextClient: StoredNetworkPairedClient = {
        clientId,
        deviceName: originalIntent.requestedBy.deviceName,
        clientPlatform: originalIntent.requestedBy.clientPlatform,
        appVersion: originalIntent.requestedBy.appVersion,
        grantedCapabilities: originalIntent.requestedCapabilities,
        pairedAt,
        lastSeenAt: null,
        sourceIntentId: originalIntent.intentId,
        tokenHash: hashNetworkPairedClientToken(pairedClientToken),
    };

    const nextState: NetworkPairingState = {
        intents: input.state.intents.filter((item) => item.intentId !== input.intentId),
        clients: [...input.state.clients.filter((item) => item.clientId !== clientId), nextClient],
    };

    return {
        ok: true,
        status: 201,
        value: createConfirmedPairingResponse({
            intent: originalIntent,
            clientId,
            pairedAt,
            pairedClientToken,
        }),
        nextState,
    };
}

/* @Codex */
export function removePairedClient(
    state: NetworkPairingState,
    clientId: string,
): RemovePairedClientResult {
    if (!state.clients.some((client) => client.clientId === clientId)) {
        return {
            ok: false,
            status: 404,
            value: {
                error: 'Not Found',
                code: 'PAIRING_CLIENT_NOT_FOUND',
                message: 'Paired client not found.',
            },
        };
    }

    return {
        ok: true,
        status: 200,
        value: { removedClientId: clientId },
        nextState: {
            intents: state.intents,
            clients: state.clients.filter((client) => client.clientId !== clientId),
        },
    };
}
