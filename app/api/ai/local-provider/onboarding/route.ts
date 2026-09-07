/* @Codex */
import { getLocalProviderOnboardingService, LocalProviderOnboardingError } from '@/lib/ai-providers/fabric/local-provider-onboarding-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function failure(error: unknown) {
    const code = error instanceof LocalProviderOnboardingError ? error.code : 'state_unavailable';
    return reply({ error: code }, code === 'owner_locked' ? 401
        : code === 'input_invalid' ? 400 : code === 'provider_unreachable' ? 503 : 409);
}
export async function GET(request: Request) {
    try {
        const status = await (await getLocalProviderOnboardingService()).inspect();
        if (new URL(request.url).searchParams.size) return reply({ error: 'input_invalid' }, 400);
        return reply(status);
    }
    catch (error) { return failure(error); }
}
export async function POST(request: Request) {
    try {
        const service = await getLocalProviderOnboardingService();
        // Authentication precedes body parsing and all provider contact.
        await service.inspect();
        if (new URL(request.url).searchParams.size
            || request.headers.get('origin') !== new URL(request.url).origin
            || request.headers.get('sec-fetch-site') === 'cross-site'
            || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
            return reply({ error: 'input_invalid' }, 400);
        const reader = request.body?.getReader();
        if (!reader) return reply({ error: 'input_invalid' }, 400);
        const chunks: Uint8Array[] = [];
        let size = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                (async () => {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        size += value.byteLength;
                        if (size > 256) throw new LocalProviderOnboardingError('input_invalid');
                        chunks.push(value);
                    }
                })(),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new LocalProviderOnboardingError('input_invalid')), 5000); }),
            ]);
        } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reply({ error: 'input_invalid' }, 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).sort().join(',') !== 'expectedRevision,intent'
            || (body as { intent: unknown }).intent !== 'verify_and_activate'
            || typeof (body as { expectedRevision: unknown }).expectedRevision !== 'string')
            return reply({ error: 'input_invalid' }, 400);
        return reply(await service.activate((body as { expectedRevision: string }).expectedRevision));
    } catch (error) { return failure(error); }
}
