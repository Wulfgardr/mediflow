import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users, settings } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
/* @Codex */
import { auditSourceSurfaceFromRequest } from '@/lib/audit';
/* @Codex */
import { createSession, SESSION_COOKIE_NAME } from '@/lib/server-session';
/* @Codex */
import { sessionCookieOptionsForRequest } from '@/lib/request-transport';
/* @Codex */
import { authSetupSchema } from '@/lib/api-schemas/auth';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';

export async function POST(request: Request) {
    try {
        const existingUsers = await dbServer.select().from(users).limit(1);
        if (existingUsers.length > 0) {
            /* @Codex */
            return NextResponse.json({ error: "Setup already completed", code: "SETUP_ALREADY_COMPLETED" }, { status: 403 });
        }

        const rawBody = await request.json();
        const parsedBody = parseApiBody(authSetupSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const { username, password, encryptedMasterKey, salt, displayName, ambulatoryName } = parsedBody.data;

        const hashedPassword = await bcrypt.hash(password, 10);

        // Transaction-like insertion (SQLite doesn't support strict transactions in HTTP stateless easily without extensive logic, but sequential is fine here)
        const userId = uuidv4();
        await dbServer.insert(users).values({
            id: userId,
            username,
            displayName,
            ambulatoryName,
            role: 'admin', // First user is always admin
            passwordHash: hashedPassword,
            encryptedMasterKey,
            salt,
            createdAt: new Date()
        });

        // Initialize Settings
        if (displayName) {
            await dbServer.insert(settings).values({ key: 'doctorName', value: displayName }).onConflictDoUpdate({ target: settings.key, set: { value: displayName } });
        }
        if (ambulatoryName) {
            await dbServer.insert(settings).values({ key: 'clinicName', value: ambulatoryName }).onConflictDoUpdate({ target: settings.key, set: { value: ambulatoryName } });
        }

        /* @Codex */
        const sourceSurface = auditSourceSurfaceFromRequest(request, 'web');
        const session = createSession(
            { id: userId, username, role: 'admin' },
            sourceSurface === 'native' ? 'native' : 'web',
        );
        const response = NextResponse.json({ success: true });
        response.cookies.set(SESSION_COOKIE_NAME, session.id, sessionCookieOptionsForRequest(request));
        return response;
    } catch (error) {
        console.error("Setup error:", error);
        return NextResponse.json({ error: "Setup failed" }, { status: 500 });
    }
}
