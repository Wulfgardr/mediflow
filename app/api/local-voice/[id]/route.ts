import { localVoiceBridge } from '@/lib/local-voice/web-bridge';
import { localVoiceCaller, voiceReply } from '@/lib/local-voice/web-request';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
    const caller = await localVoiceCaller(request);
    if (caller instanceof Response) return caller;
    const { id } = await params;
    return voiceReply(await localVoiceBridge().snapshot(caller.user, id, new URL(request.url).searchParams.get('subject')));
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
    const caller = await localVoiceCaller(request);
    if (caller instanceof Response) return caller;
    const { id } = await params;
    return voiceReply(await localVoiceBridge().discard(caller.user, id, new URL(request.url).searchParams.get('subject')));
}
