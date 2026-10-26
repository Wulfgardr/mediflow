import { readNativeNetworkJson } from '@/lib/native-network-json-body';
import { requirePairedNativeSession } from '@/lib/security/paired-native-session';
import { CHAT_ACCESS_OPERATION, confirmNativeChatAccessPin, nativeChatAccessEligibility } from '@/lib/security/native-chat-access-confirmation';
import { archiveGenerationForSession } from '@/lib/security/archive-session-generation';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
    let status: 'eligible' | 'denied' | 'locked' = 'denied';
    try {
        const session = await requirePairedNativeSession(request);
        if (session && !new URL(request.url).search
            && request.headers.get('x-mediflow-archive-generation') === archiveGenerationForSession(session)) {
            status = nativeChatAccessEligibility(session);
        }
    } catch { status = 'denied'; }
    return Response.json({ status }, { status: status === 'eligible' ? 200 : status === 'locked' ? 423 : 403,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

export async function POST(request: Request): Promise<Response> {
    const reply = (status: string, code = 403) => Response.json({ status }, { status: code,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    try {
        const session = await requirePairedNativeSession(request);
        if (!session || new URL(request.url).search || request.headers.get('x-mediflow-archive-generation') !== archiveGenerationForSession(session)) return reply('denied');
        const body = await readNativeNetworkJson(request, 512, {
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(2000)]), deadline: performance.now() + 2000,
        }) as Record<string, unknown>;
        if (!body || Object.keys(body).sort().join(',') !== 'operation,pin' || body.operation !== CHAT_ACCESS_OPERATION
            || typeof body.pin !== 'string' || !/^[0-9]{4,8}$/u.test(body.pin)) return reply('denied', 400);
        const status = await confirmNativeChatAccessPin(session, body.pin);
        return reply(status, status === 'confirmed' ? 200 : status === 'locked' ? 423 : 403);
    } catch { return reply('denied'); }
}
