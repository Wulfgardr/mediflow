/* @Codex */
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import type {
    NetworkCapabilitiesResponse,
    NetworkAiRuntimeSummary,
    NetworkIdentitySummary,
    NetworkNodeSummary,
    NetworkPairingConfirmationResponse,
    NetworkPairingIntentResponse,
    NetworkSessionSummary,
} from '@/lib/api/v1/types';
import {
    buildNetworkCapabilitiesResponse,
    buildNetworkNodeSummary,
    buildNetworkSessionSummary,
    createPairingIntentDraft,
    NETWORK_MODE_KEY,
    NETWORK_NODE_ID_KEY,
    NETWORK_SETTINGS_KEYS,
    normalizeNetworkOperatingMode,
    type PairingIntentDraftResult,
} from '@/lib/network-contract';
/* @Codex */
import {
    addPendingPairingIntent,
    confirmPendingPairingIntent,
    NETWORK_PAIRING_STATE_KEY,
    parseNetworkPairingState,
    serializeNetworkPairingState,
    type NetworkPairingState,
} from '@/lib/network-pairing-model';
/* @Codex */
import { getNetworkAiRuntimeSummary as resolveNetworkAiRuntimeSummary } from '@/lib/network-ai-runtime';
/* @Codex */
import { getNetworkIdentitySummary as resolveNetworkIdentitySummary } from '@/lib/network-identity';
/* @Codex */
import type { ServerSession } from '@/lib/server-session';
/* @Codex */
import { authenticatePairedClientRequest } from '@/lib/network-paired-client-auth';

type NetworkSettingsSnapshot = Partial<Record<(typeof NETWORK_SETTINGS_KEYS)[number], string>>;

async function saveSetting(key: string, value: string): Promise<void> {
    await dbServer
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
}

async function loadSettingValue(key: string): Promise<string | null> {
    const row = await dbServer
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .get();

    return row?.value ?? null;
}

export async function loadNetworkSettingsSnapshot(): Promise<NetworkSettingsSnapshot> {
    const rows = await dbServer
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, [...NETWORK_SETTINGS_KEYS]));

    return rows.reduce<NetworkSettingsSnapshot>((accumulator, row) => {
        accumulator[row.key as keyof NetworkSettingsSnapshot] = row.value;
        return accumulator;
    }, {});
}

export async function ensureNetworkNodeId(snapshot?: NetworkSettingsSnapshot): Promise<string> {
    const fromSnapshot = snapshot?.[NETWORK_NODE_ID_KEY];
    if (fromSnapshot) return fromSnapshot;

    const existing = await dbServer
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, NETWORK_NODE_ID_KEY))
        .get();
    if (existing?.value) return existing.value;

    const generated = randomUUID();
    await saveSetting(NETWORK_NODE_ID_KEY, generated);
    return generated;
}

export async function getNetworkNodeSummary(): Promise<NetworkNodeSummary> {
    const snapshot = await loadNetworkSettingsSnapshot();
    const nodeId = await ensureNetworkNodeId(snapshot);
    return buildNetworkNodeSummary({
        nodeId,
        snapshot,
        hostName: os.hostname(),
    });
}

export async function getNetworkSessionSummary(): Promise<NetworkSessionSummary> {
    const snapshot = await loadNetworkSettingsSnapshot();
    const nodeId = await ensureNetworkNodeId(snapshot);
    const pairingState = await loadNetworkPairingState();
    return buildNetworkSessionSummary({
        nodeId,
        snapshot,
        hasPairedClients: pairingState.clients.length > 0,
    });
}

export async function getNetworkCapabilities(): Promise<NetworkCapabilitiesResponse> {
    const snapshot = await loadNetworkSettingsSnapshot();
    const nodeId = await ensureNetworkNodeId(snapshot);
    const operatingMode = normalizeNetworkOperatingMode(snapshot[NETWORK_MODE_KEY]);
    const aiRuntime = await resolveNetworkAiRuntimeSummary(operatingMode);
    return buildNetworkCapabilitiesResponse({
        nodeId,
        snapshot,
        platform: process.platform,
        aiCentralRuntimeStatus: aiRuntime.centralRuntime.capabilityStatus,
    });
}

/* @Codex */
export async function getNetworkAiRuntimeSummary(): Promise<NetworkAiRuntimeSummary> {
    return resolveNetworkAiRuntimeSummary();
}

/* @Codex */
export async function getNetworkIdentitySummary(
    session: ServerSession | null,
    activeAmbulatoryId: string | null
): Promise<NetworkIdentitySummary> {
    return resolveNetworkIdentitySummary(session, activeAmbulatoryId);
}

/* @Codex */
export async function loadNetworkPairingState(): Promise<NetworkPairingState> {
    const rawValue = await loadSettingValue(NETWORK_PAIRING_STATE_KEY);
    return parseNetworkPairingState(rawValue);
}

async function saveNetworkPairingState(state: NetworkPairingState): Promise<void> {
    await saveSetting(NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState(state));
}

export async function postNetworkPairingIntent(payload: unknown): Promise<PairingIntentDraftResult> {
    const snapshot = await loadNetworkSettingsSnapshot();
    const nodeId = await ensureNetworkNodeId(snapshot);
    const nodeSummary = buildNetworkNodeSummary({
        nodeId,
        snapshot,
        hostName: os.hostname(),
    });

    const result = createPairingIntentDraft({
        nodeSummary,
        snapshot,
        payload,
    });
    if (result.ok) {
        const pairingState = await loadNetworkPairingState();
        await saveNetworkPairingState(addPendingPairingIntent(pairingState, result.value));
    }

    return result;
}

/* @Codex */
export async function listNetworkPairingIntents(): Promise<NetworkPairingIntentResponse[]> {
    const pairingState = await loadNetworkPairingState();
    return pairingState.intents;
}

/* @Codex */
export async function confirmNetworkPairingIntent(intentId: string): Promise<{
    status: 201 | 404 | 409;
    value: NetworkPairingConfirmationResponse | { error: string; code?: string; message?: string };
}> {
    const snapshot = await loadNetworkSettingsSnapshot();
    if (normalizeNetworkOperatingMode(snapshot[NETWORK_MODE_KEY]) !== 'network-home-base') {
        return {
            status: 409,
            value: {
                error: 'Conflict',
                code: 'NETWORK_MODE_DISABLED',
                message: 'Home-base network mode is not enabled on this node.',
            },
        };
    }

    const pairingState = await loadNetworkPairingState();
    const result = confirmPendingPairingIntent({
        state: pairingState,
        intentId,
    });

    if (!result.ok) {
        return {
            status: result.status,
            value: result.value,
        };
    }

    await saveNetworkPairingState(result.nextState);
    return {
        status: result.status,
        value: result.value,
    };
}

/* @Codex */
export async function authenticateNetworkPairedClient(request: Request) {
    const pairingState = await loadNetworkPairingState();
    return authenticatePairedClientRequest(request, pairingState.clients);
}
