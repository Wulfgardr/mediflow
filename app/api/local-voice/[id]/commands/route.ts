import { localVoiceBridge } from '@/lib/local-voice/web-bridge';
import { localVoiceCaller, voiceReply } from '@/lib/local-voice/web-request';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const caller = await localVoiceCaller(request);
    if (caller instanceof Response) return caller;
    const { id } = await params;
    const body = await request.json().catch(() => null) as { subject?: unknown; command?: unknown } | null;
    if (!body || typeof body !== 'object') return voiceReply({ status: 400, body: { error: 'request' } });
    return voiceReply(await localVoiceBridge().command(caller.user, id, body.subject, body.command));
}
