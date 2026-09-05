/* @Codex */
import 'server-only';

import {
    ServerSessionProjectionOwnerError,
    type ServerSessionProjectionOwner,
} from './server-session-projection-owner';

type SelectionLease = ReturnType<ServerSessionProjectionOwner['issueSelection']>;
export type AuthenticatedWebSessionSelectionOperation = Readonly<{
    issueSelection(input: unknown): Promise<SelectionLease>;
}>;
export type AuthenticatedWebSessionSelectionErrorCode = 'input_invalid' | 'session_unavailable';

export class AuthenticatedWebSessionSelectionError extends Error {
    constructor(readonly code: AuthenticatedWebSessionSelectionErrorCode) {
        super(`Authenticated web session selection rejected: ${code}`);
        this.name = 'AuthenticatedWebSessionSelectionError';
    }
}

type Sources = Readonly<{ acquireOwner(): Promise<ServerSessionProjectionOwner | null> }>;

function fail(code: AuthenticatedWebSessionSelectionErrorCode): never {
    throw new AuthenticatedWebSessionSelectionError(code);
}

export function createAuthenticatedWebSessionSelectionService(sources: Sources) {
    const acquire = async (): Promise<AuthenticatedWebSessionSelectionOperation> => {
        let owner: ServerSessionProjectionOwner | null;
        try {
            owner = await sources.acquireOwner();
        } catch (error) {
            if (error instanceof ServerSessionProjectionOwnerError) throw error;
            return fail('session_unavailable');
        }
        if (!owner) return fail('session_unavailable');
        return Object.freeze({
            async issueSelection(input: unknown): Promise<SelectionLease> {
                try {
                    return owner.issueSelection(input as never);
                } catch (error) {
                    if (error instanceof ServerSessionProjectionOwnerError) throw error;
                    return fail('input_invalid');
                }
            },
        });
    };

    return Object.freeze({
        acquire,
        async issue(input: unknown): Promise<SelectionLease> {
            return (await acquire()).issueSelection(input);
        },
    });
}
