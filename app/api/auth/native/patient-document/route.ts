import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { readNativeNetworkJson } from '@/lib/native-network-json-body';
import { nativePatientDocumentService } from '@/lib/native-patient-document-production';
import { PatientDocumentDuplicateReviewRequired, type PatientDocumentCreateReview } from '@/lib/patient-document-create-command';
import { COMMAND_UUID } from '@/lib/therapy-status-command-contract';
import { NativePatientDocumentExtractionFailed } from '@/lib/native-patient-document';
import { hasAttestedLoopbackIngress } from '@/lib/security/loopback-ingress.mjs';

export const runtime = 'nodejs';
const reply = (value: unknown, status = 200) => Response.json(value, { status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
let active = 0;
export async function POST(request: Request): Promise<Response> {
    // This native-only intake accepts originless clients, never browser-origin requests.
    if (!hasAttestedLoopbackIngress(request) || request.headers.has('origin')
        || ![null, 'none'].includes(request.headers.get('sec-fetch-site'))
        || request.headers.get('content-type')?.toLowerCase() !== 'application/json') return reply({ status: 'denied' }, 403);
    if (active >= 2) return reply({ status: 'denied' }, 503);
    active += 1;
    try {
        const resolved = await requireNetworkCapabilityContext(request, 'network.replica.write-patient-lifecycle');
        if (!resolved.ok) return reply({ status: 'denied' }, resolved.response.status);
        if (resolved.context.session.authChannel !== 'native' || new URL(request.url).search) return reply({ status: 'denied' }, 403);
        const body = await readNativeNetworkJson(request, 35 * 1024 * 1024,
            { signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]), deadline: performance.now() + 10_000 });
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ status: 'denied' }, 400);
        const input = body as Record<string, unknown>, keys = Object.keys(input).sort().join(',');
        const context = resolved.context;
        if (input.operation === 'stage' && keys === 'operation,source') return reply(await nativePatientDocumentService.stage(context, input.source));
        if (typeof input.commandId !== 'string' || !COMMAND_UUID.test(input.commandId)) return reply({ status: 'denied' }, 400);
        if (input.operation === 'preview' && keys === 'commandId,operation,review,viewId' && typeof input.viewId === 'string') {
            return reply(await nativePatientDocumentService.preview(context, input.commandId, input.viewId, input.review as PatientDocumentCreateReview));
        }
        if (input.operation === 'execute' && keys === 'commandId,operation,pin'
            && typeof input.pin === 'string' && /^[0-9]{4,8}$/u.test(input.pin)) {
            return reply(await nativePatientDocumentService.execute(context, input.commandId, input.pin));
        }
        if (input.operation === 'receipt' && keys === 'commandId,operation') return reply(await nativePatientDocumentService.receipt(context, input.commandId));
        if (input.operation === 'revoke' && keys === 'commandId,operation') return reply(await nativePatientDocumentService.revoke(context, input.commandId));
        return reply({ status: 'denied' }, 400);
    } catch (error) {
        if (error instanceof NativePatientDocumentExtractionFailed) return reply({ status: 'review-required', detail: error.detail }, 409);
        return error instanceof PatientDocumentDuplicateReviewRequired
            ? reply({ status: 'duplicate-review-required' }, 409) : reply({ status: 'denied' }, 403);
    } finally { active -= 1; }
}
