/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';
import { types } from 'node:util';

import { createInvalidCredentialsPayload } from '@/lib/security/auth-lockout';
import { requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/security/audit';
import { verifyHostCredentials } from '@/lib/security/host-credential-verification';
import type { NativeBootstrapRouteBinding } from '@/lib/security/native-bootstrap-admission';
import { createNativeServerSession, SESSION_COOKIE_NAME } from '@/lib/security/server-session';
import { sessionCookieOptionsForRequest } from '@/lib/security/request-transport';

type Credentials = Readonly<{ username: string; password: string }>;
type Verification = Awaited<ReturnType<typeof verifyHostCredentials>>;
type Account = Extract<Verification, { kind: 'verified' }>['account'];
type Consume = (value: unknown) => Promise<NativeBootstrapRouteBinding | null>;

export type NativeLoginHttpDependencies = Readonly<{
    verify?: (input: unknown) => Promise<Verification>;
    consume?: Consume;
    createNativeSession?: typeof createNativeServerSession;
    audit?: (request: Request, user: Account, session: ReturnType<typeof createNativeServerSession>) => Promise<unknown>;
}>;

const isProxy = types.isProxy;
// P5 HOLD: server-auth retains its separate local-API clone risk; this packet does not compose it.
const consumeNativeAdmission: Consume = async (value) => (await import('@/lib/security/native-bootstrap-admission')).consumeNativeBootstrapAdmission(value);

export function nativeLoginDeniedResponse(): NextResponse {
    const response = NextResponse.json(createInvalidCredentialsPayload(), { status: 401 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function authFailure(payload: Record<string, unknown>, status: number): NextResponse {
    const response = NextResponse.json(payload, { status });
    const retry = typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : null;
    if (retry) response.headers.set('Retry-After', String(retry));
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function credentials(value: unknown): Credentials | null {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const fields = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(fields).length !== 2 || !fields.username || !fields.password) return null;
        const username = fields.username; const password = fields.password;
        if (username.get || username.set || password.get || password.set || !username.enumerable || !password.enumerable) return null;
        if (typeof username.value !== 'string' || typeof password.value !== 'string' || !password.value) return null;
        return Object.freeze({ username: username.value.trim(), password: password.value });
    } catch { return null; }
}

async function auditSuccess(request: Request, user: Account, session: ReturnType<typeof createNativeServerSession>): Promise<void> {
    await writeAuditEvent({
        eventType: 'auth.login.succeeded', outcome: 'success', actorType: 'user', actorRef: user.id,
        subjectType: 'session', subjectRef: session.id, sourceSurface: 'native', requestId: requestIdFromRequest(request),
        redactedMetadata: withAuditContextMetadata({ actorType: 'user', actorRef: user.id, sourceSurface: 'native', authContext: 'session' }, null),
    });
}

/** The sole native login seam: admission is burned on every path and only rechecked after PIN verification. */
/* @Codex */
export function createNativeLoginHttpHandler(dependencies: NativeLoginHttpDependencies = {}) {
    const verify = dependencies.verify ?? verifyHostCredentials;
    const consume = dependencies.consume ?? consumeNativeAdmission;
    const createNativeSession = dependencies.createNativeSession ?? createNativeServerSession;
    const audit = dependencies.audit ?? auditSuccess;
    return async (request: Request, admission: unknown, input: unknown): Promise<NextResponse> => {
        let consumed = false;
        try {
            if (!admission) return nativeLoginDeniedResponse();
            const parsed = credentials(input);
            if (!parsed) return nativeLoginDeniedResponse();
            const verification = await verify({ username: parsed.username, pin: parsed.password });
            if (verification.kind === 'denied') return authFailure(verification.body, verification.status);
            const paired = await consume(admission); consumed = true;
            if (!paired) return nativeLoginDeniedResponse();
            const session = createNativeSession({ id: verification.account.id, username: verification.account.username, role: verification.account.role || 'user' }, paired);
            const response = NextResponse.json({ success: true, id: verification.account.id, username: verification.account.username, displayName: verification.account.displayName, ambulatoryName: verification.account.ambulatoryName, role: verification.account.role, encryptedMasterKey: verification.account.encryptedMasterKey, salt: verification.account.salt });
            response.cookies.set(SESSION_COOKIE_NAME, session.id, sessionCookieOptionsForRequest(request));
            response.headers.set('Cache-Control', 'no-store');
            try { await audit(request, verification.account, session); } catch { /* authority already exists and audit is best-effort. */ }
            return response;
        } catch { return nativeLoginDeniedResponse(); }
        finally { if (!consumed && admission) { try { await consume(admission); } catch { /* burn failure remains denied. */ } } }
    };
}

export const nativeLoginHttp = createNativeLoginHttpHandler();
