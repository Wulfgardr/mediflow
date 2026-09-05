import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users, settings } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
/* @Codex */
import { SESSION_COOKIE_NAME } from '@/lib/security/server-session';
/* @Codex */
import {
    abortWebAuthControl,
    beginWebAuthControl,
    issueWebAuthControl,
    setWebAuthControlEtag,
    webAuthControlMutationFromRequest,
    type WebAuthControlMutation,
} from '@/lib/security/web-auth-control-transport';
/* @Codex */
import { sessionCookieOptionsForRequest } from '@/lib/security/request-transport';
/* @Codex */
import { authSetupSchema } from '@/lib/api-schemas/auth';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';

/* @Codex */
function setupResponse(payload: Record<string, unknown>, status: number, etag?: string) {
    const response = NextResponse.json(payload, { status });
    response.headers.set('Cache-Control', 'no-store');
    if (etag) setWebAuthControlEtag(response, etag);
    return response;
}

export async function POST(request: Request) {
    let mutation: WebAuthControlMutation | null = null;
    let attempt: unknown | null = null;
    try {
        mutation = webAuthControlMutationFromRequest(request);
        if (!mutation) {
            return setupResponse({ error: 'Setup unavailable', code: 'SETUP_AUTH_UNAVAILABLE' }, 503);
        }
        attempt = beginWebAuthControl('setup', mutation);
        if (!attempt) {
            return setupResponse({ error: 'Setup unavailable', code: 'SETUP_AUTH_UNAVAILABLE' }, 503, mutation.ifMatch);
        }

        const existingUsers = await dbServer.select().from(users).limit(1);
        if (existingUsers.length > 0) {
            /* @Codex */
            abortWebAuthControl(attempt);
            attempt = null;
            return setupResponse({ error: "Setup already completed", code: "SETUP_ALREADY_COMPLETED" }, 409, mutation.ifMatch);
        }

        const rawBody = await request.json();
        const parsedBody = parseApiBody(authSetupSchema, rawBody);
        if (!parsedBody.ok) {
            abortWebAuthControl(attempt);
            attempt = null;
            parsedBody.response.headers.set('Cache-Control', 'no-store');
            setWebAuthControlEtag(parsedBody.response, mutation.ifMatch);
            return parsedBody.response;
        }
        const { username, password, encryptedMasterKey, salt, displayName, ambulatoryName } = parsedBody.data;

        const hashedPassword = await bcrypt.hash(password, 10);

        // WUL-268 (STREAM A): the admin user and its seed settings must be created
        // atomically so a crash can never leave a user without settings (or vice
        // versa). better-sqlite3 transactions are synchronous, so no awaits inside;
        // bcrypt.hash already ran above and the values are plain.
        const userId = uuidv4();
        dbServer.transaction((tx) => {
            tx.insert(users).values({
                id: userId,
                username,
                displayName,
                ambulatoryName,
                role: 'admin', // First user is always admin
                passwordHash: hashedPassword,
                encryptedMasterKey,
                salt,
                createdAt: new Date()
            }).run();

            // Initialize Settings
            if (displayName) {
                tx.insert(settings).values({ key: 'doctorName', value: displayName }).onConflictDoUpdate({ target: settings.key, set: { value: displayName } }).run();
            }
            if (ambulatoryName) {
                tx.insert(settings).values({ key: 'clinicName', value: ambulatoryName }).onConflictDoUpdate({ target: settings.key, set: { value: ambulatoryName } }).run();
            }
        });

        /* @Codex */
        const session = issueWebAuthControl(attempt, { id: userId, username, role: 'admin' });
        attempt = null;
        if (!session) {
            return setupResponse({
                error: 'Setup completed. Sign in to continue.',
                code: 'SETUP_COMMITTED_AUTH_UNAVAILABLE',
            }, 409, mutation.ifMatch);
        }
        const response = NextResponse.json({ success: true, id: userId });
        response.cookies.set(SESSION_COOKIE_NAME, session.sessionId, sessionCookieOptionsForRequest(request));
        setWebAuthControlEtag(response, session.etag);
        return response;
    } catch (error) {
        if (attempt) abortWebAuthControl(attempt);
        console.error("Setup error:", error);
        return setupResponse({ error: "Setup failed" }, 500, mutation?.ifMatch);
    }
}
