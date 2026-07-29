/* @Codex */
import { isEgressGateOpen } from '../../ai-egress-gate';
import type { CredentialClass } from './contract';

export const ONBOARDING_STEPS = Object.freeze([
    'declared',
    'configured',
    'credentialed',
    'attested',
    'enabled',
] as const);

export type OnboardingStep = typeof ONBOARDING_STEPS[number];

export type CredentialClassProperties = Readonly<{
    grantsProviderAccess: boolean;
    requiresCredentialSecret: boolean;
    requiresLocalAttestation: boolean;
    cloudOnly: boolean;
}>;

export const CREDENTIAL_CLASS_PROPERTIES: Readonly<Record<CredentialClass, CredentialClassProperties>> = Object.freeze({
    local_model: Object.freeze({
        grantsProviderAccess: true,
        requiresCredentialSecret: false,
        requiresLocalAttestation: true,
        cloudOnly: false,
    }),
    api_key: Object.freeze({
        grantsProviderAccess: true,
        requiresCredentialSecret: true,
        requiresLocalAttestation: false,
        cloudOnly: true,
    }),
    oauth: Object.freeze({
        grantsProviderAccess: true,
        requiresCredentialSecret: true,
        requiresLocalAttestation: false,
        cloudOnly: true,
    }),
    consumer_login: Object.freeze({
        grantsProviderAccess: false,
        requiresCredentialSecret: true,
        requiresLocalAttestation: false,
        cloudOnly: true,
    }),
    subscription: Object.freeze({
        grantsProviderAccess: false,
        requiresCredentialSecret: false,
        requiresLocalAttestation: false,
        cloudOnly: true,
    }),
});

export type ProviderOnboardingState = Readonly<{
    schemaVersion: 'mediflow.ai.provider-onboarding.v1';
    provider: string;
    credentialClass: CredentialClass;
    step: OnboardingStep;
    attestation: 'none' | 'available_unqualified';
}>;

export type OnboardingErrorCode =
    | 'invalid_event'
    | 'step_order_violation'
    | 'credential_class_forbidden'
    | 'attestation_required'
    | 'egress_profile_unsatisfied';

export class OnboardingError extends Error {
    constructor(public readonly code: OnboardingErrorCode) {
        super(`Provider onboarding rejected: ${code}`);
        this.name = 'OnboardingError';
    }
}

export type OnboardingEvent = Readonly<{
    type: 'configure' | 'credential_declared' | 'attest_local' | 'enable';
}>;

export function startOnboarding(provider: string, credentialClass: CredentialClass): ProviderOnboardingState {
    if (typeof provider !== 'string' || provider.trim().length === 0) {
        throw new OnboardingError('invalid_event');
    }
    if (!isCredentialClass(credentialClass)) {
        throw new OnboardingError('credential_class_forbidden');
    }

    return freezeState(provider, credentialClass, 'declared', 'none');
}

export function advanceOnboarding(
    state: ProviderOnboardingState,
    event: OnboardingEvent,
): ProviderOnboardingState {
    if (!isOnboardingState(state)) {
        throw new OnboardingError('invalid_event');
    }
    if (!isOnboardingEvent(event)) {
        throw new OnboardingError('invalid_event');
    }

    const properties = CREDENTIAL_CLASS_PROPERTIES[state.credentialClass];
    switch (event.type) {
        case 'configure':
            requireStep(state, 'declared');
            return freezeState(state.provider, state.credentialClass, 'configured', state.attestation);
        case 'credential_declared':
            requireStep(state, 'configured');
            if (!properties.grantsProviderAccess) {
                throw new OnboardingError('credential_class_forbidden');
            }
            return freezeState(state.provider, state.credentialClass, 'credentialed', state.attestation);
        case 'attest_local':
            requireStep(state, 'credentialed');
            if (properties.cloudOnly && !isEgressGateOpen()) {
                throw new OnboardingError('egress_profile_unsatisfied');
            }
            return freezeState(
                state.provider,
                state.credentialClass,
                'attested',
                properties.requiresLocalAttestation ? 'available_unqualified' : state.attestation,
            );
        case 'enable':
            requireStep(state, 'attested');
            if (properties.cloudOnly && !isEgressGateOpen()) {
                throw new OnboardingError('egress_profile_unsatisfied');
            }
            if (properties.requiresLocalAttestation && state.attestation !== 'available_unqualified') {
                throw new OnboardingError('attestation_required');
            }
            return freezeState(state.provider, state.credentialClass, 'enabled', state.attestation);
    }
}

function freezeState(
    provider: string,
    credentialClass: CredentialClass,
    step: OnboardingStep,
    attestation: ProviderOnboardingState['attestation'],
): ProviderOnboardingState {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.provider-onboarding.v1',
        provider,
        credentialClass,
        step,
        attestation,
    });
}

function requireStep(state: ProviderOnboardingState, expected: OnboardingStep): void {
    if (state.step !== expected) {
        throw new OnboardingError('step_order_violation');
    }
}

function isCredentialClass(value: unknown): value is CredentialClass {
    return typeof value === 'string'
        && Object.prototype.hasOwnProperty.call(CREDENTIAL_CLASS_PROPERTIES, value);
}

function isOnboardingState(value: unknown): value is ProviderOnboardingState {
    if (!value || typeof value !== 'object') return false;
    const state = value as Partial<ProviderOnboardingState>;
    return state.schemaVersion === 'mediflow.ai.provider-onboarding.v1'
        && typeof state.provider === 'string'
        && state.provider.trim().length > 0
        && isCredentialClass(state.credentialClass)
        && ONBOARDING_STEPS.includes(state.step as OnboardingStep)
        && (state.attestation === 'none' || state.attestation === 'available_unqualified');
}

function isOnboardingEvent(value: unknown): value is OnboardingEvent {
    if (!value || typeof value !== 'object') return false;
    const type = (value as { type?: unknown }).type;
    return type === 'configure'
        || type === 'credential_declared'
        || type === 'attest_local'
        || type === 'enable';
}
