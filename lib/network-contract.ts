/* @Codex */
import { randomUUID } from 'node:crypto';
import type {
    NetworkCapabilitiesResponse,
    NetworkCapability,
    NetworkCapabilityStatus,
    NetworkErrorResponse,
    NetworkNodeSummary,
    NetworkOperatingMode,
    NetworkPairingConfirmationResponse,
    NetworkPairingIntentRequest,
    NetworkPairingIntentResponse,
    NetworkReplicaSummary,
    NetworkSessionSummary,
} from './api/v1/types';

/* @Codex */
export const NETWORK_PROTOCOL_VERSION = '1.8.0';
/* @Codex */
export const NETWORK_NODE_ID_KEY = 'network.nodeId';
/* @Codex */
export const NETWORK_MODE_KEY = 'network.mode';
/* @Codex */
export const NETWORK_SETTINGS_KEYS = [
    NETWORK_NODE_ID_KEY,
    NETWORK_MODE_KEY,
    'doctorName',
    'clinicName',
] as const;
/* @Codex */
export const NETWORK_PAIRING_INTENT_TTL_MINUTES = 10;

type NetworkSettingsSnapshot = Partial<Record<(typeof NETWORK_SETTINGS_KEYS)[number], string>>;

type PairingIntentOk = {
    ok: true;
    status: 201;
    value: NetworkPairingIntentResponse;
};

type PairingIntentError = {
    ok: false;
    status: 400 | 409;
    value: NetworkErrorResponse;
};

export type PairingIntentDraftResult = PairingIntentOk | PairingIntentError;

const NETWORK_PAIRING_PLATFORMS = new Set<NetworkPairingIntentRequest['clientPlatform']>([
    'macos',
    'ios',
    'ipados',
]);

