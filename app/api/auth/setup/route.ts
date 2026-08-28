import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users, settings } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
/* @Codex */
import { SESSION_COOKIE_NAME } from '@/lib/security/server-session';
/* @Codex */
import {
    abort as abortWebAuthSession,
    begin as beginWebAuthSession,
    issue as issueWebAuthSession,
    type WebAuthSessionAttempt,
} from '@/lib/security/web-auth-session-issuer';
/* @Codex */
import { sessionCookieOptionsForRequest } from '@/lib/security/request-transport';
/* @Codex */
import { authSetupSchema } from '@/lib/api-schemas/auth';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';

export async function POST(request: Request) {
    let attempt: WebAuthSessionAttempt | null = null;
    try {
        const existingUsers = await dbServer.select().from(users).limit(1);
        if (existingUsers.length > 0) {
            /* @Codex */
            return NextResponse.json({ error: "Setup already completed", code: "SETUP_ALREADY_COMPLETED" }, { status: 409 });
        }

        const rawBody = await request.json();
        const parsedBody = parseApiBody(authSetupSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const { username, password, encryptedMasterKey, salt, displayName, ambulatoryName } = parsedBody.data;

        const hashedPassword = await bcrypt.hash(password, 10);

        // WUL-268 (STREAM A): the admin user and its seed settings must be created
        // atomically so a crash can never leave a user without settings (or vice
        // versa). better-sqlite3 transactions are synchronous, so no awaits inside;
        // bcrypt.hash already ran above and the values are plain.
        const userId = uuidv4();
        attempt = beginWebAuthSession('setup');
        if (!attempt) {
            return NextResponse.json({ error: 'Setup unavailable', code: 'SETUP_AUTH_UNAVAILABLE' }, { status: 503 });
        }
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
        const session = issueWebAuthSession(attempt, { id: userId, username, role: 'admin' });
        attempt = null;
        if (!session) {
            return NextResponse.json({
                error: 'Setup completed. Sign in to continue.',
                code: 'SETUP_COMMITTED_AUTH_UNAVAILABLE',
            }, { status: 409 });
        }
        const response = NextResponse.json({ success: true, id: userId });
        response.cookies.set(SESSION_COOKIE_NAME, session.sessionId, sessionCookieOptionsForRequest(request));
        return response;
    } catch (error) {
        if (attempt) abortWebAuthSession(attempt);
        console.error("Setup error:", error);
        return NextResponse.json({ error: "Setup failed" }, { status: 500 });
    }
}
