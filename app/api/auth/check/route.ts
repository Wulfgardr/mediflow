import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import { count } from 'drizzle-orm';
/* @Codex */
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE_NAME } from '@/lib/server-session';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { getDataDir, resolveDataPath } from '@/lib/data-dir';

/* @Codex */
export const dynamic = 'force-dynamic';

/* @Codex */
const getDbHealth = () => {
    const dataDir = getDataDir();
    const dbPath = resolveDataPath('medical.db');
    const legacyDbPath = path.join(process.cwd(), 'medical.db');

    const dbExists = fs.existsSync(dbPath);
    const legacyExists = fs.existsSync(legacyDbPath);

    const dbSizeBytes = dbExists ? fs.statSync(dbPath).size : undefined;
    const canAccess = (mode: number) => {
        try {
            fs.accessSync(dbPath, mode);
            return true;
        } catch {
            return false;
        }
    };

    return {
        dataDir,
        dbPath,
        dbExists,
        dbReadable: dbExists ? canAccess(fs.constants.R_OK) : false,
        dbWritable: dbExists ? canAccess(fs.constants.W_OK) : false,
        dbSizeBytes,
        legacyDbPath,
        legacyExists
    };
};

export async function GET() {
    /* @Codex */
    let dbHealth: ReturnType<typeof getDbHealth> | null = null;
    let dbHealthError: string | null = null;
    try {
        dbHealth = getDbHealth();
    } catch (error) {
        dbHealthError = error instanceof Error ? error.message : 'Unknown error';
    }
    /* @Codex */
    /* @Codex */
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const hasSession = !!getSession(sessionId);
    /* @Codex */
    if (!dbHealth) {
        const response = NextResponse.json({
            status: 'error',
            isSetup: false,
            hasSession,
            error: { code: 'DATA_DIR_UNAVAILABLE', message: dbHealthError || 'Data directory unavailable.' }
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }
    try {
        // Count users efficiently
        const result = await dbServer.select({ count: count() }).from(users);
        const userCount = result[0].count;
        const response = NextResponse.json({
            /* @Codex */
            status: 'ok',
            isSetup: userCount > 0,
            hasSession,
            /* @Codex */
            db: { ...dbHealth, schemaOk: true }
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        /* @Codex */
        const message = error instanceof Error ? error.message : 'Unknown error';
        const code = message.includes('no such table') ? 'DB_SCHEMA_MISSING' : 'DB_QUERY_FAILED';
        console.error("Auth check error:", error);
        const response = NextResponse.json({
            status: 'error',
            isSetup: false,
            hasSession,
            error: { code, message },
            db: { ...dbHealth, ...(code === 'DB_SCHEMA_MISSING' ? { schemaOk: false } : {}) }
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }
}