function dedupeCapabilities(items: string[]): string[] {
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

export function normalizeNetworkOperatingMode(value: string | null | undefined): NetworkOperatingMode {
    return value === 'network-home-base' ? 'network-home-base' : 'local-only';
}

export function deriveNetworkDisplayName(
    snapshot: NetworkSettingsSnapshot,
    hostName: string
): string {
    const clinicName = snapshot.clinicName?.trim();
    if (clinicName) return clinicName;

    const doctorName = snapshot.doctorName?.trim();
    if (doctorName) return doctorName;

    return hostName;
}

export function buildNetworkNodeSummary(input: {
    nodeId: string;
    snapshot: NetworkSettingsSnapshot;
    hostName: string;
}): NetworkNodeSummary {
    const operatingMode = normalizeNetworkOperatingMode(input.snapshot[NETWORK_MODE_KEY]);
    return {
        nodeId: input.nodeId,
        displayName: deriveNetworkDisplayName(input.snapshot, input.hostName),
        role: 'home-base-candidate',
        operatingMode,
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        transport: {
            apiBasePath: '/api/v1',
            tlsRequired: true,
            localTlsPort: 3443,
        },
    };
}

/* @Codex */
export function buildNetworkReplicaSummary(input: {
    operatingMode: NetworkOperatingMode;
    sessionState: NetworkSessionSummary['sessionState'];
    degradedReason: string | null;
}): NetworkReplicaSummary {
    const degradedReason = input.degradedReason?.toLowerCase() ?? '';
    if (degradedReason.includes('conflict')) {
        return {
            strategy: 'encrypted-snapshot-mirror',
            state: 'conflict-review',
            authority: 'paired-home-base',
            pendingAction: 'manual-review',
            conflictMode: 'restore-preflight-plus-version-check',
            backupBoundary: 'artifact-v1-remains-backup-only',
            lastSnapshotAt: null,
            lastReconciledAt: null,
        };
    }

    switch (input.sessionState) {
        case 'network-paired-online':
            return {
                strategy: 'encrypted-snapshot-mirror',
                state: 'online',
                authority: 'paired-home-base',
                pendingAction: 'none',
                conflictMode: 'restore-preflight-plus-version-check',
                backupBoundary: 'artifact-v1-remains-backup-only',
                lastSnapshotAt: null,
                lastReconciledAt: null,
            };
        case 'network-paired-offline-degraded':
            return {
                strategy: 'encrypted-snapshot-mirror',
                state: 'offline-deferred',
                authority: 'local-device',
                pendingAction: 'queue-snapshot',
                conflictMode: 'restore-preflight-plus-version-check',
                backupBoundary: 'artifact-v1-remains-backup-only',
                lastSnapshotAt: null,
                lastReconciledAt: null,
            };
        case 'network-unpaired':
            return {
                strategy: 'encrypted-snapshot-mirror',
                state: 'unpaired',
                authority: 'local-device',
                pendingAction: 'pairing-required',
                conflictMode: 'restore-preflight-plus-version-check',
                backupBoundary: 'artifact-v1-remains-backup-only',
                lastSnapshotAt: null,
                lastReconciledAt: null,
            };
        case 'local-only':
        default:
            return {
                strategy: 'encrypted-snapshot-mirror',
                state: 'local-only',
                authority: 'local-device',
                pendingAction: 'none',
                conflictMode: 'restore-preflight-plus-version-check',
                backupBoundary: 'artifact-v1-remains-backup-only',
                lastSnapshotAt: null,
                lastReconciledAt: null,
            };
    }
}

export function buildNetworkSessionSummary(input: {
    nodeId: string;
    snapshot: NetworkSettingsSnapshot;
    hasPairedClients?: boolean;
}): NetworkSessionSummary {
    const operatingMode = normalizeNetworkOperatingMode(input.snapshot[NETWORK_MODE_KEY]);
    if (operatingMode === 'network-home-base') {
        const degradedReason = null;
        const hasPairedClients = input.hasPairedClients === true;
        return {
            nodeId: input.nodeId,
            operatingMode,
            sessionState: hasPairedClients ? 'network-paired-online' : 'network-unpaired',
            pairingState: hasPairedClients ? 'paired' : 'required',
            trustedSession: hasPairedClients,
            degradedReason,
            authMode: 'paired-client-plus-session',
            protocolVersion: NETWORK_PROTOCOL_VERSION,
            replica: buildNetworkReplicaSummary({
                operatingMode,
                sessionState: hasPairedClients ? 'network-paired-online' : 'network-unpaired',
                degradedReason,
            }),
        };
    }

    const degradedReason = null;
    return {
        nodeId: input.nodeId,
        operatingMode,
        sessionState: 'local-only',
        pairingState: 'disabled',
        trustedSession: false,
        degradedReason,
        authMode: 'bearer-token',
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        replica: buildNetworkReplicaSummary({
            operatingMode,
            sessionState: 'local-only',
            degradedReason,
        }),
    };
}

function capability(
    key: NetworkCapability['key'],
    status: NetworkCapability['status'],
    requiresPairing: boolean,
    description: string
): NetworkCapability {
    return {
        key,
        status,
        requiresPairing,
        description,
    };
}

export function buildNetworkCapabilitiesResponse(input: {
    nodeId: string;
    snapshot: NetworkSettingsSnapshot;
    platform: string;
    aiCentralRuntimeStatus?: NetworkCapabilityStatus;
}): NetworkCapabilitiesResponse {
    const operatingMode = normalizeNetworkOperatingMode(input.snapshot[NETWORK_MODE_KEY]);
    const pairingBootstrapStatus = operatingMode === 'network-home-base' ? 'available' : 'disabled';
    const schedulerStatus = input.platform === 'darwin' ? 'available' : 'unavailable';
    const aiCentralRuntimeStatus = input.aiCentralRuntimeStatus
        ?? (operatingMode === 'network-home-base' ? 'unavailable' : 'disabled');

    return {
        nodeId: input.nodeId,
        operatingMode,
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        capabilities: [
            capability(
                'network.pairing.bootstrap',
                pairingBootstrapStatus,
                false,
                'Explicit pairing bootstrap for trusted LAN clients. Disabled while the node stays in local-only mode.'
            ),
            capability(
                'network.replica.readonly-patients',
                operatingMode === 'network-home-base' ? 'available' : 'disabled',
                true,
                'Read-only remote patient access from a paired client with a valid operator session.'
            ),
            capability(
                'network.replica.readonly-clinical-diary',
                operatingMode === 'network-home-base' ? 'available' : 'disabled',
                true,
                'Read-only clinical diary access scoped to the active ambulatory from a paired client with a valid operator session.'
            ),
            capability(
                'network.replica.write-patient-profile',
                operatingMode === 'network-home-base' ? 'available' : 'disabled',
                true,
                'Paired patient profile/status update boundary with optimistic concurrency; excludes AI, document, child clinical CRUD, and remote delete.'
            ),
            capability(
                'network.replica.write-clinical-diary',
                operatingMode === 'network-home-base' ? 'available' : 'disabled',
                true,
                'Paired clinical diary create/update boundary scoped to the active ambulatory; excludes hard delete, AI, and document-derived writes.'
            ),
            capability(
                'network.replica.sync',
                'planned',
                true,
                'Future replica and reconciliation workstream for paired nodes.'
            ),
            capability(
                'network.ai.central-runtime',
                aiCentralRuntimeStatus,
                true,
                'Optional centralized AI runtime on the paired node, separate from the data plane and still gated by benchmark and rollout governance.'
            ),
            capability(
                'network.catalogs.sync',
                'planned',
                true,
                'Future catalog and terminology distribution over the trusted local network.'
            ),
            capability(
                'local.backup.artifact.v1',
                'available',
                false,
                'Local backup artifact export/import with manifest and restore preflight.'
            ),
            capability(
                'local.backup.scheduler.macos',
                schedulerStatus,
                false,
                'Local macOS launchd-based nightly backup scheduler.'
            ),
        ],
    };
}

function invalidPairingIntent(message: string): PairingIntentError {
    return {
        ok: false,
        status: 400,
        value: {
            error: 'Bad Request',
            code: 'PAIRING_REQUEST_INVALID',
            message,
        },
    };
}

function disabledNetworkMode(): PairingIntentError {
    return {
        ok: false,
        status: 409,
        value: {
            error: 'Conflict',
            code: 'NETWORK_MODE_DISABLED',
            message: 'Home-base network mode is not enabled on this node.',
        },
    };
}

function validatePairingIntentRequest(
    value: unknown
): { ok: true; value: NetworkPairingIntentRequest } | PairingIntentError {
    if (!value || typeof value !== 'object') {
        return invalidPairingIntent('Request body must be an object.');
    }

    const candidate = value as Record<string, unknown>;
    const deviceName = typeof candidate.deviceName === 'string' ? candidate.deviceName.trim() : '';
    if (!deviceName) {
        return invalidPairingIntent('deviceName is required.');
    }
    if (deviceName.length > 120) {
        return invalidPairingIntent('deviceName must be 120 characters or fewer.');
    }

    const clientPlatform = candidate.clientPlatform;
    if (
        typeof clientPlatform !== 'string' ||
        !NETWORK_PAIRING_PLATFORMS.has(clientPlatform as NetworkPairingIntentRequest['clientPlatform'])
    ) {
        return invalidPairingIntent('clientPlatform must be one of macos, ios, ipados.');
    }

    const appVersion = candidate.appVersion;
    if (appVersion !== undefined && appVersion !== null && typeof appVersion !== 'string') {
        return invalidPairingIntent('appVersion must be a string when provided.');
    }

    const requestedCapabilities = candidate.requestedCapabilities;
    if (requestedCapabilities !== undefined && !Array.isArray(requestedCapabilities)) {
        return invalidPairingIntent('requestedCapabilities must be an array of strings when provided.');
    }

    const normalizedCapabilities = Array.isArray(requestedCapabilities)
        ? dedupeCapabilities(
            requestedCapabilities.filter((item): item is string => typeof item === 'string')
        )
        : [];

    return {
        ok: true,
        value: {
            deviceName,
            clientPlatform: clientPlatform as NetworkPairingIntentRequest['clientPlatform'],
            appVersion: typeof appVersion === 'string' ? appVersion.trim() || null : null,
            requestedCapabilities: normalizedCapabilities,
        },
    };
}

export function createPairingIntentDraft(input: {
    nodeSummary: NetworkNodeSummary;
    snapshot: NetworkSettingsSnapshot;
    payload: unknown;
    now?: Date;
}): PairingIntentDraftResult {
    const operatingMode = normalizeNetworkOperatingMode(input.snapshot[NETWORK_MODE_KEY]);
    if (operatingMode !== 'network-home-base') {
        return disabledNetworkMode();
    }

    const validated = validatePairingIntentRequest(input.payload);
    if (!validated.ok) return validated;

    const requestedAt = input.now ?? new Date();
    const expiresAt = new Date(requestedAt.getTime() + NETWORK_PAIRING_INTENT_TTL_MINUTES * 60_000);

    return {
        ok: true,
        status: 201,
        value: {
            intentId: randomUUID(),
            status: 'pending-home-base-confirmation',
            nodeId: input.nodeSummary.nodeId,
            nodeDisplayName: input.nodeSummary.displayName,
            protocolVersion: input.nodeSummary.protocolVersion,
            requestedAt: requestedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            requestedBy: {
                deviceName: validated.value.deviceName,
                clientPlatform: validated.value.clientPlatform,
                appVersion: validated.value.appVersion ?? null,
            },
            requestedCapabilities: validated.value.requestedCapabilities ?? [],
        },
    };
}

/* @Codex */
export function createConfirmedPairingResponse(input: {
    intent: NetworkPairingIntentResponse;
    clientId: string;
    pairedAt: string;
    pairedClientToken: string;
}): NetworkPairingConfirmationResponse {
    return {
        intentId: input.intent.intentId,
        status: 'paired',
        nodeId: input.intent.nodeId,
        nodeDisplayName: input.intent.nodeDisplayName,
        protocolVersion: input.intent.protocolVersion,
        pairedAt: input.pairedAt,
        pairedClientToken: input.pairedClientToken,
        pairedClient: {
            clientId: input.clientId,
            deviceName: input.intent.requestedBy.deviceName,
            clientPlatform: input.intent.requestedBy.clientPlatform,
            appVersion: input.intent.requestedBy.appVersion,
            grantedCapabilities: input.intent.requestedCapabilities,
            pairedAt: input.pairedAt,
            lastSeenAt: null,
        },
        authHeaders: {
            clientIdHeader: 'x-mediflow-paired-client-id',
            clientTokenHeader: 'x-mediflow-paired-client-token',
            sessionCookie: 'mediflow_session',
        },
    };
}
