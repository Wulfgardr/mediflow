import { NextResponse } from 'next/server';
import { requiresLocalUiDocumentLease } from '@/lib/security/plugin-local-ui-runtime';
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { resolveDataPath } from '@/lib/data-dir';
import { classifyAuthHealthError } from '@/lib/security/auth-health-classifier';
import { parseWrappedMasterKey } from '@/lib/security/security';
import { currentArchiveGeneration } from '@/lib/security/archive-session-generation';
import {
    bootstrapWebAuthControl,
    resolveWebAuthControlSession,
    setWebAuthControlCookie,
    setWebAuthControlEtag,
    webAuthControlIdFromRequest,
    webAuthSessionIdFromRequest,
    type WebAuthControlBootstrap,
} from '@/lib/security/web-auth-control-transport';

export const dynamic = 'force-dynamic';

const getDbHealth = () => {
    const dbPath = resolveDataPath('medical.db');
    const legacyDbPath = path.join(process.cwd(), 'medical.db');

    const dbExists = fs.existsSync(dbPath);
    const legacyExists = fs.existsSync(legacyDbPath);

    const directory = path.dirname(dbPath);
    const serviceFiles = new Set(['local-api-token', 'local-web-backend.pid', 'local-api-tls-proxy.pid', 'runtime-status.json']);
    const firstInstallation = !dbExists && !legacyExists
        && fs.readdirSync(directory, { withFileTypes: true }).every(entry => {
            if (entry.isSymbolicLink()) return false;
            if (entry.isDirectory()) {
                if (entry.name === 'pm2') return true;
                return entry.name === 'launcher' && process.platform === 'darwin'
                    && path.resolve(directory) === path.join(os.homedir(), 'Library/Application Support/MediFlow');
            }
            return entry.isFile() && serviceFiles.has(entry.name);
        });

    return {
        dbExists,
        legacyExists,
        firstInstallation,
    };
};

function buildPublicDbState(
    state: 'ready' | 'missing' | 'schema-missing' | 'unavailable'
) {
    return { state };
}

/* ADR 0143: what the browser needs before it can authenticate. A PIN account discloses nothing new;
   an account with a passphrase discloses its salt, without which the access verifier cannot be derived. */
function unlockParameters(accounts: { encryptedMasterKey: string; salt: string; unlockVerifierHash: string | null }[]) {
    const [account] = accounts;
    if (accounts.length !== 1 || !account.unlockVerifierHash) return { credential: 'pin' as const };
    return {
        credential: 'passphrase' as const,
        kdfVersion: parseWrappedMasterKey(account.encryptedMasterKey).version,
        salt: account.salt,
    };
}

function finalizeControlResponse(
    response: NextResponse,
    request: Request,
    presentedControlId: string | null,
    control: WebAuthControlBootstrap,
) {
    // Resolving an archive-A session can retire it and advance its control fence.
    // Return the post-resolution fence, not the one observed before retirement.
    const currentControl = bootstrapWebAuthControl(control.controlId);
    if (!currentControl || currentControl.controlId !== control.controlId) {
        return NextResponse.json({ status: 'error', isSetup: false, hasSession: false,
            error: { code: 'AUTH_CONTROL_UNAVAILABLE', message: 'Authentication control unavailable.' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    response.headers.set('Cache-Control', 'no-store');
    setWebAuthControlEtag(response, currentControl.etag);
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
    const sessionId = webAuthSessionIdFromRequest(request);
    const resolution = sessionId ? resolveWebAuthControlSession(sessionId, control.controlId) : null;
    const hasSession = resolution?.status === 'active';
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

    if (!dbHealth.dbExists && !dbHealth.legacyExists && !dbHealth.firstInstallation) {
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
        const [{ dbServer }, { users }] = await Promise.all([
            import('@/lib/db-server'),
            import('@/lib/schema'),
        ]);
        const accounts = await dbServer.select({
            encryptedMasterKey: users.encryptedMasterKey, salt: users.salt, unlockVerifierHash: users.unlockVerifierHash,
        }).from(users).limit(2);
        const response = NextResponse.json({
            status: 'ok',
            localUiLeaseRequired: requiresLocalUiDocumentLease(),
            archiveGeneration: currentArchiveGeneration(),
            archiveMaintenance: process.env.MEDIFLOW_ARCHIVE_MAINTENANCE_RESULT
                ? JSON.parse(process.env.MEDIFLOW_ARCHIVE_MAINTENANCE_RESULT) : undefined,
            isSetup: accounts.length > 0,
            hasSession,
            ...(accounts.length > 0 ? { unlock: unlockParameters(accounts) } : {}),
            db: buildPublicDbState('ready')
        });
        return finalizeControlResponse(response, request, presentedControlId, control);
    } catch (error) {
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
