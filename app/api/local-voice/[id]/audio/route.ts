import { localVoiceBridge } from '@/lib/local-voice/web-bridge';
import { localVoiceCaller, voiceReply } from '@/lib/local-voice/web-request';
import { LOCAL_VOICE_MAX_REQUEST_BYTES } from '@/lib/local-voice/client.mjs';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const caller = await localVoiceCaller(request);
    if (caller instanceof Response) return caller;
    if (request.headers.get('content-type') !== 'application/octet-stream') return voiceReply({ status: 400, body: { error: 'request' } });
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > LOCAL_VOICE_MAX_REQUEST_BYTES) return voiceReply({ status: 413, body: { error: 'too-large' } });
    const pcm = new Uint8Array(await request.arrayBuffer());
    if (pcm.byteLength > LOCAL_VOICE_MAX_REQUEST_BYTES) return voiceReply({ status: 413, body: { error: 'too-large' } });
    const { id } = await params;
    const url = new URL(request.url);
    try {
        return voiceReply(await localVoiceBridge().audio(caller.user, id, url.searchParams.get('subject'), url.searchParams.get('seq'), pcm));
    } finally { pcm.fill(0); }
}
