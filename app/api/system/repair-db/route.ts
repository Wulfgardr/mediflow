/* @Codex */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/data-dir';
import { swapDatabaseFromFile } from '@/lib/db-server';
import { SqliteSwapInProgressError } from '@/lib/sqlite-repair';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/server-auth-policy';

/* @Codex */
export const dynamic = 'force-dynamic';

/* @Codex */
const timestamp = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    // Millisecond precision: a second-granularity name lets two repairs in the
    // same second silently overwrite each other's .bak file.
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${now.getMilliseconds().toString().padStart(3, '0')}`;
};

/* @Codex */
export async function POST() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const dbPath = resolveDataPath('medical.db');
        const legacyDbPath = path.join(process.cwd(), 'medical.db');

        if (!fs.existsSync(legacyDbPath)) {
            return NextResponse.json({ success: false, error: 'Legacy DB not found.' }, { status: 404 });
        }

        if (path.resolve(dbPath) === path.resolve(legacyDbPath)) {
            return NextResponse.json({ success: false, error: 'Legacy DB path equals target.' }, { status: 400 });
        }

        let backupPath: string | null = null;
        if (fs.existsSync(dbPath)) {
            backupPath = `${dbPath}.bak-${timestamp()}`;
        }

        // Swap through the shared connection (checkpoint + close, consistent
        // backup, copy via the SQLite backup API, reopen) so the live file is
        // never overwritten in place and WAL sidecars cannot leak across DBs.
        await swapDatabaseFromFile(legacyDbPath, backupPath);

        return NextResponse.json({
            success: true,
            backupCreated: Boolean(backupPath)
        });
    } catch (error) {
        if (error instanceof SqliteSwapInProgressError) {
            return NextResponse.json({ success: false, error: 'Repair already in progress.' }, { status: 409 });
        }
        console.error('[MediFlow] Repair DB failed:', error);
        return NextResponse.json({ success: false, error: 'Repair failed.' }, { status: 500 });
    }
}
