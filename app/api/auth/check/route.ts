import { NextResponse } from 'next/server';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/data-dir';
import { classifyAuthHealthError } from '@/lib/security/auth-health-classifier';

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

/* @Codex */
async function safeRequireSession(): Promise<boolean> {
    try {
        const { requireSession } = await import('@/lib/security/server-auth');
        return !!(await requireSession());
    } catch {
        return false;
    }
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
    const hasSession = await safeRequireSession();
    /* @Codex */
    if (!dbHealth) {
        const response = NextResponse.json({
            status: 'error',
            isSetup: false,
            hasSession,
            error: {
                code: 'DATA_DIR_UNAVAILABLE',
                category: 'data-dir-unavailable',
                message: dbHealthError || 'Data directory unavailable.',
                nextAction: 'Verify that the data directory exists and is writable, then retry.'
            },
            db: buildPublicDbState('unavailable')
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }

    /* @Codex */
    if (!dbHealth.dbExists && !dbHealth.legacyExists) {
        const response = NextResponse.json({
            status: 'error',
            isSetup: false,
            hasSession,
            error: {
                code: 'DB_MISSING',
                category: 'db-missing',
                message: 'Database locale non trovato.',
                nextAction: 'Verifica la cartella dati di MediFlow o ripristina un backup locale valido.'
            },
            db: buildPublicDbState('missing')
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }

    try {
        /* @Codex */
        const [{ dbServer }, { users }, { count }] = await Promise.all([
            import('@/lib/db-server'),
            import('@/lib/schema'),
            import('drizzle-orm'),
        ]);
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
        const classification = classifyAuthHealthError(error);
        console.error('[auth-check]', classification.code, classification.message);
        const response = NextResponse.json({
            status: 'error',
            isSetup: false,
            hasSession,
            error: {
                code: classification.code,
                category: classification.category,
                message: classification.message,
                remediationCommand: classification.remediationCommand,
                nextAction: classification.nextAction,
            },
            db: buildPublicDbState(classification.dbState)
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }
}
