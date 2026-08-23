/* @Codex */
import 'server-only';

import bcrypt from 'bcryptjs';
import { users } from '@/lib/schema';
import { dbServer } from '@/lib/db-server';
import { SECURITY_CONFIG } from './security';
import { resolveAuthenticatedReviewPrincipal, type AuthenticatedReviewPrincipalV1 } from './authenticated-review-principal';

type CanonicalCredential = Readonly<{ id: string; passwordHash: string }>;
type ResolvePrincipal = () => Promise<AuthenticatedReviewPrincipalV1>;

export type FreshReviewPinUniquenessVerifierSources = Readonly<{
    resolvePrincipal: ResolvePrincipal;
    loadCanonicalCredentials?: () => Promise<readonly CanonicalCredential[]>;
    compare?: (candidatePin: string, passwordHash: string) => Promise<boolean>;
}>;

export type FreshReviewPinProofV1 = Readonly<{
    actorRef: string;
    sessionRef: string;
}>;

export type FreshReviewPinErrorCode =
    | 'credential_store_unavailable'
    | 'comparison_unavailable'
    | 'pin_ambiguous'
    | 'pin_input_invalid'
    | 'pin_mismatch'
    | 'pin_not_matched'
    | 'principal_ambiguous'
    | 'principal_changed'
    | 'principal_mismatch'
    | 'principal_missing'
    | 'principal_unavailable'
    | 'session_ineligible'
    | 'session_unavailable'
    | 'storage_unavailable';

export class FreshReviewPinError extends Error {
    readonly code: FreshReviewPinErrorCode;

    constructor(code: FreshReviewPinErrorCode) {
        super(`Fresh review PIN rejected: ${code}`);
        this.name = 'FreshReviewPinError';
        this.code = code;
    }
}

function fail(code: FreshReviewPinErrorCode): never {
    throw new FreshReviewPinError(code);
}

async function loadCanonicalCredentials(): Promise<readonly CanonicalCredential[]> {
    return dbServer.select({ id: users.id, passwordHash: users.passwordHash }).from(users).all();
}

function isValidPin(candidatePin: unknown): candidatePin is string {
    return typeof candidatePin === 'string'
        && candidatePin.length >= SECURITY_CONFIG.PIN_MIN_LENGTH
        && candidatePin.length <= SECURITY_CONFIG.PIN_MAX_LENGTH;
}

function principalFailureCode(error: unknown): FreshReviewPinErrorCode {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    switch (code) {
        case 'principal_ambiguous':
        case 'principal_mismatch':
        case 'principal_missing':
        case 'session_ineligible':
        case 'session_unavailable':
        case 'storage_unavailable':
            return code;
        default:
            return 'principal_unavailable';
    }
}

async function resolvePrincipal(resolve: ResolvePrincipal): Promise<AuthenticatedReviewPrincipalV1> {
    try {
        return await resolve();
    } catch (error) {
        return fail(principalFailureCode(error));
    }
}

/**
 * P1b verifies only the submitted raw PIN. Actor and session identity remain
 * server-resolved through the injected P1a resolver; no identity input reaches
 * this seam, and the returned proof contains no credential material.
 */
export function createFreshReviewPinUniquenessVerifier(sources: FreshReviewPinUniquenessVerifierSources) {
    const readCredentials = sources.loadCanonicalCredentials ?? loadCanonicalCredentials;
    const compare = sources.compare ?? bcrypt.compare;

    return Object.freeze({
        async verify(candidatePin: string): Promise<FreshReviewPinProofV1> {
            if (!isValidPin(candidatePin)) return fail('pin_input_invalid');

            const before = await resolvePrincipal(sources.resolvePrincipal);
            let credentials: readonly CanonicalCredential[];
            try {
                credentials = await readCredentials();
            } catch {
                return fail('credential_store_unavailable');
            }

            let matching: readonly boolean[];
            try {
                matching = await Promise.all(credentials.map((credential) => compare(candidatePin, credential.passwordHash)));
            } catch {
                return fail('comparison_unavailable');
            }

            const matched = credentials.filter((_credential, index) => matching[index]);
            if (matched.length === 0) return fail('pin_not_matched');
            if (matched.length !== 1) return fail('pin_ambiguous');
            if (matched[0].id !== before.actorRef) return fail('pin_mismatch');

            const after = await resolvePrincipal(sources.resolvePrincipal);
            if (after.actorRef !== before.actorRef || after.sessionRef !== before.sessionRef) {
                return fail('principal_changed');
            }

            return Object.freeze({ actorRef: after.actorRef, sessionRef: after.sessionRef });
        },
    });
}

/** The production P1b seam resolves actor and session exclusively through the P1a host resolver. */
export const verifyFreshReviewPin = createFreshReviewPinUniquenessVerifier({
    resolvePrincipal: resolveAuthenticatedReviewPrincipal,
}).verify;
