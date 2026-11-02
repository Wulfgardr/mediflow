import { cookies } from 'next/headers';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { erasePatientDocumentFileKey } from '@/lib/patient-document-file-verification';
import { requireSession } from '@/lib/security/server-auth';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { webPatientDocumentScope, webPatientDocumentService } from '@/lib/web-patient-document-production';
import { PatientDocumentDuplicateReviewRequired, type PatientDocumentCreateReview } from '@/lib/patient-document-create-command';
import { NativePatientDocumentExtractionFailed } from '@/lib/native-patient-document';
import { COMMAND_UUID } from '@/lib/therapy-status-command-contract';

export const runtime = 'nodejs';
/** A 10 MiB PDF sealed as ENC2 plus its base64 original stays below 28 MB of JSON. */
const BODY_LIMIT = 30 * 1024 * 1024;
const reply = (value: unknown, status = 200) => Response.json(value, { status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
let active = 0;

/** Same closed operations as the native route, for the local Web session that creates patients. */
export async function POST(request: Request): Promise<Response> {
    const session = await requireSession();
    if (!session) return reply({ status: 'unauthorized' }, 401);
    if (session.authChannel !== 'web' || session.role !== 'admin' || new URL(request.url).search
        || request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return reply({ status: 'denied' }, 403);
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    if (active >= 2) return reply({ status: 'busy' }, 503);
    active += 1;
    let parsed: unknown;
    try {
        const ambulatoryId = webPatientDocumentScope((await cookies()).get('ambulatory_id')?.value);
        if (!ambulatoryId) return reply({ status: 'scope-unavailable' }, 409);
        const read = await readBoundedJsonBody(request, BODY_LIMIT, 'strict',
            { signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]), deadline: performance.now() + 20_000, sensitive: true });
        if (!read.ok) return reply({ status: 'denied' }, read.status);
        const body = parsed = read.value;
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ status: 'denied' }, 400);
        const input = body as Record<string, unknown>, keys = Object.keys(input).sort().join(',');
        const context = { session, ambulatoryId, request };
        if (input.operation === 'stage' && keys === 'operation,source') return reply(await webPatientDocumentService.stage(context, input.source));
        if (typeof input.commandId !== 'string' || !COMMAND_UUID.test(input.commandId)) return reply({ status: 'denied' }, 400);
        if (input.operation === 'preview' && keys === 'commandId,operation,review,viewId' && typeof input.viewId === 'string') {
            return reply(await webPatientDocumentService.preview(context, input.commandId, input.viewId, input.review as PatientDocumentCreateReview));
        }
        if (input.operation === 'execute' && keys === 'commandId,operation,pin'
            && typeof input.pin === 'string' && /^[^\u0000-\u001f\u007f]{4,8}$/u.test(input.pin)) {
            return reply(await webPatientDocumentService.execute(context, input.commandId, input.pin));
        }
        if (input.operation === 'receipt' && keys === 'commandId,operation') return reply(await webPatientDocumentService.receipt(context, input.commandId));
        if (input.operation === 'revoke' && keys === 'commandId,operation') return reply(await webPatientDocumentService.revoke(context, input.commandId));
        return reply({ status: 'denied' }, 400);
    } catch (error) {
        if (error instanceof NativePatientDocumentExtractionFailed) return reply({ status: 'review-required', detail: error.detail }, 409);
        return error instanceof PatientDocumentDuplicateReviewRequired
            ? reply({ status: 'duplicate-review-required' }, 409) : reply({ status: 'denied' }, 403);
    } finally {
        if (parsed && typeof parsed === 'object' && 'source' in parsed) erasePatientDocumentFileKey(parsed.source);
        active -= 1;
    }
}
