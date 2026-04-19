/* @Codex */
import 'server-only';

import { URL } from 'url';

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', 'host.docker.internal']);
const ALLOWED_PORTS = new Set(['11434', '8080', '8888', '18080']);

export function validateLocalTarget(rawUrl: string | null | undefined): { ok: true; url: URL } | { ok: false; reason: string } {
    if (!rawUrl) return { ok: false, reason: 'Missing target URL' };

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, reason: 'Invalid target URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'Invalid protocol' };
    }

    if (parsed.username || parsed.password) {
        return { ok: false, reason: 'Credentials not allowed in URL' };
    }

    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
        return { ok: false, reason: 'Host not allowed' };
    }

    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (!ALLOWED_PORTS.has(port)) {
        return { ok: false, reason: 'Port not allowed' };
    }

    return { ok: true, url: parsed };
}
