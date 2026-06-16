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
    fs.mkdirSync(dir, { recursive: true });
    cachedDir = dir;
    return dir;
}

export function resolveDataPath(...segments: string[]): string {
    return path.join(/* turbopackIgnore: true */ getDataDir(), ...segments);
}
