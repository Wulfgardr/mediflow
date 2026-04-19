import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import { count } from 'drizzle-orm';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/data-dir';
import { requireSession } from '@/lib/server-auth';

/* @Codex */
export const dynamic = 'force-dynamic';

/* @Codex */
const getDbHealth = () => {
    const dbPath = resolveDataPath('medical.db');
    const legacyDbPath = path.join(process.cwd(), 'medical.db');

    const dbExists = fs.existsSync(dbPath);
    const legacyExists = fs.existsSync(legacyDbPath);

    return {
        dbExists,
        legacyExists
    };
};

/* @Codex */
function buildPublicDbState(
    state: 'ready' | 'missing' | 'schema-missing' | 'unavailable'
) {
    return { state };
}

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
    const hasSession = !!(await requireSession());
    /* @Codex */
    if (!dbHealth) {
        const response = NextResponse.json({
            status: 'error',
            isSetup: false,
            hasSession,
            error: { code: 'DATA_DIR_UNAVAILABLE', message: dbHealthError || 'Data directory unavailable.' },
            db: buildPublicDbState('unavailable')
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
            db: buildPublicDbState('ready')
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
            db: buildPublicDbState(code === 'DB_SCHEMA_MISSING' ? 'schema-missing' : 'missing')
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }
}
