/* @Codex */
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
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
            // NextRequest normalizes loopback URLs; the canonical guard uses browser Host.
            || !isTrustedWebMutationRequest(request, false)
            || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
            return reply({ error: 'input_invalid' }, 400);
        const controller = new AbortController();
        const deadline = performance.now() + 5000;
        const timer = setTimeout(() => controller.abort(), 5000);
        const abortRequest = () => controller.abort();
        request.signal.addEventListener('abort', abortRequest, { once: true });
        if (request.signal.aborted) controller.abort();
        let body: unknown;
        try {
            const parsed = await readBoundedJsonBody(request, 256, 'strict', { signal: controller.signal, deadline });
            if (request.signal.aborted) throw new LocalProviderOnboardingError('verification_interrupted');
            // Preserve the route's existing 400 contract and byte/time limits.
            if (!parsed.ok) return reply({ error: 'input_invalid' }, 400);
            body = parsed.value;
        } finally {
            clearTimeout(timer);
            request.signal.removeEventListener('abort', abortRequest);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).sort().join(',') !== 'expectedRevision,intent'
            || (body as { intent: unknown }).intent !== 'verify_and_activate'
            || typeof (body as { expectedRevision: unknown }).expectedRevision !== 'string')
            return reply({ error: 'input_invalid' }, 400);
        return reply(await service.activate((body as { expectedRevision: string }).expectedRevision, request.signal));
    } catch (error) { return failure(error); }
}
