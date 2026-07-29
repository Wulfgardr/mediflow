/* @Codex */
import type { NetworkOperatingMode } from './api/v1/types';

export const NETWORK_PAIRING_LIFECYCLE_SCHEMA_VERSION = 'mediflow.network.pairing-lifecycle.v1';

export type PairingTrustInput = {
    clientKnown: boolean;
    tokenValid: boolean;
    operatingMode: NetworkOperatingMode;
    capabilityGranted: boolean;
    sessionState: 'absent' | 'active' | 'expired';
    lockedOut: boolean;
};

export type PairedTrustState = Readonly<{
    schemaVersion: typeof NETWORK_PAIRING_LIFECYCLE_SCHEMA_VERSION;
    discovery: 'granted' | 'denied';
    dataPlane: 'granted' | 'denied';
    denial:
        | 'UNAUTHENTICATED'
        | 'NETWORK_MODE_DISABLED'
        | 'CAPABILITY_NOT_GRANTED'
        | 'SESSION_REQUIRED'
        | 'AUTH_LOCKED'
        | null;
}>;

export type PairingReconnectionClass =
    | 'trusted'
    | 're_login_required'
    | 're_pairing_required'
    | 'wait_mode_enabled'
    | 'locked_out_wait';

export type PairingRevocationEvent =
    | 'logout'
    | 'pin_change'
    | 'mode_disable'
    | 'client_dissociate'
    | 'admin_reset'
    | 'host_revoke';

export type PairingRevocationEffect = Readonly<{
    invalidatesPairedToken: boolean;
    makesPairedTokenInert: boolean;
    invalidatesOperatorSessions: 'none' | 'current' | 'all';
    clearsLockout: boolean;
}>;

function isPairingTrustInput(value: PairingTrustInput): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const candidate = value as unknown as Record<string, unknown>;
    return typeof candidate.clientKnown === 'boolean'
        && typeof candidate.tokenValid === 'boolean'
        && (candidate.operatingMode === 'local-only' || candidate.operatingMode === 'network-home-base')
        && typeof candidate.capabilityGranted === 'boolean'
        && (candidate.sessionState === 'absent'
            || candidate.sessionState === 'active'
            || candidate.sessionState === 'expired')
        && typeof candidate.lockedOut === 'boolean';
}

function denied(
    discovery: PairedTrustState['discovery'],
    denial: Exclude<PairedTrustState['denial'], null>,
): PairedTrustState {
    return Object.freeze({
        schemaVersion: NETWORK_PAIRING_LIFECYCLE_SCHEMA_VERSION,
        discovery,
        dataPlane: 'denied',
        denial,
    });
}

export function derivePairedTrustState(input: PairingTrustInput): PairedTrustState {
    if (!isPairingTrustInput(input) || !input.clientKnown || !input.tokenValid) {
        return denied('denied', 'UNAUTHENTICATED');
    }

    if (input.operatingMode !== 'network-home-base') {
        return denied('denied', 'NETWORK_MODE_DISABLED');
    }

    if (!input.capabilityGranted) {
        return denied('granted', 'CAPABILITY_NOT_GRANTED');
    }

    if (input.sessionState !== 'active') {
        return denied('granted', input.lockedOut ? 'AUTH_LOCKED' : 'SESSION_REQUIRED');
    }

    return Object.freeze({
        schemaVersion: NETWORK_PAIRING_LIFECYCLE_SCHEMA_VERSION,
        discovery: 'granted',
        dataPlane: 'granted',
        denial: null,
    });
}

export function classifyReconnection(input: PairingTrustInput): PairingReconnectionClass {
    if (!isPairingTrustInput(input)) return 're_pairing_required';
    if (!input.clientKnown || !input.tokenValid) return 're_pairing_required';
    if (input.operatingMode !== 'network-home-base') return 'wait_mode_enabled';
    if (input.lockedOut && input.sessionState !== 'active') return 'locked_out_wait';
    if (input.sessionState !== 'active') return 're_login_required';
    return 'trusted';
}

export const REVOCATION_EFFECTS: Readonly<Record<PairingRevocationEvent, PairingRevocationEffect>> =
    Object.freeze({
        logout: Object.freeze({
            invalidatesPairedToken: false,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'current',
            clearsLockout: false,
        }),
        pin_change: Object.freeze({
            invalidatesPairedToken: false,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'none',
            clearsLockout: true,
        }),
        mode_disable: Object.freeze({
            invalidatesPairedToken: false,
            makesPairedTokenInert: true,
            invalidatesOperatorSessions: 'none',
            clearsLockout: false,
        }),
        client_dissociate: Object.freeze({
            invalidatesPairedToken: false,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'none',
            clearsLockout: false,
        }),
        admin_reset: Object.freeze({
            invalidatesPairedToken: false,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'all',
            clearsLockout: false,
        }),
        host_revoke: Object.freeze({
            invalidatesPairedToken: true,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'none',
            clearsLockout: false,
        }),
    });
