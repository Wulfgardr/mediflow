/* @Codex */
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import type {
    NetworkCapabilitiesResponse,
    NetworkAiRuntimeSummary,
    NetworkIdentitySummary,
    NetworkNodeSummary,
    NetworkOperatingMode,
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
import type { ServerSession } from '@/lib/security/server-session';
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

const PAIRING_STATE_CAS_ATTEMPTS = 5;

export type PairingStateMutationOutcome<T> =
    | { readonly write: true; readonly nextState: NetworkPairingState; readonly result: T }
    | { readonly write: false; readonly result: T };

// Unica primitiva di scrittura dello stato pairing, con compare-and-swap sul
// valore serializzato. OGNI writer (creazione intent, conferma, revoca) DEVE
// passare da qui: due sequenze load->modifica->save concorrenti si
// sovrascrivono a vicenda e una conferma puo' resuscitare un client appena
// revocato. Il perdente della gara rilegge lo stato aggiornato e riprova.
export async function mutateNetworkPairingState<T>(
    mutator: (state: NetworkPairingState) => PairingStateMutationOutcome<T>,
): Promise<{ readonly conflict: false; readonly result: T } | { readonly conflict: true }> {
    for (let attempt = 0; attempt < PAIRING_STATE_CAS_ATTEMPTS; attempt += 1) {
        const rawValue = await loadSettingValue(NETWORK_PAIRING_STATE_KEY);
        const state = parseNetworkPairingState(rawValue);
        const outcome = mutator(state);
        if (!outcome.write) {
            return { conflict: false, result: outcome.result };
        }

        const serialized = serializeNetworkPairingState(outcome.nextState);
        if (rawValue === null) {
            const insertResult = dbServer
                .insert(settings)
                .values({ key: NETWORK_PAIRING_STATE_KEY, value: serialized })
                .onConflictDoNothing()
                .run();
            if (insertResult.changes === 1) {
                return { conflict: false, result: outcome.result };
            }
        } else {
            const updateResult = dbServer
                .update(settings)
                .set({ value: serialized })
                .where(and(
                    eq(settings.key, NETWORK_PAIRING_STATE_KEY),
                    eq(settings.value, rawValue),
                ))
                .run();
            if (updateResult.changes === 1) {
                return { conflict: false, result: outcome.result };
            }
        }
    }
    return { conflict: true };
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
        const persisted = await mutateNetworkPairingState((state) => ({
            write: true,
            nextState: addPendingPairingIntent(state, result.value),
            result: null,
        }));
        if (persisted.conflict) {
            return {
                ok: false,
                status: 409,
                value: {
                    error: 'Conflict',
                    code: 'PAIRING_STATE_CONFLICT',
                    message: 'Pairing state changed, retry.',
                },
            };
        }
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

    const persisted = await mutateNetworkPairingState((state) => {
        const result = confirmPendingPairingIntent({ state, intentId });
        return result.ok
            ? { write: true, nextState: result.nextState, result }
            : { write: false, result };
    });
    if (persisted.conflict) {
        return {
            status: 409,
            value: {
                error: 'Conflict',
                code: 'PAIRING_STATE_CONFLICT',
                message: 'Pairing state changed, retry.',
            },
        };
    }

    return {
        status: persisted.result.status,
        value: persisted.result.value,
    };
}

export async function getNetworkOperatingMode(): Promise<NetworkOperatingMode> {
    return normalizeNetworkOperatingMode(await loadSettingValue(NETWORK_MODE_KEY));
}

/* @Codex */
export async function authenticateNetworkPairedClient(request: Request) {
    const pairingState = await loadNetworkPairingState();
    return authenticatePairedClientRequest(request, pairingState.clients);
}
