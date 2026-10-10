/* @Codex */
import 'server-only';

import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_DATA_DIR =
    process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
        : path.join(os.homedir(), '.mediflow');

let cachedDir: string | null = null;

export function getDataDir(): string {
    if (cachedDir) return cachedDir;
    const dir = process.env.MEDIFLOW_DATA_DIR || DEFAULT_DATA_DIR;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // The archive, its backups and its logs hold patient data in clear: the default directory is
    // closed to other accounts even when an earlier version created it. A directory the operator
    // chose is left as the operator set it.
    if (dir === DEFAULT_DATA_DIR && process.platform !== 'win32') {
        const { mode, uid } = fs.statSync(dir);
        if ((mode & 0o077) !== 0 && uid === process.getuid?.()) fs.chmodSync(dir, 0o700);
    }
    cachedDir = dir;
    return dir;
}

export function resolveDataPath(...segments: string[]): string {
    return path.join(/* turbopackIgnore: true */ getDataDir(), ...segments);
}
