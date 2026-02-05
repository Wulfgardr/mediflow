/* @Codex */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/data-dir';

/* @Codex */
export const dynamic = 'force-dynamic';

/* @Codex */
const timestamp = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

/* @Codex */
export async function POST() {
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
            fs.copyFileSync(dbPath, backupPath);
        }

        fs.copyFileSync(legacyDbPath, dbPath);

        return NextResponse.json({ success: true, dbPath, backupPath });
    } catch (error) {
        console.error('[MediFlow] Repair DB failed:', error);
        return NextResponse.json({ success: false, error: 'Repair failed.' }, { status: 500 });
    }
}
