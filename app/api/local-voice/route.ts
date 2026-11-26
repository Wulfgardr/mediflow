import { localVoiceBridge } from '@/lib/local-voice/web-bridge';
import { localVoiceCaller, voiceReply } from '@/lib/local-voice/web-request';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
    const caller = await localVoiceCaller(request);
    if (caller instanceof Response) return caller;
    return voiceReply(await localVoiceBridge().status(caller.user, new URL(request.url).searchParams.get('subject')));
}

export async function POST(request: Request): Promise<Response> {
    const caller = await localVoiceCaller(request);
    if (caller instanceof Response) return caller;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return voiceReply({ status: 400, body: { error: 'request' } });
    return voiceReply(await localVoiceBridge().create(caller.user, body));
}
