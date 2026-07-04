/* @Codex */
import 'server-only';

import crypto from 'crypto';
import fs from 'fs';
import { resolveDataPath } from '../data-dir';

const TOKEN_FILE = resolveDataPath('local-api-token');

export function getOrCreateLocalApiToken(): string {
    if (process.env.MEDIFLOW_LOCAL_API_TOKEN) {
        return process.env.MEDIFLOW_LOCAL_API_TOKEN;
    }

    if (fs.existsSync(TOKEN_FILE)) {
        const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        if (token.length > 0) {
            return token;
        }
    }

    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    return token;
}
