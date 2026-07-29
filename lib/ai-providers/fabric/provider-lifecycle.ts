/* @Codex */
import { isEgressGateOpen } from '../../ai-egress-gate';
import { CREDENTIAL_CLASS_PROPERTIES, type ProviderOnboardingState } from './onboarding';
import type { CredentialClass } from './contract';

export const PROVIDER_LIFECYCLE_SCHEMA_VERSION = 'mediflow.ai.provider-lifecycle.v1' as const;

export const PROVIDER_LIFECYCLE_STATES = Object.freeze([
    'available_unqualified',
    'degraded',
    'revoked',
] as const);

export type ProviderLifecycleStatus = typeof PROVIDER_LIFECYCLE_STATES[number];

export type ProviderLifecycleState = Readonly<{
    schemaVersion: typeof PROVIDER_LIFECYCLE_SCHEMA_VERSION;
    provider: string;
    credentialClass: CredentialClass;
    status: ProviderLifecycleStatus;
}>;

export type ProviderLifecycleEvent = 'degrade' | 'recover' | 'revoke';

export type ProviderLifecycleErrorCode =
    | 'onboarding_not_enabled'
    | 'credential_class_forbidden'
    | 'egress_profile_unsatisfied'
    | 'transition_invalid'
    | 'snapshot_invalid';

export class ProviderLifecycleError extends Error {
    constructor(public readonly code: ProviderLifecycleErrorCode) {
        super(`Provider lifecycle rejected: ${code}`);
        this.name = 'ProviderLifecycleError';
    }
}

const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const CREDENTIAL_CLASSES: ReadonlySet<string> = new Set(Object.keys(CREDENTIAL_CLASS_PROPERTIES));
const LIFECYCLE_STATUSES: ReadonlySet<string> = new Set(PROVIDER_LIFECYCLE_STATES);

function freezeState(
    provider: string,
    credentialClass: CredentialClass,
    status: ProviderLifecycleStatus,
): ProviderLifecycleState {
    return Object.freeze({
        schemaVersion: PROVIDER_LIFECYCLE_SCHEMA_VERSION,
        provider,
        credentialClass,
        status,
    });
}

type EnabledOnboardingSnapshot = Readonly<{
    provider: string;
    credentialClass: CredentialClass;
}>;

function snapshotEnabledOnboarding(value: unknown): EnabledOnboardingSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    // Materializza ogni campo una sola volta: gli oggetti runtime possono
    // esporre getter stateful e non devono cambiare tra validazione e uso.
    const record = value as Record<string, unknown>;
    const schemaVersion = record.schemaVersion;
    const provider = record.provider;
    const credentialClass = record.credentialClass;
    const step = record.step;
    const attestation = record.attestation;
    if (
        schemaVersion !== 'mediflow.ai.provider-onboarding.v1'
        || typeof provider !== 'string'
        || !PROVIDER_PATTERN.test(provider)
        || typeof credentialClass !== 'string'
        || !CREDENTIAL_CLASSES.has(credentialClass)
        || step !== 'enabled'
        || (attestation !== 'none' && attestation !== 'available_unqualified')
    ) {
        return null;
    }

    return Object.freeze({
        provider,
        credentialClass: credentialClass as CredentialClass,
    });
}

function isProviderLifecycleEvent(value: unknown): value is ProviderLifecycleEvent {
    return value === 'degrade' || value === 'recover' || value === 'revoke';
}

/**
 * Starts the operational lifecycle only from an already enabled onboarding
 * record. The lifecycle stores no broker material and never makes an egress
 * decision: it only records a local admission outcome.
 */
export function admitProvider(
    onboarding: ProviderOnboardingState,
): ProviderLifecycleState {
    const onboardingSnapshot = snapshotEnabledOnboarding(onboarding);
    if (!onboardingSnapshot) {
        throw new ProviderLifecycleError('onboarding_not_enabled');
    }

    const properties = CREDENTIAL_CLASS_PROPERTIES[onboardingSnapshot.credentialClass];
    if (!properties.grantsProviderAccess) {
        throw new ProviderLifecycleError('credential_class_forbidden');
    }
    if (!isEgressGateOpen() && onboardingSnapshot.credentialClass !== 'local_model') {
        throw new ProviderLifecycleError('egress_profile_unsatisfied');
    }

    return freezeState(
        onboardingSnapshot.provider,
        onboardingSnapshot.credentialClass,
        'available_unqualified',
    );
}

/**
 * Applies the only legal state transitions. Revocation is terminal; recovery
 * is intentionally possible only from degraded.
 */
export function transitionProviderLifecycle(
    state: ProviderLifecycleState,
    event: ProviderLifecycleEvent,
): ProviderLifecycleState {
    const snapshot = snapshotProviderLifecycle(state);
    if (!isProviderLifecycleEvent(event)) {
        throw new ProviderLifecycleError('transition_invalid');
    }

    switch (event) {
        case 'degrade':
            if (snapshot.status !== 'available_unqualified') {
                throw new ProviderLifecycleError('transition_invalid');
            }
            return freezeState(snapshot.provider, snapshot.credentialClass, 'degraded');
        case 'recover':
            if (snapshot.status !== 'degraded') {
                throw new ProviderLifecycleError('transition_invalid');
            }
            return freezeState(snapshot.provider, snapshot.credentialClass, 'available_unqualified');
        case 'revoke':
            if (snapshot.status === 'revoked') {
                throw new ProviderLifecycleError('transition_invalid');
            }
            return freezeState(snapshot.provider, snapshot.credentialClass, 'revoked');
    }
}

/**
 * Validates and copies an untrusted runtime value into the minimal,
 * serializable lifecycle shape. Extra fields are rejected so tokens,
 * endpoints, prompts, and payloads cannot cross this contract boundary.
 */
export function snapshotProviderLifecycle(value: unknown): ProviderLifecycleState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ProviderLifecycleError('snapshot_invalid');
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    // Anche qui i getter vengono letti una sola volta prima di qualunque
    // controllo o costruzione dello snapshot congelato.
    const schemaVersion = record.schemaVersion;
    const provider = record.provider;
    const credentialClass = record.credentialClass;
    const status = record.status;
    if (
        keys.length !== 4
        || !keys.every((key) => (
            key === 'schemaVersion'
            || key === 'provider'
            || key === 'credentialClass'
            || key === 'status'
        ))
        || schemaVersion !== PROVIDER_LIFECYCLE_SCHEMA_VERSION
        || typeof provider !== 'string'
        || !PROVIDER_PATTERN.test(provider)
        || typeof credentialClass !== 'string'
        || !CREDENTIAL_CLASSES.has(credentialClass)
        || typeof status !== 'string'
        || !LIFECYCLE_STATUSES.has(status)
    ) {
        throw new ProviderLifecycleError('snapshot_invalid');
    }

    return freezeState(
        provider,
        credentialClass as CredentialClass,
        status as ProviderLifecycleStatus,
    );
}
