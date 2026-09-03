/* @Codex */
import { NextResponse } from 'next/server';

import { createDocumentSynthesisCloudProbeFromHostEnvironment } from '@/lib/ai-providers/v2/document-synthesis-cloud-probe-composition';
import { apiFailure } from '@/lib/api-error-response';
import { safeWriteAuditEventFromRequest } from '@/lib/security/audit';
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTENT = 'run_synthetic_nonclinical_probe' as const;
const MESSAGE = 'Probe provider cloud non disponibile.';

function exactIntent(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== 'intent') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'intent');
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
        && descriptor.value === INTENT;
}

async function readIntent(request: Request): Promise<boolean> {
    try { return exactIntent(await request.json()); } catch { return false; }
}

function json(value: unknown): NextResponse {
    const response = NextResponse.json(value);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

async function audit(
    request: Request,
    session: Awaited<ReturnType<typeof requireSession>>,
    outcome: 'success' | 'failure' | 'denied',
    reasonCode: string,
    providerId?: 'openai' | 'anthropic',
): Promise<void> {
    await safeWriteAuditEventFromRequest(request, session, {
        eventType: 'ai.provider_probe.executed',
        outcome,
        subjectType: 'ai_review',
        subjectRef: null,
        redactedMetadata: {
            flags: ['document_synthesis', 'synthetic_nonclinical', ...(providerId ? [`provider_${providerId}`] : [])],
            reasonCode,
        },
    }, '[MediFlow] Cloud provider probe audit write failed:');
}

export async function POST(request: Request): Promise<NextResponse> {
    const session = await requireSession();
    if (!session) {
        await audit(request, null, 'denied', 'session_unavailable');
        return unauthorizedResponse();
    }
    if (!isWebAdminSession(session)) {
        await audit(request, session, 'denied', 'web_admin_required');
        return forbiddenResponse();
    }
    if (!await readIntent(request)) {
        await audit(request, session, 'denied', 'input_invalid');
        return apiFailure('input_invalid', MESSAGE, 400);
    }

    const probe = createDocumentSynthesisCloudProbeFromHostEnvironment();
    if (!probe) {
        await audit(request, session, 'denied', 'provider_probe_disabled');
        return apiFailure('provider_probe_disabled', MESSAGE, 409);
    }

    const result = await probe.execute();
    if (!result) {
        await audit(request, session, 'failure', 'provider_probe_unavailable');
        return apiFailure('provider_probe_unavailable', MESSAGE, 503);
    }

    await audit(request, session, 'success', 'complete', result.receipt.providerId);

    return json({
        schemaVersion: 'mediflow.ai.cloud-provider-probe-http.v1',
        status: 'complete',
        operation: result.operation,
        dataClass: result.dataClass,
        providerId: result.receipt.providerId,
        model: result.receipt.model,
        poweredBy: result.poweredBy,
        outcome: result.receipt.outcome,
        reviewRequired: result.reviewRequired,
        applyPolicy: result.applyPolicy,
        writesPerformed: result.writesPerformed,
        fallbackCount: result.receipt.fallbackCount,
    });
}
