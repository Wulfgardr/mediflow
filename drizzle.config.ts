import { defineConfig } from 'drizzle-kit';
/* @Codex */
import os from 'os';
import path from 'path';

/* @Codex */
const defaultDataDir =
    process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
        : path.join(os.homedir(), '.mediflow');
const dataDir = process.env.MEDIFLOW_DATA_DIR || defaultDataDir;
const dbPath = path.join(dataDir, 'medical.db');

export default defineConfig({
    schema: './lib/schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    dbCredentials: {
        // @Codex
        url: dbPath,
    },
});
