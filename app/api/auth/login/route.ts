import { logServerError } from '@/lib/server-error-log';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';
import { NextResponse } from 'next/server';
import { archiveGenerationForSession } from '@/lib/security/archive-session-generation';
import {
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';
import { verifyUnlockCredentials } from '@/lib/security/host-credential-verification';
import {
    abortWebAuthControl,
    beginWebAuthControl,
    issueWebAuthControl,
    setWebAuthControlEtag,
    setWebAuthSessionLocator,
    webAuthControlMutationFromRequest,
    type WebAuthControlMutation,
} from '@/lib/security/web-auth-control-transport';
import { retirePendingPinEraResidues } from '@/lib/security/pin-era-residues';
import { createAgentRegistrationStore } from '@/lib/agent-registration-store';
import { beginAgentUnlock } from '@/lib/security/agent-unlock-session';
import { dbServer } from '@/lib/db-server';

function authFailureResponse(payload: Record<string, unknown>, status: number, etag?: string) {
    const response = NextResponse.json(payload, { status });
    const retryAfterSeconds = typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : null;
    if (retryAfterSeconds) {
        response.headers.set('Retry-After', String(retryAfterSeconds));
    }
    response.headers.set('Cache-Control', 'no-store');
    if (etag) setWebAuthControlEtag(response, etag);
    return response;
}

export async function POST(request: Request) {
    if (!hasAttestedLoopbackIngress(request)) return authFailureResponse({ error: 'Local access required' }, 403);
    let mutation: WebAuthControlMutation | null = null;
    let attempt: unknown | null = null;
    try {
        mutation = webAuthControlMutationFromRequest(request);
        if (!mutation) {
            return authFailureResponse({ error: 'Login unavailable', code: 'AUTH_LOGIN_UNAVAILABLE' }, 503);
        }
        attempt = beginWebAuthControl('login', mutation, request);
        if (!attempt) {
            return authFailureResponse({ error: 'Login unavailable', code: 'AUTH_LOGIN_UNAVAILABLE' }, 503, mutation.ifMatch);
        }

        const body = await request.json();
        const requestedUsername = typeof body?.username === 'string' ? body.username.trim() : '';
        const password = typeof body?.password === 'string' ? body.password : '';
        // ADR 0143: an account with a passphrase sends its access verifier, never the secret.
        const verifier = typeof body?.verifier === 'string' ? body.verifier : '';

        if (!password === !verifier) {
            abortWebAuthControl(attempt);
            attempt = null;
            return authFailureResponse({ error: 'Missing credentials', code: 'AUTH_MISSING_CREDENTIALS' }, 400, mutation.ifMatch);
        }

        // The shared verifier records 'auth.login.failed' with Web-only context.
        const verification = await verifyUnlockCredentials(
            verifier ? { username: requestedUsername, verifier } : { username: requestedUsername, pin: password },
        );
        if (verification.kind === 'denied') {
            abortWebAuthControl(attempt);
            attempt = null;
            return authFailureResponse(verification.body, verification.status, mutation.ifMatch);
        }
        const user = verification.account;
        const session = issueWebAuthControl(attempt, {
            id: user.id,
            username: user.username,
            role: user.role || 'user',
        });
        attempt = null;
        if (!session) {
            return authFailureResponse({ error: 'Login unavailable', code: 'AUTH_LOGIN_UNAVAILABLE' }, 503, mutation.ifMatch);
        }
        // ADR 0143: nothing beside the archive of a passphrase account may still hold its PIN
        // wrapping. The move removes it; this repeats what an interruption or a busy reader left.
        const earlierCopiesCleared = verifier ? retirePendingPinEraResidues(user.id, dbServer) : undefined;
        const issuedArchiveGeneration = archiveGenerationForSession({ id: session.sessionId, expiresAt: 0 });
        try {
            await writeAuditEvent({
                eventType: 'auth.login.succeeded',
                outcome: 'success',
                actorType: 'user',
                actorRef: user.id,
                subjectType: 'session',
                subjectRef: session.sessionId,
                sourceSurface: 'web',
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata({
                    actorType: 'user',
                    actorRef: user.id,
                    sourceSurface: 'web',
                    authContext: 'session',
                }, null),
            });
        } catch (error) {
            logServerError('Audit login success write failed', error);
        }
        const agentUnlockTicket = user.role === 'admin' && issuedArchiveGeneration
            && createAgentRegistrationStore(dbServer.$client).hasActiveRegistration(user.id, issuedArchiveGeneration)
            ? beginAgentUnlock(session.sessionId, mutation.controlId) : null;
        const response = NextResponse.json({
            success: true,
            ...(agentUnlockTicket ? { agentUnlockTicket } : {}),
            archiveGeneration: issuedArchiveGeneration,
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            ambulatoryName: user.ambulatoryName,
            role: user.role,
            encryptedMasterKey: user.encryptedMasterKey,
            salt: user.salt,
            ...(earlierCopiesCleared !== undefined ? { earlierCopiesCleared } : {}),
        });
        setWebAuthSessionLocator(response, request, session.sessionId);
        setWebAuthControlEtag(response, session.etag);
        return response;
    } catch (error) {
        if (attempt) abortWebAuthControl(attempt);
        logServerError("Login error", error);
        return authFailureResponse({ error: "Login failed", code: "AUTH_LOGIN_FAILED" }, 500, mutation?.ifMatch);
    }
}
