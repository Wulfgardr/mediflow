import 'server-only';

import crypto from 'crypto';
import fs from 'fs';
import { resolveDataPath } from '../data-dir';

export function getOrCreateLocalApiToken(): string {
    if (process.env.MEDIFLOW_LOCAL_API_TOKEN) {
        return process.env.MEDIFLOW_LOCAL_API_TOKEN;
    }

    const tokenFile = resolveDataPath('local-api-token');
    if (fs.existsSync(tokenFile)) {
        const token = fs.readFileSync(tokenFile, 'utf8').trim();
        if (token.length > 0) {
            return token;
        }
    }

    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
    if (process.platform !== 'win32') {
        fs.chmodSync(tokenFile, 0o600);
    }
    return token;
}
