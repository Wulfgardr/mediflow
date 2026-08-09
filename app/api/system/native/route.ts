/* @Codex */
import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { apiInternalError } from '@/lib/api-error-response';

const execFileAsync = promisify(execFile);
const APP_NAME = 'MediFlowMac';
const APP_PATH = path.join(process.cwd(), 'native', 'MediFlowMac', 'Build', 'MediFlowMac.app');

function isLocalRequest(request: Request): boolean {
    const host = request.headers.get('host');
    if (!host) return false;
    const hostname = host.split(':')[0];
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    if (!isLocalRequest(request)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        if (fs.existsSync(APP_PATH)) {
            await execFileAsync('open', [APP_PATH]);
        } else {
            await execFileAsync('open', ['-a', APP_NAME]);
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        /* Il messaggio grezzo qui conterrebbe il percorso dell'applicazione. */
        return apiInternalError('POST /api/system/native (open)', error);
    }
}
