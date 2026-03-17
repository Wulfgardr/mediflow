import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
/* @Codex */
import { hashAuditRef, requestIdFromRequest, writeAuditEvent } from '@/lib/audit';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
/* @Codex */
import { createSession, SESSION_COOKIE_NAME } from '@/lib/server-session';

/* @Codex */
function recordFailedLoginAttempt(request: Request, username: unknown): void {
    void writeAuditEvent({
        eventType: 'auth.login.failed',
        outcome: 'failure',
        actorType: 'user',
        actorRef: hashAuditRef(typeof username === 'string' ? username : ''),
        subjectType: 'session',
        sourceSurface: 'web',
        requestId: requestIdFromRequest(request),
        redactedMetadata: {
            reasonCode: 'invalid_credentials',
        },
    }).catch((error) => {
        console.error('Audit login failure write failed:', error);
    });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { username, password } = body;

        const user = await dbServer.select().from(users).where(eq(users.username, username)).get();

        if (!user || !user.passwordHash) {
            recordFailedLoginAttempt(request, username);
            return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        if (!isValid) {
            recordFailedLoginAttempt(request, username);
            return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
        }

        // Return the encrypted key blob. 
        // NOTE: We do NOT set a session cookie here yet because this is a local app 
        // and we rely on the client holding the decrypted MasterKey in memory as the "Session".
        // If they reload, they must login again to decrypt the key. 
        // This is arguably more secure than a persistent cookie for a medical app.

        /* @Codex */
        const session = createSession({ id: user.id, username: user.username, role: user.role || 'user' });
        try {
            await writeAuditEvent({
                eventType: 'auth.login.succeeded',
                outcome: 'success',
                actorType: 'user',
                actorRef: user.id,
                subjectType: 'session',
                subjectRef: session.id,
                sourceSurface: 'web',
                requestId: requestIdFromRequest(request),
            });
        } catch (error) {
            console.error('Audit login success write failed:', error);
        }
        const response = NextResponse.json({
            success: true,
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            ambulatoryName: user.ambulatoryName,
            role: user.role,
            encryptedMasterKey: user.encryptedMasterKey,
            salt: user.salt
        });
        response.cookies.set(SESSION_COOKIE_NAME, session.id, {
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            path: '/'
        });
        return response;
    } catch (error) {
        console.error("Login error:", error);
        return NextResponse.json({ error: "Login failed" }, { status: 500 });
    }
}
