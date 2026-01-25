import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users, settings } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

export async function POST(request: Request) {
    try {
        const existingUsers = await dbServer.select().from(users).limit(1);
        if (existingUsers.length > 0) {
            return NextResponse.json({ error: "Setup already completed" }, { status: 403 });
        }

        const body = await request.json();
        const { username, password, encryptedMasterKey, salt, displayName, ambulatoryName } = body;

        if (!username || !password || !encryptedMasterKey || !salt) {
            return NextResponse.json({ error: "Missing fields" }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Transaction-like insertion (SQLite doesn't support strict transactions in HTTP stateless easily without extensive logic, but sequential is fine here)
        await dbServer.insert(users).values({
            id: uuidv4(),
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

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Setup error:", error);
        return NextResponse.json({ error: "Setup failed" }, { status: 500 });
    }
}
