/* @Codex */
import { NextResponse } from 'next/server';

import { createDocumentSynthesisCloudProbeFromHostEnvironment } from '@/lib/ai-providers/v2/document-synthesis-cloud-probe-composition';
import { apiFailure } from '@/lib/api-error-response';
import { safeWriteAuditEventFromRequest } from '@/lib/security/audit';
import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { abortResourceUse, beginResourceUse, commitResourceUse, mintResourcePort,
    registerPrivateResource, releaseResourcePort, unregisterPrivateResource,
    type WebResourcePort, type WebResourceRegistration } from '@/lib/security/web-auth-lifecycle-owner-adapter';

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

type ProbeSessionLifecycle = Readonly<{
    port: WebResourcePort; registration: WebResourceRegistration; signal: AbortSignal;
    current(): boolean; close(): void;
}>;

/* @Codex: retirement of the exact Web session aborts in-flight provider I/O. */
function bindProbeToSession(session: NonNullable<Awaited<ReturnType<typeof requireSession>>>): ProbeSessionLifecycle | null {
    const port = mintResourcePort(session); if (!port) return null;
    const controller = new AbortController();
    const registration = registerPrivateResource(port, () => controller.abort());
    if (!registration) { releaseResourcePort(port); return null; }
    const current = (): boolean => {
        const use = beginResourceUse(port); if (!use) return false;
        let committed = false;
        try { committed = commitResourceUse(use); return committed; }
        finally { if (!committed) abortResourceUse(use); }
    };
    if (!current()) {
        unregisterPrivateResource(port, registration); releaseResourcePort(port); return null;
    }
    let active = true;
    return Object.freeze({ port, registration, signal: controller.signal, current,
        close: () => {
            if (!active) return; active = false;
            unregisterPrivateResource(port, registration); releaseResourcePort(port);
        } });
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
    if (!isTrustedWebMutationRequest(request)) {
        await audit(request, session, 'denied', 'request_transport_invalid');
        return apiFailure('request_transport_invalid', MESSAGE, 403);
    }
    if (!await readIntent(request)) {
        await audit(request, session, 'denied', 'input_invalid');
        return apiFailure('input_invalid', MESSAGE, 400);
    }

    /* @Codex: parsing is an await boundary; re-read the exact admin session
       immediately before constructing and executing the egress capability. */
    const currentSession = await requireSession();
    if (!currentSession || !isWebAdminSession(currentSession)
        || currentSession.id !== session.id || currentSession.userId !== session.userId) {
        await audit(request, currentSession, 'denied', 'session_changed');
        return unauthorizedResponse();
    }

    const lifecycle = bindProbeToSession(currentSession);
    if (!lifecycle) {
        await audit(request, currentSession, 'denied', 'session_changed');
        return unauthorizedResponse();
    }
    const probe = createDocumentSynthesisCloudProbeFromHostEnvironment(lifecycle.signal);
    if (!probe) {
        lifecycle.close();
        await audit(request, session, 'denied', 'provider_probe_disabled');
        return apiFailure('provider_probe_disabled', MESSAGE, 409);
    }

    let result: Awaited<ReturnType<typeof probe.execute>> = null;
    let sessionCurrent = false;
    try { result = await probe.execute(); } catch { result = null; }
    finally {
        sessionCurrent = lifecycle.current();
        if (!sessionCurrent) result = null;
        lifecycle.close();
    }
    if (!sessionCurrent || lifecycle.signal.aborted) {
        await audit(request, currentSession, 'denied', 'session_changed');
        return unauthorizedResponse();
    }
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
