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

export async function POST(request: Request) {
    try {
        const existingUsers = await dbServer.select().from(users).limit(1);
        if (existingUsers.length > 0) {
            /* @Codex */
            return NextResponse.json({ error: "Setup already completed", code: "SETUP_ALREADY_COMPLETED" }, { status: 403 });
        }

        const body = await request.json();
        const { username, password, encryptedMasterKey, salt, displayName, ambulatoryName } = body;

        if (!username || !password || !encryptedMasterKey || !salt) {
            return NextResponse.json({ error: "Missing fields" }, { status: 400 });
        }

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
