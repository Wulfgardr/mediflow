import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { requireSession } from '@/lib/security/server-auth';
import type { LocalVoiceReply } from './web-bridge';

const NO_STORE = { 'Cache-Control': 'no-store' };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function voiceReply({ status, body }: LocalVoiceReply): Response {
    return status === 204 ? new Response(null, { status, headers: NO_STORE }) : Response.json(body, { status, headers: NO_STORE });
}

/** The microphone and the service live on this computer: only the local page of a Web session reaches them. */
function localPageRequest(request: Request, mutation: boolean): boolean {
    try {
        const url = new URL(request.url);
        const host = request.headers.get('host');
        const visible = host === null ? url : new URL(`${url.protocol}//${host}`);
        if (!LOOPBACK.has(url.hostname) || !LOOPBACK.has(visible.hostname) || (host !== null && visible.host !== host)) return false;
        if (request.headers.get('sec-fetch-site') !== 'same-origin') return false;
        return !mutation || request.headers.get('origin') === visible.origin;
    } catch {
        return false;
    }
}

export async function localVoiceCaller(request: Request): Promise<{ user: string } | Response> {
    const mutation = request.method !== 'GET' && request.method !== 'HEAD';
    let session;
    try { session = await requireSession(); } catch { session = null; }
    if (!session) return voiceReply({ status: 401, body: { error: 'unauthorized' } });
    if (session.authChannel !== 'web' || !localPageRequest(request, mutation)) return voiceReply({ status: 403, body: { error: 'denied' } });
    if (mutation) {
        const denial = archiveWriteRequestDenial(request, session);
        if (denial) return denial;
    }
    return { user: session.userId };
}
