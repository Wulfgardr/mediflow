import { NextResponse } from 'next/server';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/data-dir';
import { classifyAuthHealthError } from '@/lib/security/auth-health-classifier';
/* @Codex */
import {
    bootstrapWebAuthControl,
    resolveWebAuthControlSession,
    setWebAuthControlCookie,
    setWebAuthControlEtag,
    webAuthControlIdFromRequest,
    webAuthSessionIdFromRequest,
    type WebAuthControlBootstrap,
} from '@/lib/security/web-auth-control-transport';

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
function finalizeControlResponse(
    response: NextResponse,
    request: Request,
    presentedControlId: string | null,
    control: WebAuthControlBootstrap,
) {
    response.headers.set('Cache-Control', 'no-store');
    setWebAuthControlEtag(response, control.etag);
    if (presentedControlId !== control.controlId) setWebAuthControlCookie(response, request, control.controlId);
    return response;
}

export async function GET(request: Request) {
    const presentedControlId = webAuthControlIdFromRequest(request);
    const control = bootstrapWebAuthControl(presentedControlId);
    if (!control) {
        const response = NextResponse.json({
            status: 'error',
            isSetup: false,
            hasSession: false,
            error: {
                code: 'AUTH_CONTROL_UNAVAILABLE',
                category: 'unknown',
                message: 'Authentication control unavailable.',
                nextAction: 'Retry the authentication check.',
            },
            db: buildPublicDbState('unavailable'),
        }, { status: 503 });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }

    /* @Codex */
    let dbHealth: ReturnType<typeof getDbHealth> | null = null;
    /* WUL-547. Qui passava `error.message` grezzo: percorsi del filesystem e
       internals SQLite finivano nella risposta. Il ramo generico piu' sotto usava
       gia' il classificatore; questo no, ed era l'unico che non lo faceva.
       Il dettaglio resta nel log, al client va il messaggio autoriale. */
    let dbHealthClassification: ReturnType<typeof classifyAuthHealthError> | null = null;
    try {
        dbHealth = getDbHealth();
    } catch (error) {
        dbHealthClassification = classifyAuthHealthError(error);
        console.error('[auth-check]', dbHealthClassification.code, dbHealthClassification.message);
    }
    /* @Codex */
    const sessionId = webAuthSessionIdFromRequest(request);
    const resolution = sessionId ? resolveWebAuthControlSession(sessionId, control.controlId) : null;
    const hasSession = resolution?.status === 'active';
    /* @Codex */
    if (!dbHealth) {
        const response = NextResponse.json({
            status: 'error',
            isSetup: false,
            hasSession,
            /* `code`, `category` e `dbState` restano i valori stabili di prima: il
               client Apple decodifica questa risposta con tipi non opzionali, e la
               correzione del leak non e' il posto per cambiare il contratto. */
            error: {
                code: 'DATA_DIR_UNAVAILABLE',
                category: 'data-dir-unavailable',
                message: dbHealthClassification?.message ?? 'Data directory unavailable.',
                nextAction: 'Verify that the data directory exists and is writable, then retry.'
            },
            db: buildPublicDbState('unavailable')
        });
        return finalizeControlResponse(response, request, presentedControlId, control);
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
        return finalizeControlResponse(response, request, presentedControlId, control);
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
        return finalizeControlResponse(response, request, presentedControlId, control);
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
        return finalizeControlResponse(response, request, presentedControlId, control);
    }
}
